import { db } from "@/lib/db";
import { memberRole, memberMessages, memberHelper } from "@/lib/db-schema";
import { and, count, eq, ne } from "drizzle-orm";
import { LEVEL_LIST } from "@/shared/config/levels";
import {
  HELPER_RANKING,
  HELPER_ROLES,
  JAIL,
  LEVEL_ROLES,
  STATUS_ROLES,
  VOICE_ONLY,
} from "@/shared/config/roles";
import { ConfigValidator } from "@/shared/config/validator";
import {
  AuditLogEvent,
  findAuditActor,
} from "@/core/services/moderation/audit-log";
import { ModLogService } from "@/core/services/moderation/modlog.service";
import type { HandleHelperReactionParams, UpdateDbRolesArgs } from "@/types";
import {
  Guild,
  GuildMember,
  Message,
  PartialGuildMember,
  Role,
  TextChannel,
} from "discord.js";

export class RolesService {
  private static _helperSystemWarningLogged = false;

  /**
   * Record a jail applied by hand, rather than through /jail.
   *
   * The command writes the ModLog entry itself, so anyone who instead drops
   * the jail role on a member in Discord jails them with no record at all -
   * no moderator, no reason, nothing to review later. The role change is the
   * only signal, and the audit log is the only thing that says who made it,
   * which is the same way kicks and bans are already attributed.
   *
   * Bot-made changes are skipped: /jail, and the handler's own re-application
   * of a jail somebody tried to remove, would otherwise log a second time for
   * an action already recorded.
   */
  private static async logManualJail(
    newMember: GuildMember | PartialGuildMember,
  ) {
    const actor = await findAuditActor(
      newMember.guild,
      AuditLogEvent.MemberRoleUpdate,
      newMember.id,
    );

    const botId = newMember.client.user?.id;
    if (actor?.moderatorId && botId && actor.moderatorId === botId) return;

    await ModLogService.postLog({
      guild: newMember.guild,
      action: "jail",
      targetId: newMember.id,
      targetName: newMember.user.username,
      moderatorId: actor?.moderatorId,
      moderatorName: actor?.moderatorName,
      reason: actor?.reason ?? "Jail role applied manually",
    });
  }
  static async updateDbRoles(args: UpdateDbRolesArgs) {
    // check if new role was added
    if (
      (args.oldMember.flags.bitfield === 9 &&
        args.newMember.flags.bitfield === 11) ||
      args.oldMember.pending ||
      args.newMember.pending
    )
      return;

    if (args.newRoles.length > args.oldRoles.length) {
      // Check for restricted roles (JAIL or VOICE_ONLY)
      const jailId = args.guildRoles.find((role) => role.name === JAIL)?.id;
      const voiceOnlyId = args.guildRoles.find(
        (role) => role.name === VOICE_ONLY,
      )?.id;

      const jailDbRole = args.memberDbRoles.find(
        (dbRole) => dbRole.roleId === jailId,
      );
      const voiceOnlyDbRole = args.memberDbRoles.find(
        (dbRole) => dbRole.roleId === voiceOnlyId,
      );

      // If user has JAIL or VOICE_ONLY role, don't add new roles
      if (jailDbRole || voiceOnlyDbRole) return;

      // add or update new role
      const newAddedRole = args.newRoles.filter(
        (role) => !args.oldRoles.includes(role),
      )[0];
      if (!newAddedRole) return;

      const roleData = {
        roleId: newAddedRole.id,
        memberId: args.newMember.id,
        name: newAddedRole.name,
        guildId: args.newMember.guild.id,
      };

      await db
        .insert(memberRole)
        .values(roleData)
        .onConflictDoUpdate({
          target: [memberRole.memberId, memberRole.roleId],
          set: roleData,
        })
        .catch(() => {});
    }
    if (args.newRoles.length < args.oldRoles.length) {
      // get the removed role
      const newRemovedRole = args.oldRoles.find(
        (role) => !args.newRoles.includes(role),
      );

      // if no role was removed return
      if (!newRemovedRole) return;

      // try catch delete removed role from db
      await db
        .delete(memberRole)
        .where(
          and(
            eq(memberRole.memberId, args.newMember.id),
            eq(memberRole.roleId, newRemovedRole.id),
          ),
        )
        .catch(() => {});
    }
  }

