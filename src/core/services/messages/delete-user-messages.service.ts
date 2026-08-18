import { userJailedEmbed } from "@/core/embeds/user-jailed.embed";
import {
  hasDeleteExemptRole,
  isDeleteProtected,
} from "@/core/services/messages/delete-exempt";
import { ModLogService } from "@/core/services/moderation/modlog.service";
import { RolesService } from "@/core/services/roles/roles.service";
import { db } from "@/lib/db";
import { botLogger } from "@/lib/telemetry";
import { member, memberGuild, memberRole } from "@/lib/db-schema";
import { and, eq } from "drizzle-orm";
import { JAIL, MEMBER_ROLES } from "@/shared/config/roles";
import { isStaffMember } from "@/shared/config/staff";
import { TEMPLATE_VALIDATION_CHANNELS } from "@/shared/config/channels";
import { ConfigValidator } from "@/shared/config/validator";
import type { DeleteUserMessagesParams } from "@/types";
import {
  ChannelType,
  DiscordAPIError,
  ForumChannel,
  Guild,
  GuildTextBasedChannel,
  TextChannel,
  ThreadChannel,
  User,
} from "discord.js";
import { error, log } from "node:console";

const CHANNEL_CONCURRENCY = 3;
const DEFAULT_DELETE_AGE_DAYS = 14;
// Discord's bulk delete refuses messages older than this.
const MAX_DELETE_AGE_DAYS = 14;

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  let index = 0;

  async function runNext(): Promise<void> {
    while (index < tasks.length) {
      const currentIndex = index++;
      try {
        const value = await tasks[currentIndex]();
        results[currentIndex] = { status: "fulfilled", value };
      } catch (reason) {
        results[currentIndex] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () =>
      runNext(),
    ),
  );
  return results;
}

export class DeleteUserMessagesService {
  /**
   * Jail user and start message deletion in background.
   * Returns as soon as the jail is applied.
   */
  static async jailAndDeleteMessages(params: DeleteUserMessagesParams) {
    if (params.automated && (await this.isAutoJailExempt(params))) return;

    const { alreadyJailed } = await this.jailUser(params);
    if (alreadyJailed) return;

    if (params.deleteMessages === false) return;
    this.deleteUserMessages(params).catch(error);
  }

  /**
   * Staff are never jailed by the bot's own decision.
   *
   * They keep getting warned and having offending messages removed - only the
   * automatic escalation to a jail is withheld, because a moderator locking
   * themselves out over a link or a malformed forum post is worse than the
   * thing being moderated. A moderator can still jail a colleague by hand.
   */
  private static async isAutoJailExempt(
    params: DeleteUserMessagesParams,
  ): Promise<boolean> {
    const memberId = params.user?.id || params.memberId;
    const discordMember =
      params.guild.members.cache.get(memberId) ||
      (await params.guild.members.fetch(memberId).catch(() => null));

    if (!discordMember) return false;

    if (!isStaffMember(discordMember)) return false;

    botLogger.info("Skipped auto-jail for staff member", {
      guildId: params.guild.id,
      memberId,
      reason: params.reason,
    });

    return true;
  }

