import type { ArgsOf } from "discordx";
import { Discord, On } from "discordx";
import { PresenceWriterService } from "@/core/services/members/presence-writer.service";

@Discord()
export class PresenceUpdate {
  @On()
  async presenceUpdate([oldPresence, newPresence]: ArgsOf<"presenceUpdate">) {
    if (!newPresence.member || !newPresence.guild) return;

    const status = newPresence.status;
    const activity = newPresence.activities[0]?.name ?? null;

    // Discord re-sends a presence whenever any detail of an activity changes -
    // a Spotify track advancing its timestamp is a presenceUpdate - and none
    // of that reaches the two columns actually stored. Filtering here is what
    // turns a continuous stream of events into the handful of real changes.
    if (
      oldPresence &&
      oldPresence.status === status &&
      (oldPresence.activities[0]?.name ?? null) === activity
    ) {
      return;
    }

    // This used to queue a full member resync, which re-fetched the member
    // from Discord and rewrote their profile, guild membership and entire role
    // set just to record that they went idle. Nothing about a presence change
    // can alter any of that: a new nickname, avatar or role arrives as
    // guildMemberUpdate or userUpdate, and both still queue a resync.
    PresenceWriterService.record(
      newPresence.member.id,
      newPresence.guild.id,
      status,
      activity,
    );
  }
}
