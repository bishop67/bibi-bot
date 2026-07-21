import { db } from "@/lib/db";
import { member, modLog } from "@/lib/db-schema";
import { BOT_ICON, RED_COLOR } from "@/shared/config/branding";
import { MOD_LOG_CHANNELS } from "@/shared/config/channels";
import { ConfigValidator } from "@/shared/config/validator";
import { eq } from "drizzle-orm";
import type { APIEmbed, Guild, TextChannel } from "discord.js";

export type ModLogAction =
  | "warn"
  | "edit-warning"
  | "delete-warning"
  | "clear-warnings"
  | "jail"
  | "unjail";

const ACTION_TITLES: Record<ModLogAction, string> = {
  warn: "Member Warned",
  "edit-warning": "Warning Edited",
  "delete-warning": "Warning Deleted",
  "clear-warnings": "Warnings Cleared",
  jail: "Member Jailed",
  unjail: "Member Unjailed",
};

/**
 * Single entry point for all moderation logging. Every mod action that
 * changes a member's standing (warn/edit/delete/clear/jail/unjail) should
 * call postLog() exactly once, from the service layer (not the command
 * layer) so there's one call site per action and no risk of double-posting.
 *
 * Always writes an auditable row to the ModLog table, even if no log
 * channel is configured or the channel post fails - the DB row is the
 * source of truth, the channel post is a best-effort mirror of it.
 */
export class ModLogService {
  private static _warningLogged = false;

  private static findLogChannel(guild: Guild) {
    return guild.channels.cache.find(
      ({ name }) => name !== undefined && MOD_LOG_CHANNELS.includes(name),
    );
  }

  /**
   * Best-effort resolution of a display name for the log embed when the
   * caller only has an ID (e.g. edit-warning/delete-warning only receive a
   * warning ID, not the target user). Cache -> DB -> raw ID, in that order.
   */
  private static async resolveTargetName(guild: Guild, targetId: string) {
    const cached = guild.members.cache.get(targetId);
    if (cached) return cached.user.username;

    const dbMember = await db.query.member.findFirst({
      where: eq(member.memberId, targetId),
      columns: { username: true },
    });
    if (dbMember?.username) return dbMember.username;

    return "Unknown User";
  }

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
    targetName?: string;
    moderatorId?: string;
    moderatorName?: string;
    reason?: string;
  }) {
    try {
      const resolvedTargetName =
        targetName ?? (await this.resolveTargetName(guild, targetId));

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
          const embed: APIEmbed = {
            color: RED_COLOR,
            title: ACTION_TITLES[action],
            description: [
              `**Member:** <@${targetId}> (${resolvedTargetName})`,
              `**Member ID:** ${targetId}`,
              `**Moderator:** ${
                moderatorId
                  ? `<@${moderatorId}> (${moderatorName ?? "unknown"})`
                  : "Automod"
              }`,
              `**Reason:** ${reason || "No reason provided"}`,
            ].join("\n"),
            timestamp: new Date().toISOString(),
            footer: { text: "Mod Log", icon_url: BOT_ICON },
          };

          try {
            const sent = await (logChannel as TextChannel).send({
              embeds: [embed],
              allowedMentions: { users: [], roles: [] },
            });
            channelId = logChannel.id;
            logMessageId = sent.id;
          } catch {
            // Posting failed (missing perms, deleted channel, etc.) - the
            // DB row below still records the action, so nothing is lost.
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
    } catch (err) {
      // Nothing in here should ever be able to break the moderation action
      // that triggered it (e.g. targetId/moderatorId not yet synced to the
      // Member table, a transient DB error, etc.) - log and move on.
      console.error("[ModLogService] postLog failed:", err);
      return null;
    }
  }
}