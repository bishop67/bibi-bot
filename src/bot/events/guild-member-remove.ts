import { MembersService } from "@/core/services/members/members.service";
import {
  AuditLogEvent,
  findAuditActor,
} from "@/core/services/moderation/audit-log";
import { ModLogService } from "@/core/services/moderation/modlog.service";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";

@Discord()
export class GuildMemberRemove {
  @On()
  async guildMemberRemove(
    [member]: ArgsOf<"guildMemberRemove">,
    client: Client,
  ) {
    // Discord fires this identically for a leave, a kick and a ban. Without
    // asking the audit log, every departure reads as voluntary.
    const banned = await findAuditActor(
      member.guild,
      AuditLogEvent.MemberBanAdd,
      member.id,
    );

    if (banned) {
      // guildBanAdd already logged it with the moderator and reason; posting a
      // departure notice too would double-report the same event.
      await MembersService.upsertDbMember(member, "leave");
      await MembersService.updateMemberCount(member);
      return;
    }

    const kicked = await findAuditActor(
      member.guild,
      AuditLogEvent.MemberKick,
      member.id,
    );

    if (kicked) {
      await ModLogService.postLog({
        guild: member.guild,
        action: "kick",
        targetId: member.id,
        targetName: member.user.username,
        moderatorId: kicked.moderatorId,
        moderatorName: kicked.moderatorName,
        reason: kicked.reason,
      });
    }

    await MembersService.logJoinLeaveEvents(member, kicked ? "kick" : "leave");

    // create or update user with his roles
    await MembersService.upsertDbMember(member, "leave");

    // update user count channel
    await MembersService.updateMemberCount(member);
  }
}