  static async updateStatusRoles(args: UpdateDbRolesArgs) {
    const oldRoleNames = args.oldRoles.map((role) => role.name);
    const newRoleNames = args.newRoles.map((role) => role.name);
    const hadRestrictedRole =
      oldRoleNames.includes(JAIL) || oldRoleNames.includes(VOICE_ONLY);
    const restrictedRoleName = oldRoleNames.includes(JAIL) ? JAIL : VOICE_ONLY;

    // onboarding question bypass
    if (
      (args.oldMember.flags.bitfield === 9 &&
        args.newMember.flags.bitfield === 11) ||
      args.oldMember.pending ||
      args.newMember.pending
    ) {
      if (hadRestrictedRole)
        await RolesService.reapplyRestrictedRole(args, restrictedRoleName);

      return;
    }

    // Only run if user has a new role
    if (args.oldRoles.length >= args.newRoles.length) return;

    const newAddedRole = newRoleNames.find(
      (role) => !oldRoleNames.includes(role),
    )!;

    // The DB decides whether they are still supposed to be jailed. /unjail
    // clears that row before restoring roles, so without this check the
    // restoration looks like an escape attempt and the member is silently
    // re-jailed by the release that was meant to free them. It only survives
    // today because MEMBER_ROLES holds a single role, which keeps the role
    // counts equal and trips the early return above.
    const stillRestrictedInDb = args.memberDbRoles.some(
      (dbRole) => dbRole.name === restrictedRoleName,
    );

    // Enforce jail/voice-only persistence even when an unrelated role gets
    // added later
    if (
      hadRestrictedRole &&
      stillRestrictedInDb &&
      newAddedRole !== JAIL &&
      newAddedRole !== VOICE_ONLY
    ) {
      await RolesService.reapplyRestrictedRole(args, restrictedRoleName);
      return;
    }

    // Handle JAIL or VOICE_ONLY role addition
    if (newAddedRole === JAIL || newAddedRole === VOICE_ONLY) {
      if (newAddedRole === JAIL) {
        await RolesService.logManualJail(args.newMember);
      }

      args.newMember.roles.cache.forEach(
        (role) =>
          role.name !== newAddedRole &&
          args.newMember.roles.remove(role).catch(() => {}),
      );

      // resolve role ID from guild cache (more reliable than member cache)
      const restrictedRoleId = args.guildRoles.find(
        (role) => role.name === newAddedRole,
      )?.id;

      // guard against undefined role ID to avoid nuking all DB roles
      if (restrictedRoleId) {
        await db
          .delete(memberRole)
          .where(
            and(
              eq(memberRole.memberId, args.newMember.id),
              eq(memberRole.guildId, args.newMember.guild.id),
              ne(memberRole.roleId, restrictedRoleId),
            ),
          );
      }

      return;
    }

    // Check if role is a status role; if yes, remove unused status roles
    if (STATUS_ROLES.includes(newAddedRole)) {
      args.newMember.roles.cache.forEach(
        (role) =>
          newAddedRole !== role.name &&
          STATUS_ROLES.includes(role.name) &&
          args.newMember.roles.remove(role),
      );
    }

    // Check if level roles are added
    if (LEVEL_ROLES.includes(newAddedRole)) {
      const levelRole = LEVEL_LIST.find((role) => role.role === newAddedRole);
      if (!levelRole) return;

      const [result] = await db
        .select({ count: count() })
        .from(memberMessages)
        .where(
          and(
            eq(memberMessages.memberId, args.newMember?.id),
            eq(memberMessages.guildId, args.newMember?.guild?.id),
          ),
        );

      const memberMessagesCount = result?.count ?? 0;
      const role = args.newMember.guild.roles.cache.find(
        (role) => role.name === newAddedRole,
      );
      if (memberMessagesCount < levelRole.count && role) {
        args.newMember.roles.remove(role);
      }
    }
  }

