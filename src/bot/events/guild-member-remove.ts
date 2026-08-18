import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import { MembersService } from "@/core/services/members/members.service";

@Discord()
export class GuildMemberRemove {
  @On()
  async guildMemberRemove(
    [member]: ArgsOf<"guildMemberRemove">,
    client: Client,
  ) {
    // post the leave notice to the join/leave channel
    await MembersService.logJoinLeaveEvents(member, "leave");

    // create or update user with his roles
    await MembersService.upsertDbMember(member, "leave");

    // update user count channel
    await MembersService.updateMemberCount(member);
  }
}
