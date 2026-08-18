import { ServerLogService } from "@/core/services/logging/server-log.service";
import { MessagesService } from "@/core/services/messages/messages.service";
import { PrivacyService } from "@/core/services/privacy/privacy.service";
import { isSpamExempt } from "@/core/services/spam/spam-exempt";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";

@Discord()
export class MessageUpdate {
  @On({ event: "messageUpdate" })
  async messageUpdate(
    [oldMessage, newMessage]: ArgsOf<"messageUpdate">,
    client: Client,
  ) {
    const message = newMessage.partial
      ? await newMessage.fetch().catch(() => null)
      : newMessage;

    if (!message || !message.guild || message.author?.bot) return;

    if (oldMessage.content === message.content) return;

    // An edit can smuggle in an invite the original message never had, so it
    // runs the same filter - and therefore honours the same exemptions.
    if (!isSpamExempt(message)) {
      // Acted on: the message is gone, so there is nothing left to sync.
      if (await MessagesService.checkWarnings(message)) return;
    }

    // Members who opted out of message storage are not logged either - the
    // channel post is as much a record of their content as the table is.
    if (
      message.guildId &&
      (await PrivacyService.hasMessageOptOut(message.author.id, message.guildId))
    )
      return;

    await ServerLogService.logMessageEdit(message, oldMessage.content);
  }
}