  /**
   * Apply jail role, update DB, send notification. Fast operation (~2s).
   *
   * Jailing someone who is already jailed does nothing. There is nothing left
   * to escalate - they hold the role, and the first jail stripped everything
   * else - so the only part that would still run is the message sweep, and by
   * then DELETE_EXEMPT_ROLES has no role left to match. A second jail would
   * therefore clear the protected channels the first one deliberately spared,
   * unrecoverably. Refusing is the only outcome consistent with the first
   * jail; to widen the deletion window, unjail first.
   */
  static async jailUser(
    params: DeleteUserMessagesParams,
  ): Promise<{ alreadyJailed: boolean }> {
    const jailRoleId = RolesService.getGuildStatusRoles(params.guild)[JAIL]
      ?.id;

    // Returning quietly here means a spammer the filters already decided to
    // mute just carries on, with nothing anywhere to say why.
    if (!jailRoleId) {
      botLogger.error(
        "Cannot jail member: this guild has no role matching the configured jail name",
        {
          guildId: params.guild.id,
          guildName: params.guild.name,
          memberId: params.memberId,
          jailRoleName: JAIL ?? "(STATUS_ROLES has no jail entry)",
          reason: params.reason,
        },
      );
      return { alreadyJailed: false };
    }

    const memberId = params.user?.id || params.memberId;
    const discordMember =
      params.guild.members.cache.get(memberId) ||
      (await params.guild.members.fetch(memberId).catch(() => null));

    if (discordMember?.roles.cache.has(jailRoleId)) {
      botLogger.info("Member is already jailed - leaving them as they are", {
        guildId: params.guild.id,
        memberId,
        reason: params.reason,
      });
      return { alreadyJailed: true };
    }

    // Read before the role is applied: adding it makes the status-role handler
    // strip every other role they hold.
    await this.captureDeleteExemption(params);

    await db.transaction(async (tx) => {
      await tx
        .insert(member)
        .values({
          memberId: params.memberId,
          username: params.user?.username || "Unknown User",
        })
        .onConflictDoNothing();

      await tx.delete(memberRole).where(
        and(
          eq(memberRole.memberId, params.memberId),
          eq(memberRole.guildId, params.guild.id),
        ),
      );

      await tx.insert(memberRole).values({
        roleId: jailRoleId,
        memberId: params.memberId,
        guildId: params.guild.id,
        name: JAIL,
      });
    });

    const role = params.guild.roles.cache.get(jailRoleId);
    if (discordMember && role?.editable)
      await discordMember.roles.add(jailRoleId).catch(error);

    await ModLogService.postLog({
      guild: params.guild,
      action: "jail",
      targetId: params.memberId,
      targetName: params.user?.username ?? "Unknown User",
      reason: params.reason,
    });

    await this.sendJailNotification(params);

    return { alreadyJailed: false };
  }

  /**
   * Release a member from jail.
   *
   * Note what this cannot do: jailUser deletes every MemberRole row the member
   * had and the status-role handler strips their Discord roles, so their
   * previous roles are already gone by the time anyone unjails them. The best
   * available outcome is removing the jail role and restoring the configured
   * default member role, which is why that record loss is worth knowing about.
   */
  static async unjailUser(params: {
    guild: Guild;
    memberId: string;
    user: User | null;
    moderatorId?: string;
    moderatorName?: string;
    reason?: string;
  }): Promise<{ ok: boolean; message: string }> {
    const jailRoleId = RolesService.getGuildStatusRoles(params.guild)[JAIL]?.id;

    if (!jailRoleId) {
      botLogger.error(
        "Cannot unjail: this guild has no role matching the configured jail name",
        { guildId: params.guild.id, jailRoleName: JAIL ?? "(unset)" },
      );
      return { ok: false, message: "No jail role is configured on this server." };
    }

    const discordMember =
      params.guild.members.cache.get(params.memberId) ||
      (await params.guild.members.fetch(params.memberId).catch(() => null));

    if (!discordMember) {
      return { ok: false, message: "That member is not in the server." };
    }

    if (!discordMember.roles.cache.has(jailRoleId)) {
      return { ok: false, message: "That member is not jailed." };
    }

    const role = params.guild.roles.cache.get(jailRoleId);
    if (!role?.editable) {
      return {
        ok: false,
        message: "I cannot manage the jail role - it sits above my highest role.",
      };
    }

    await discordMember.roles.remove(jailRoleId).catch(error);

    await db
      .delete(memberRole)
      .where(
        and(
          eq(memberRole.memberId, params.memberId),
          eq(memberRole.guildId, params.guild.id),
          eq(memberRole.roleId, jailRoleId),
        ),
      );

    // Their original roles are unrecoverable, so put back the default member
    // role rather than leaving them with nothing.
    const restored: string[] = [];
    for (const name of MEMBER_ROLES) {
      const memberRoleToAdd = params.guild.roles.cache.find(
        (r) => r.name === name,
      );
      if (!memberRoleToAdd?.editable) continue;
      if (discordMember.roles.cache.has(memberRoleToAdd.id)) continue;

      await discordMember.roles.add(memberRoleToAdd.id).catch(error);
      restored.push(name);

      await db
        .insert(memberRole)
        .values({
          roleId: memberRoleToAdd.id,
          memberId: params.memberId,
          guildId: params.guild.id,
          name,
        })
        .onConflictDoNothing();
    }

    await ModLogService.postLog({
      guild: params.guild,
      action: "unjail",
      targetId: params.memberId,
      targetName: params.user?.username,
      moderatorId: params.moderatorId,
      moderatorName: params.moderatorName,
      reason: params.reason,
    });

    return {
      ok: true,
      message: restored.length
        ? `Unjailed. Restored: ${restored.join(", ")}. Any other roles they had were lost when they were jailed.`
        : "Unjailed. Any roles they had were lost when they were jailed, so they may need re-adding.",
    };
  }

