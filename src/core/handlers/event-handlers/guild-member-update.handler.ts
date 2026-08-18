import type { GuildMember, PartialGuildMember } from "discord.js";
import { EVERYONE } from "@/shared/config/roles";
import { MemberUpdateQueueService } from "@/core/services/members/member-update-queue.service";
import { MembersService } from "@/core/services/members/members.service";
import { RolesService } from "@/core/services/roles/roles.service";
import {
  AuditLogEvent,
  findAuditActor,
} from "@/core/services/moderation/audit-log";
import { ModLogService } from "@/core/services/moderation/modlog.service";
import { db } from "@/lib/db";
import { memberRole } from "@/lib/db-schema";
import { and, eq } from "drizzle-orm";

export async function handleGuildMemberUpdate(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember,
): Promise<void> {
  
  const guildRoles = newMember.guild.roles.cache;
  const memberDbRoles = await db.query.memberRole.findMany({
    where: and(
      eq(memberRole.memberId, newMember.id),
      eq(memberRole.guildId, newMember.guild.id),
    ),
  });

  const oldRoles = oldMember.roles.cache
    .filter(({ name }) => name !== EVERYONE)
    .map((role) => role);

  const newRoles = newMember.roles.cache
    .filter(({ name }) => name !== EVERYONE)
    .map((role) => role);

  await RolesService.updateDbRoles({
    oldMember,
    newMember,
    oldRoles,
    newRoles,
    guildRoles,
    memberDbRoles,
  });

  await RolesService.updateStatusRoles({
    oldMember,
    newMember,
    oldRoles,
    newRoles,
    guildRoles,
    memberDbRoles,
  });

  MembersService.updateNickname(oldMember, newMember);

  await logTimeoutChange(oldMember, newMember);

  MemberUpdateQueueService.queueMemberUpdate(newMember.id, newMember.guild.id);
}

/**
 * Discord has no dedicated timeout event - a timeout is just a field change on
 * guildMemberUpdate, so it has to be spotted by comparing the two members and
 * then attributed via the audit log.
 */
async function logTimeoutChange(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember,
): Promise<void> {
  const before = oldMember.communicationDisabledUntilTimestamp ?? null;
  const after = newMember.communicationDisabledUntilTimestamp ?? null;

  if (before === after) return;

  // An expiring timeout also clears the field, but nobody did that - only
  // report a removal when it was still in force.
  const wasActive = before !== null && before > Date.now();
  const isActive = after !== null && after > Date.now();

  if (!isActive && !wasActive) return;

  const actor = await findAuditActor(
    newMember.guild,
    AuditLogEvent.MemberUpdate,
    newMember.id,
  );

  await ModLogService.postLog({
    guild: newMember.guild,
    action: isActive ? "timeout" : "untimeout",
    targetId: newMember.id,
    targetName: newMember.user.username,
    moderatorId: actor?.moderatorId,
    moderatorName: actor?.moderatorName,
    reason: isActive
      ? `${actor?.reason ?? "No reason provided"} (until <t:${Math.floor((after as number) / 1000)}:f>)`
      : actor?.reason,
  });
}
