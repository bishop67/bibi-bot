import { MessageBackfillService } from "@/core/services/messages/message-backfill.service";
import { botLogger } from "@/lib/telemetry";
import type { CommandResult } from "@/types";
import { PermissionFlagsBits } from "discord.js";
import type { SimpleCommandMessage } from "discordx";

// The service reports on every channel and every page it fetches. Editing a
// Discord message that often would be rate limited long before it was useful,
// so the throttle belongs here rather than in what gets reported - a channel
// holding tens of thousands of messages should still show it is moving.
const EDIT_EVERY_MS = 5000;

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

  let lastEdit = 0;

  try {
    const result = await MessageBackfillService.backfillGuild(
      message.guild,
      (progress) => {
        const now = Date.now();
        if (now - lastEdit < EDIT_EVERY_MS) return;
        lastEdit = now;

        void status
          .edit(
            `Backfilling #${progress.channelName} - ${progress.channelsDone}/${progress.channelsTotal} channels, ${progress.inserted} messages stored.`,
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