  /**
   * Record whether this member has a DELETE_EXEMPT_ROLES role, before anything
   * touches their roles.
   *
   * Adding the jail role makes the status-role handler strip every other role
   * they hold, and the sweep then runs in the background afterwards - so by
   * the time it asks "is this an OG?", the OG role is already gone and the
   * answer is no for everyone. It has to be captured up front.
   *
   * Idempotent, so whichever of jailUser and deleteUserMessages runs first
   * decides. Callers that jail before sweeping get the pre-jail answer.
   */
  private static async captureDeleteExemption(
    params: DeleteUserMessagesParams,
  ) {
    if (params.hasDeleteExemptRole !== undefined) return;

    const memberId = params.user?.id || params.memberId;
    const discordMember =
      params.guild.members.cache.get(memberId) ||
      (await params.guild.members.fetch(memberId).catch(() => null));

    params.hasDeleteExemptRole = hasDeleteExemptRole(discordMember);
  }

  /**
   * Delete user messages across all channels, within the requested window.
   */
  static async deleteUserMessages(params: DeleteUserMessagesParams) {
    await this.captureDeleteExemption(params);
    const hasExemptRole = params.hasDeleteExemptRole ?? false;
    log(
      `[DeleteUserMessages] Starting message deletion for user ${params.memberId} in guild ${params.guild.name}` +
        (hasExemptRole
          ? " (exempt role: protected channels will be kept)"
          : " (no exempt role: only never-delete channels will be kept)"),
    );
    let totalDeleted = 0;
    // Discord will not bulk-delete anything older than 14 days, so clamp
    // rather than silently doing nothing for a larger number.
    const days = Math.min(Math.max(params.days ?? DEFAULT_DELETE_AGE_DAYS, 1), MAX_DELETE_AGE_DAYS);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    let skippedChannels = 0;

    const deleteMessages = async (channel: GuildTextBasedChannel) => {
      if (isDeleteProtected(channel, { hasExemptRole })) {
        skippedChannels++;
        log(
          `[DeleteUserMessages] Skipping protected channel #${channel.name} (${channel.id})`,
        );
        return;
      }

      try {
        let deleted = 0;
        let lastMessageId: string | undefined;

        for (;;) {
          const messages = await channel.messages.fetch({
            limit: 100,
            ...(lastMessageId ? { before: lastMessageId } : {}),
          });
          if (messages.size === 0) break;

          lastMessageId = messages.last()!.id;

          // Stop if we've gone past the 14-day cutoff
          const oldestMessage = messages.last()!;
          const pastCutoff = oldestMessage.createdTimestamp < cutoff;

          // m.system covers Discord's own notices - join messages, boosts,
          // pins - which carry the member as their author but are not their
          // posts. Deleting them only leaves holes in the server's own record.
          const userMessages = messages.filter(
            (m) =>
              m.author.id === params.memberId &&
              !m.system &&
              m.createdTimestamp >= cutoff,
          );

          if (userMessages.size > 0) {
            const result = await channel.bulkDelete(userMessages, true);
            deleted += result.size;
          }

          if (messages.size < 100 || pastCutoff) break;
        }

        if (deleted > 0) {
          log(
            `[DeleteUserMessages] Deleted ${deleted} messages in #${channel.name} (${channel.id})`,
          );
          totalDeleted += deleted;
        }
      } catch (err) {
        if (err instanceof DiscordAPIError && err.code === 10003) {
          log(
            `[DeleteUserMessages] Channel ${channel.id} no longer exists, skipping`,
          );
          return;
        }
        error(err);
      }
    };

    const processThread = async (thread: ThreadChannel) => {
      // Checked here as well as in deleteMessages: a thread the member owns is
      // deleted outright without going through it, and a thread in a protected
      // forum should survive that too.
      if (isDeleteProtected(thread, { hasExemptRole })) {
        skippedChannels++;
        log(
          `[DeleteUserMessages] Skipping protected thread #${thread.name} (${thread.id})`,
        );
        return;
      }

      try {
        if (thread.ownerId === params.memberId) {
          log(
            `[DeleteUserMessages] Deleting thread owned by user: #${thread.name} (${thread.id})`,
          );
          await thread.delete();
          return;
        }
        await deleteMessages(thread as GuildTextBasedChannel);
      } catch (err) {
        if (err instanceof DiscordAPIError && err.code === 10003) {
          log(
            `[DeleteUserMessages] Thread ${thread.id} no longer exists, skipping`,
          );
          return;
        }
        error(err);
      }
    };

    const channelTasks: (() => Promise<void>)[] = [];

    for (const channel of params.guild.channels.cache.values()) {
      if (channel.type === ChannelType.GuildForum) {
        channelTasks.push(async () => {
          const threads = await (channel as ForumChannel).threads
            .fetchActive()
            .catch(error);
          if (threads) {
            for (const thread of threads.threads.values()) {
              await processThread(thread);
            }
          }
        });
      } else if (
        [
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.GuildVoice,
          ChannelType.GuildStageVoice,
          ChannelType.GuildMedia,
        ].includes(channel.type)
      ) {
        channelTasks.push(() =>
          deleteMessages(channel as GuildTextBasedChannel),
        );
      } else if (
        [
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
          ChannelType.AnnouncementThread,
        ].includes(channel.type)
      ) {
        channelTasks.push(() => processThread(channel as ThreadChannel));
      }
    }

    log(
      `[DeleteUserMessages] Processing ${channelTasks.length} channels (concurrency: ${CHANNEL_CONCURRENCY})`,
    );
    await runWithConcurrency(channelTasks, CHANNEL_CONCURRENCY);
    log(
      `[DeleteUserMessages] Finished. Deleted ${totalDeleted} messages total for user ${params.memberId}` +
        (skippedChannels
          ? ` (skipped ${skippedChannels} protected channel${skippedChannels === 1 ? "" : "s"})`
          : ""),
    );
  }

