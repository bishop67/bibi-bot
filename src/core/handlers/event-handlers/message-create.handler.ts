import { MessagesService } from "@/core/services/messages/messages.service";
import { RolesService } from "@/core/services/roles/roles.service";
import { DuplicateSpamService } from "@/core/services/spam/duplicate-spam.service";
import { SpamDetectionService } from "@/core/services/spam/spam-detection.service";
import { isSpamExempt } from "@/core/services/spam/spam-exempt";
import { CAN_READ_MESSAGE_CONTENT } from "@/shared/config/features";
import { Message } from "discord.js";
import type { SimpleCommandMessage } from "discordx";

export async function handleMessageCreate(message: Message): Promise<void> {
  // Without the MessageContent intent every message arrives with empty content,
  // which would make the scam and invite filters report clean on everything.
  // Skip them outright rather than let them pass traffic they cannot inspect.
  if (!CAN_READ_MESSAGE_CONTENT) {
    await MessagesService.addMessageDb(message);
    await MessagesService.levelUpMessage(message);
    return;
  }

  // A trusted channel or role exempts a message from every automated filter,
  // the invite filter included. Gating only some of them is how a member with
  // an exempt role still gets warned, and eventually jailed.
  if (!isSpamExempt(message)) {
    const isSpam =
      await SpamDetectionService.detectSpamFirstMessageWithAi(message);
    if (isSpam) {
      return;
    }

    // Each of these deletes the message and warns or jails the author when it
    // acts, so stop on the first hit. Carrying on would run the next filter
    // over a message that no longer exists and then bank XP for it.
    if (await DuplicateSpamService.checkDuplicateSpam(message)) {
      return;
    }

    if (await MessagesService.checkWarnings(message)) {
      return;
    }
  }

  await MessagesService.addMessageDb(message);
  
  await MessagesService.levelUpMessage(message);
}

export async function handleCheckThreadHelpLike(
  command: SimpleCommandMessage,
): Promise<void> {
  const message = command.message;
  const channel = message.channel;

  if (!channel.isThread()) return;

  const messages = await MessagesService.fetchMessages(channel, 500);
  const previousMessage = messages
    .reverse()
    .find((msg) => msg.author.id !== message.author.id && !msg.author.bot);

  if (!previousMessage || previousMessage.author.bot) return;

  await RolesService.handleHelperReaction({
    threadId: channel.id,
    threadOwnerId: channel.ownerId,
    helperId: previousMessage.author.id,
    thankerUserId: message.author.id,
    guildId: message.guildId!,
    message: previousMessage,
  });
}
