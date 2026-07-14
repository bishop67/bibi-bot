import { simpleEmbedExample } from "@/core/embeds/simple.embed";
import { db } from "@/lib/db";
import { modLog } from "@/lib/db-schema";
import { MOD_LOG_CHANNELS } from "@/shared/config/channels";
import { ConfigValidator } from "@/shared/config/validator";
import { and, eq } from "drizzle-orm";
import type { Guild, TextChannel } from "discord.js";

export type ModLogAction =
  | "warn"
  | "edit-warning"
  | "delete-warning"
  | "clear-warnings"
  | "jail"
  | "unjail";

export class ModLogService {
  private static _warningLogged = false;

  private static findLogChannel(guild: Guild) {
    return guild.channels.cache.find(
      ({ name }) => MOD_LOG_CHANNELS.includes(name) && name !== undefined,
    );
  }

  /**
   * Posts a mod-log embed (if MOD_LOG_CHANNELS is configured) and stores
   * an auditable DB record either way, so history exists even without a
   * log channel set up. Returns the created record (with its `id`, used
   * later by /reason to look the entry back up).
   */
  static async postLog({
    guild,
    action,
    targetId,
    targetName,
    moderatorId,
    moderatorName,
    reason,
  }: {
    guild: Guild;
    action: ModLogAction;
    targetId: string;
    targetName: string;
    moderatorId?: string;
    moderatorName?: string;
    reason?: string;
  }) {
    let channelId: string | undefined;
    let logMessageId: string | undefined;

    if (!ConfigValidator.isFeatureEnabled("MOD_LOG_CHANNELS")) {
      if (!this._warningLogged) {
        ConfigValidator.logFeatureDisabled("Moderation Log", "MOD_LOG_CHANNELS");
        this._warningLogged = true;
      }
    } else {
      const logChannel = this.findLogChannel(guild);

      if (logChannel?.isTextBased()) {
        const embed = simpleEmbedExample();
        embed.description =
          `**Action:** ${action}\n` +
          `**Target:** <@${targetId}> (${targetName})\n` +
          `**Moderator:** ${moderatorId ? `<@${moderatorId}> (${moderatorName ?? "unknown"})` : "automod"}\n` +
          (reason ? `**Reason:** ${reason}` : "");
        embed.footer!.text = "modlog";

        try {
          const sent = await (logChannel as TextChannel).send({
            embeds: [embed],
            allowedMentions: { users: [], roles: [] },
          });
          channelId = logChannel.id;
          logMessageId = sent.id;
        } catch {
          // Posting failed (missing perms, etc.) - still record to DB below
        }
      }
    }

    const [entry] = await db
      .insert(modLog)
      .values({
        guildId: guild.id,
        action,
        targetId,
        moderatorId,
        reason,
        channelId,
        logMessageId,
      })
      .returning();

    return entry;
  }

  static async getLogById(guildId: string, logId: number) {
    return db.query.modLog.findFirst({
      where: and(eq(modLog.id, logId), eq(modLog.guildId, guildId)),
    });
  }

  /**
   * Edits the reason on a past log entry, both in the DB and (if it's
   * still findable) on the posted embed message itself.
   */
  static async editReason(
    guild: Guild,
    logId: number,
    newReason: string,
  ) {
    const entry = await this.getLogById(guild.id, logId);
    if (!entry) return null;

    const [updated] = await db
      .update(modLog)
      .set({ reason: newReason })
      .where(and(eq(modLog.id, logId), eq(modLog.guildId, guild.id)))
      .returning();

    if (entry.channelId && entry.logMessageId) {
      try {
        const channel = await guild.channels.fetch(entry.channelId);
        if (channel?.isTextBased()) {
          const message = await channel.messages.fetch(entry.logMessageId);
          const embed = message.embeds[0];
          if (embed) {
            const description = (embed.description ?? "").replace(
              /\*\*Reason:\*\*.*$/s,
              `**Reason:** ${newReason}`,
            );
            await message.edit({
              embeds: [{ ...embed.data, description }],
            });
          }
        }
      } catch {
        // Original message/channel no longer exists - DB record is still updated
      }
    }

    return updated;
  }
}