  private static async sendJailNotification(params: {
    guild: Guild;
    user: User | null;
    memberId: string;
    reason?: string;
  }) {
    const jailChannel = params.guild.channels.cache.find(
      (ch) =>
        ch.type === ChannelType.GuildText &&
        ch.name.toLowerCase().includes("jail"),
    ) as TextChannel | undefined;

    const backupChannel = ConfigValidator.isFeatureEnabled(
      "TEMPLATE_VALIDATION_CHANNELS",
    )
      ? (params.guild.channels.cache.find(
          (ch) =>
            ch.type === ChannelType.GuildText &&
            TEMPLATE_VALIDATION_CHANNELS.includes(ch.name),
        ) as TextChannel | undefined)
      : undefined;

    if (!jailChannel && !backupChannel) return;

    const dbMember = await db.query.member.findFirst({
      where: eq(member.memberId, params.memberId),
      with: {
        memberGuilds: {
          where: eq(memberGuild.guildId, params.guild.id),
          limit: 1,
        },
      },
    });

    const displayName =
      (dbMember?.memberGuilds as any)?.[0]?.displayName ||
      dbMember?.globalName ||
      dbMember?.username ||
      "Unknown";
    const username = dbMember?.username || "Unknown";

    const embed = userJailedEmbed({
      memberId: params.memberId,
      displayName,
      username,
      reason: params.reason,
    });

    const payload = {
      embeds: [embed],
      allowedMentions: { users: [], roles: [] },
    };

    await Promise.all([
      jailChannel?.send(payload).catch(error),
      backupChannel?.send(payload).catch(error),
    ]);
  }
}