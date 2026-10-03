import type { CommandInteraction, TextChannel } from "discord.js";
import { MessagesService } from "@/core/services/messages/messages.service";
import { ModLogService } from "@/core/services/moderation/modlog.service";
import type { CommandResult } from "@/types";

const BULK_DELETE_BATCH = 100;

export async function executeDeleteMessages(
  interaction: CommandInteraction,
  amount: number,
): Promise<CommandResult> {
  const channel = interaction.channel as TextChannel | null;
  if (!channel || !interaction.guild) {
    return { success: false, error: "Invalid channel" };
  }
  if (!("bulkDelete" in channel)) {
    return {
      success: false,
      error: "This channel does not support bulk deletion.",
    };
  }

  const messages = await MessagesService.fetchMessages(channel, amount);
  if (!messages.length) {
    return { success: false, error: "Nothing to delete here." };
  }

  let deleted = 0;
  for (let i = 0; i < messages.length; i += BULK_DELETE_BATCH) {
    const removed = await channel
      .bulkDelete(messages.slice(i, i + BULK_DELETE_BATCH), true)
      .catch((err) => {
        console.error("[delete-messages] batch failed:", err);
        return null;
      });
    if (removed) deleted += removed.size;
  }

  if (deleted > 0) {
    await ModLogService.postLog({
      guild: interaction.guild,
      action: "purge",
      targetId: interaction.user.id,
      targetName: interaction.user.username,
      moderatorId: interaction.user.id,
      moderatorName: interaction.user.username,
      purgedChannelId: channel.id,
      amount: deleted,
    });
  }

  // bulkDelete silently passes over anything older than 14 days, so the
  // requested amount is not what happened.
  const skipped = messages.length - deleted;
  return {
    success: true,
    message: [
      `Deleted **${deleted}** message${deleted === 1 ? "" : "s"}.`,
      ...(skipped > 0
        ? [
            `**${skipped}** skipped: Discord cannot bulk delete messages older than 14 days.`,
          ]
        : []),
    ].join("\n"),
  };
}