  // Strip every role except the restricted one, re-apply it if Discord dropped
  // it, and clear the member's other roles from the DB.
  private static async reapplyRestrictedRole(
    args: UpdateDbRolesArgs,
    restrictedRoleName: string,
  ) {
    for (const role of args.newMember.roles.cache.values()) {
      if (role.name === restrictedRoleName) continue;
      await args.newMember.roles.remove(role).catch(() => {});
    }

    // resolve role ID from guild cache (more reliable than member cache)
    const restrictedRoleId = args.guildRoles.find(
      (role) => role.name === restrictedRoleName,
    )?.id;

    // guard against undefined role ID to avoid nuking all DB roles
    if (!restrictedRoleId) return;

    if (
      !args.newMember.roles.cache.some(
        (role) => role.name === restrictedRoleName,
      )
    )
      await args.newMember.roles.add(restrictedRoleId).catch(() => {});

    await db
      .delete(memberRole)
      .where(
        and(
          eq(memberRole.memberId, args.newMember.id),
          eq(memberRole.guildId, args.newMember.guild.id),
          ne(memberRole.roleId, restrictedRoleId),
        ),
      );
  }

  static getGuildStatusRoles(guild: Guild) {
    let guildStatusRoles: {
      [x: string]: Role | undefined;
    } = {};
    //check for verified roles "verified", "voiceOnly", "readOnly", "mute"
    for (let role of STATUS_ROLES)
      guildStatusRoles[role] = guild?.roles.cache.find(
        ({ name }) => name === role,
      );
    return guildStatusRoles;
  }

  static async handleHelperReaction(
    params: HandleHelperReactionParams,
  ): Promise<boolean> {
    if (params.threadOwnerId !== params.thankerUserId) return false;
    if (params.helperId === params.thankerUserId) return false;

    const isHelpedThread = await db.query.memberHelper.findFirst({
      where: and(
        eq(memberHelper.threadId, params.threadId),
        eq(memberHelper.threadOwnerId, params.threadOwnerId),
      ),
    });
    if (isHelpedThread) return false;

    await db.insert(memberHelper).values({
      memberId: params.helperId,
      guildId: params.guildId,
      threadId: params.threadId,
      threadOwnerId: params.threadOwnerId,
    });

    await RolesService.helperRoleChecker(params.message);
    return true;
  }

  static async helperRoleChecker(message: Message<boolean>) {
    if (!ConfigValidator.isFeatureEnabled("HELPER_ROLES")) {
      if (!this._helperSystemWarningLogged) {
        ConfigValidator.logFeatureDisabled(
          "Helper Role System",
          "HELPER_ROLES",
        );
        this._helperSystemWarningLogged = true;
      }
      return;
    }

    const guildMember = message.member!.partial
      ? await message.member!.fetch()
      : message.member!;
    const memberRoles = guildMember.roles.cache;

    const [result] = await db
      .select({ count: count() })
      .from(memberHelper)
      .where(eq(memberHelper.memberId, guildMember.id));

    const helpCount = result?.count ?? 0;

    //check if user has helper role
    const hasHelperRole = memberRoles.some((role) =>
      HELPER_ROLES.includes(role.name as (typeof HELPER_ROLES)[number]),
    );
    if (!hasHelperRole) return;

    //remove roles
    for (const role of memberRoles.values()) {
      if (HELPER_ROLES.includes(role.name as (typeof HELPER_ROLES)[number])) {
        try {
          await guildMember.roles.remove(role);
        } catch (_) {}
      }
    }

    //add role
    const helperRole = HELPER_RANKING.find((role) => role.points <= helpCount);
    if (helperRole) {
      try {
        const roleToAdd = memberRoles.get(helperRole.name);
        if (!roleToAdd || !roleToAdd.editable) return;

        await guildMember.roles.add(helperRole.name);
      } catch (_) {}
      (message.channel as TextChannel).send(
        `Congratulations ${guildMember.toString()} you are now ${
          helperRole.name
        } 🎉`,
      );
    }
  }
}
