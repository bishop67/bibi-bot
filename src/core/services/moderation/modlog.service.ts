import { ensureMemberRows } from "@/core/services/members/ensure-member";
import { db } from "@/lib/db";
import { member, modLog } from "@/lib/db-schema";
import { logEmbed, type LogTone } from "@/core/embeds/log.embed";
import { MOD_LOG_CHANNELS } from "@/shared/config/channels";
import { ConfigValidator } from "@/shared/config/validator";
import { eq } from "drizzle-orm";
import type { APIEmbed, Guild, TextChannel, User } from "discord.js";

export type ModLogAction =
  | "warn"
  | "edit-warning"
  | "delete-warning"
  | "clear-warnings"
  | "jail"
  | "unjail"
  | "kick"
  | "ban"
  | "unban"
  | "timeout"
  | "untimeout"
  | "purge";

// Severity, so a ban and an unban are not the same colour in the scrollback.
const ACTION_TONES: Record<ModLogAction, LogTone> = {
  warn: "caution",
  "edit-warning": "neutral",
  "delete-warning": "neutral",
  "clear-warnings": "neutral",
  jail: "negative",
  unjail: "positive",
  kick: "negative",
  ban: "negative",
  unban: "positive",
  timeout: "caution",
  untimeout: "positive",
  purge: "negative",
};

// Only who acted is shown for these: lifts need no justification, kicks and
// bans come from Discord's own dialog, which has no reason to rely on, and
// /delete-messages takes no reason.
const NO_REASON: ModLogAction[] = [
  "unjail",
  "untimeout",
  "kick",
  "ban",
  "unban",
  "purge",
];

const ACTION_TITLES: Record<ModLogAction, string> = {
  warn: "Member Warned",
  "edit-warning": "Warning Edited",
  "delete-warning": "Warning Deleted",
  "clear-warnings": "Warnings Cleared",
  jail: "Member Jailed",
  kick: "Member Kicked",
  ban: "Member Banned",
  unban: "Member Unbanned",
  timeout: "Member Timed Out",
  untimeout: "Timeout Removed",
  unjail: "Member Unjailed",
  purge: "Messages Purged",
};

const deletedLine = (amount: number) => `**Messages deleted:** ${amount}`;

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
    targetUser,
    moderatorId,
    moderatorName,
    moderatorFromAuditLog,
    reason,
    note,
    amount,
    purgedChannelId,
  }: {
    guild: Guild;
    action: ModLogAction;
    /**
     * A member, as ModLog has a foreign key to Member. A channel purge has no
     * member to name, so it passes the moderator here and the channel below.
     */
    targetId: string;
    targetName?: string;
    /** Needed for kicks and bans: the member is gone from cache by then. */
    targetUser?: User | null;
    moderatorId?: string;
    moderatorName?: string;
    /**
     * The moderator came from an audit-log lookup, so a missing one means
     * "could not tell who", not the automod.
     */
    moderatorFromAuditLog?: boolean;
    reason?: string;
    /** Shown on its own line, even for actions that carry no reason. */
    note?: string;
    /** How many messages were deleted, for purges. */
    amount?: number;
    /** The channel a purge cleared; replaces the member line. */
    purgedChannelId?: string;
  }) {
    if (NO_REASON.includes(action)) reason = undefined;

    try {
      const resolvedTargetName =
        targetName ?? (await this.resolveTargetName(guild, targetId));

      let channelId: string | undefined;
      let logMessageId: string | undefined;

      if (!ConfigValidator.isFeatureEnabled("MOD_LOG_CHANNELS")) {
        if (!this._warningLogged) {
          ConfigValidator.logFeatureDisabled(
            "Moderation Log",
            "MOD_LOG_CHANNELS",
          );
          this._warningLogged = true;
        }
      } else {
        const logChannel = this.findLogChannel(guild);

        if (logChannel?.isTextBased()) {
          const embed: APIEmbed = logEmbed({
            tone: ACTION_TONES[action],
            user: purgedChannelId
              ? null
              : (targetUser ?? guild.members.cache.get(targetId)?.user ?? null),
            title: ACTION_TITLES[action],
            lines: [
              purgedChannelId
                ? `<#${purgedChannelId}>`
                : `<@${targetId}> (${resolvedTargetName})`,
              `**Moderator:** ${
                moderatorId
                  ? `<@${moderatorId}> (${moderatorName ?? "unknown"})`
                  : moderatorFromAuditLog
                    ? "Unknown (needs View Audit Log)"
                    : "Automod"
              }`,
              ...(NO_REASON.includes(action)
                ? []
                : [`**Reason:** ${reason || "No reason provided"}`]),
              ...(amount !== undefined ? [deletedLine(amount)] : []),
              ...(note ? [`**Note:** ${note}`] : []),
              `-# ${purgedChannelId ?? targetId}`,
            ],
            footer: "mod log",
          });

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

      // ModLog has FKs to Member for both target and moderator, so a user the
      // bot has not synced yet would fail the insert below and the action would
      // go unrecorded - see ensureMemberRows.
      await ensureMemberRows([
        { memberId: targetId, username: targetName ?? resolvedTargetName },
        { memberId: moderatorId, username: moderatorName },
      ]);

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

  /**
   * Add the sweep's count to a jail entry that was posted before the sweep
   * ran. The jail is logged first so a restart mid-sweep still leaves a
   * record; the count follows once it is known. Best-effort, like the post.
   */
  static async addDeletedCount(
    guild: Guild,
    entry: { channelId: string | null; logMessageId: string | null },
    amount: number,
  ) {
    if (!entry.channelId || !entry.logMessageId) return;

    try {
      const channel = guild.channels.cache.get(entry.channelId);
      if (!channel?.isTextBased()) return;

      const message = await channel.messages.fetch(entry.logMessageId);
      const embed = message.embeds[0]?.toJSON();
      if (!embed?.description) return;

      // Above the trailing "-# id" line, where the other details sit.
      const lines = embed.description.split("\n");
      const footer = lines.at(-1)?.startsWith("-# ") ? lines.pop() : undefined;
      lines.push(deletedLine(amount));
      if (footer) lines.push(footer);

      await message.edit({
        embeds: [{ ...embed, description: lines.join("\n") }],
        allowedMentions: { users: [], roles: [] },
      });
    } catch (err) {
      console.error("[ModLogService] addDeletedCount failed:", err);
    }
  }
}
