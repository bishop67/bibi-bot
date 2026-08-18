import { MessageBackfillService } from "@/core/services/messages/message-backfill.service";
import { botLogger } from "@/lib/telemetry";
import type { CommandResult } from "@/types";
import { PermissionFlagsBits } from "discord.js";
import type { SimpleCommandMessage } from "discordx";

// Discord serves 100 messages a request, so a busy server takes a while.
// Reporting every channel would be its own spam; this is often enough to show
// it is alive without flooding the channel it was started in.
const PROGRESS_EVERY = 10;

export async function executeBackfillMessages(
  command: SimpleCommandMessage,
): Promise<CommandResult> {
  const message = command.message;

  if (!message.guild) return { success: false, error: "Use in a server" };

  if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
    return {
      success: false,
      error: "You don't have permission to use this command.",
    };
  }

  const reset = message.content.includes("--reset");
  if (reset) await MessageBackfillService.resetProgress(message.guild.id);

  const status = await message.reply(
    reset
      ? "Starting message backfill from the beginning. This can take a while."
      : "Starting message backfill. Channels already done are skipped - add `--reset` to start over.",
  );

  try {
    const result = await MessageBackfillService.backfillGuild(
      message.guild,
      async (progress) => {
        if (progress.channelsDone % PROGRESS_EVERY !== 0) return;

        await status
          .edit(
            `Backfilling: ${progress.channelsDone}/${progress.channelsTotal} channels, ${progress.inserted} messages stored. Last: #${progress.channelName}`,
          )
          .catch(() => {});
      },
    );

    const skipped = result.skipped.length
      ? `\nSkipped ${result.skipped.length} channel(s) I cannot read: ${result.skipped.slice(0, 10).join(", ")}`
      : "";

    await status
      .edit(
        `Backfill complete. Stored ${result.inserted} messages across ${result.channelsDone} channels.${skipped}`,
      )
      .catch(() => {});

    return { success: true };
  } catch (error) {
    botLogger.error("Message backfill failed", { error: String(error) });

    // Progress is saved per channel, so say so - the instinct on seeing this
    // is to start again from nothing.
    await status
      .edit(
        "Backfill stopped early. Progress was saved per channel, so running it again resumes where it left off.",
      )
      .catch(() => {});

    return { success: false };
  }
}
