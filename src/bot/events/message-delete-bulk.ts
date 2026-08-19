import { isLogExempt } from "@/core/services/logging/log-exempt";
import { ServerLogService } from "@/core/services/logging/server-log.service";
import { findBulkDeleteExecutor } from "@/core/services/moderation/audit-log";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";

@Discord()
export class MessageDeleteBulk {
  /**
   * Bulk deletions were invisible to logging entirely.
   *
   * Discord fires this instead of messageDelete when messages go in a batch,
   * which is what a ban that clears message history does, and what the jail
   * sweep does - so the deletions worth reviewing most were the ones leaving
   * no trace at all.
   *
   * Note what this deliberately does not do: it never touches MemberMessages.
   * Those rows surviving a sweep is what lets a member's levels come back
   * after an unjail, and deleting them here would quietly undo that.
   */
  @On()
  async messageDeleteBulk(
    [messages, channel]: ArgsOf<"messageDeleteBulk">,
    client: Client,
  ) {
    if (!channel.guild || messages.size === 0) return;

    // Checked before the audit lookup so a staff channel costs nothing and
    // leaks nothing.
    if (isLogExempt(channel)) return;

    const deletedById = await findBulkDeleteExecutor(channel.guild, channel.id);

    await ServerLogService.logMessageBulkDelete(
      channel.guild,
      channel,
      messages,
      deletedById,
    );
  }
}
