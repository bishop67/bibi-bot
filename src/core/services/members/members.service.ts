import { logEmbed } from "@/core/embeds/log.embed";
import { simpleEmbedExample } from "@/core/embeds/simple.embed";
import { ServerLogService } from "@/core/services/logging/server-log.service";
import { db } from "@/lib/db";
import { botLogger } from "@/lib/telemetry";
import { member, memberGuild, memberRole, guild } from "@/lib/db-schema";
import { and, eq, notInArray } from "drizzle-orm";
import {
  JOIN_EVENT_CHANNELS,
  MEMBERS_COUNT_CHANNELS,
} from "@/shared/config/channels";
import { ConfigValidator } from "@/shared/config/validator";
import { generateChart } from "@/shared/utils/chart.utils";
import { getDaysArray } from "@/shared/utils/date.utils";
import { ChartDataPoint, GuildMemberCountChart } from "@/types";
import { log } from "console";
import dayjs from "dayjs";
import {
  Guild,
  GuildMember,
  PartialGuildMember,
  TextChannel,
  VoiceState,
} from "discord.js";

export class MembersService {
  private static _memberCountWarningLogged = false;

  static async upsertDbMember(
    discordMember: GuildMember | PartialGuildMember,
    status: "join" | "leave",
  ) {
    // dont add bots to the list
    if (discordMember.user.bot) return;

    // No feature check here on purpose. This used to return early unless
    // SHOULD_COUNT_MEMBERS and MEMBERS_COUNT_CHANNELS were both set, which are
    // display settings for the count channel - turning that channel off also
    // stopped every member being recorded at all. Nothing downstream expects
    // that: the invite-link filter only moderates members holding a MemberGuild
    // row, so switching off a cosmetic channel quietly switched off automod
    // with it. The count channel does its own check, in updateMemberCount.

    // get member info
    const memberId = discordMember.id;
    const guildId = discordMember.guild.id;
    const username = discordMember.user.username;

    // create or update member, fetch roles if exist
    const [dbMember] = await db
      .insert(member)
      .values({ memberId, username })
      .onConflictDoUpdate({
        target: member.memberId,
        set: { username },
      })
      .returning();

    // Get member roles (scoped to this guild - role IDs aren't valid across guilds)
    const dbMemberRoles = await db.query.memberRole.findMany({
      where: and(
        eq(memberRole.memberId, memberId),
        eq(memberRole.guildId, guildId),
      ),
    });

    // create or update member guild
    const memberGuildData = {
      memberId,
      guildId,
      status: status === "join",
      ...(status === "leave" && {
        presenceStatus: "offline",
        presenceUpdatedAt: new Date().toISOString(),
      }),
    };

    await db
      .insert(memberGuild)
      .values(memberGuildData)
      .onConflictDoUpdate({
        target: [memberGuild.memberId, memberGuild.guildId],
        set: memberGuildData,
      });

    // if user joined and already has db roles assign them
    if (status === "join" && dbMemberRoles.length)
      for (let role of dbMemberRoles) {
        if (discordMember.roles.cache.has(role.roleId)) continue;

        const roleToAdd = discordMember.guild.roles.cache.get(role.roleId);
        if (!roleToAdd || !roleToAdd.editable) {
          continue;
        }

        try {
          await discordMember.roles.add(role.roleId);
        } catch (error) {
          await db
            .delete(memberRole)
            .where(
              and(
                eq(memberRole.memberId, memberId),
                eq(memberRole.roleId, role.roleId),
              ),
            );
        }
      }

    // return user
    return { ...dbMember, roles: dbMemberRoles };
  }

  // Accepts a partial member because guildMemberRemove often delivers one -
  // only user and guild are read, both of which are present either way.
  static async logJoinLeaveEvents(
    discordMember: GuildMember | PartialGuildMember,
    event: "join" | "leave",
  ) {
    try {
      if (!ConfigValidator.isFeatureEnabled("JOIN_EVENT_CHANNELS")) {
        return;
      }

      // get voice channel by name
      const joinEventsChannel = discordMember.guild.channels.cache.find(
        ({ name }) => JOIN_EVENT_CHANNELS.includes(name),
      );

      // check if voice channel exists and it is voice channel
      if (!joinEventsChannel || !joinEventsChannel.isTextBased()) return;

      const userServerName = discordMember?.user.toString();
      const userGlobalName = discordMember?.user.username;

      // Kicks are not here: they are reported by the mod log, which names the
      // moderator and the reason, so a second notice would double-report.
      const copy = {
        join: { tone: "positive", title: "Joined the server", footer: "join" },
        leave: { tone: "negative", title: "Left the server", footer: "leave" },
      }[event];

      const joinEmbed = logEmbed({
        tone: copy.tone as "positive" | "negative",
        user: discordMember.user,
        title: copy.title,
        lines: [`${userServerName} (${userGlobalName})`],
        footer: copy.footer,
      });

      // send embed event to voice channel
      (joinEventsChannel as TextChannel).send({
        embeds: [joinEmbed],
        allowedMentions: { users: [], roles: [] },
      });
    } catch (_) {}
  }

  /**
   * Mark everyone the guild no longer holds as gone.
   *
   * guildMemberRemove is the only thing that ever set status false for one
   * member, and it cannot fire for a departure that happens while the bot is
   * down or disconnected - so those members stay marked present forever. The
   * count channel reads Discord's roster and is unaffected, but anything
   * trusting this column is not.
   *
   * Takes the whole roster including bots. Building it from humans alone would
   * mark every bot in the server as departed.
   */
  static async markAbsentMembers(
    guildId: string,
    presentIds: string[],
    expectedCount: number,
  ) {
    // An empty roster means the fetch failed rather than that the server
    // emptied, and acting on it would mark the entire guild gone.
    if (!presentIds.length) return;

    // The dangerous input is not an empty roster but a truncated one: a fetch
    // that returns five of seventy-two would read as sixty-seven departures and
    // mark them all absent. guild.memberCount comes from the gateway rather
    // than from the fetch, so it is an independent check on whether the roster
    // actually arrived whole. Refuse rather than guess.
    if (presentIds.length < expectedCount) {
      botLogger.warn(
        "Skipped the member reconciliation: the roster looks incomplete",
        { guildId, fetched: presentIds.length, expected: expectedCount },
      );
      return;
    }

    const result = await db
      .update(memberGuild)
      .set({ status: false })
      .where(
        and(
          eq(memberGuild.guildId, guildId),
          eq(memberGuild.status, true),
          notInArray(memberGuild.memberId, presentIds),
        ),
      )
      .returning({ memberId: memberGuild.memberId });

    if (result.length)
      botLogger.info("Marked members absent that left while offline", {
        guildId,
        count: result.length,
      });
  }

  static async updateMemberCount(
    discordMember: GuildMember | PartialGuildMember,
  ) {
    if (discordMember.user.bot) return;

    // The feature check belongs here, where the only thing it can switch off is
    // the count channel itself.
    if (
      !ConfigValidator.isFeatureEnabled("SHOULD_COUNT_MEMBERS") ||
      !ConfigValidator.isFeatureEnabled("MEMBERS_COUNT_CHANNELS")
    ) {
      if (!this._memberCountWarningLogged) {
        ConfigValidator.logFeatureDisabled(
          "Member Count Display",
          !ConfigValidator.isFeatureEnabled("SHOULD_COUNT_MEMBERS")
            ? "SHOULD_COUNT_MEMBERS"
            : "MEMBERS_COUNT_CHANNELS",
        );
        this._memberCountWarningLogged = true;
      }
      return;
    }

    // await member count - use cache if fetch fails due to rate limit
    try {
      await discordMember.guild.members.fetch();
    } catch {
      // Rate limited, continue with cached members
    }

    for (const channelName of MEMBERS_COUNT_CHANNELS) {
      // find member: channel
      const memberCountChannel = discordMember.guild.channels.cache.find(
        (channel) => channel.name.includes(channelName),
      );

      // if no channel return
      if (!memberCountChannel) continue;

      // count members exc
      const memberCount = discordMember.guild.members.cache.filter(
        (m) => !m.user.bot,
      ).size;

      const nextName = `${channelName} ${memberCount}`;

      // Discord allows two channel renames per ten minutes. Spending one of
      // them writing the name it already has means a real change minutes later
      // is the one that gets refused, so an unchanged count is left alone.
      if (memberCountChannel.name === nextName) continue;

      try {
        await memberCountChannel.setName(nextName);
      } catch (e) {
        // Swallowing this left the count silently stale with nothing anywhere
        // to say the rename had been refused.
        botLogger.warn("Could not update the member count channel", {
          guildId: discordMember.guild.id,
          channel: memberCountChannel.name,
          wanted: nextName,
          error: String(e),
        });
      }
    }
  }

  // Shared logic for computing member stats and generating chart
  private static async computeMemberStats(discordGuild: Guild) {
    const guildId = discordGuild.id;
    const guildName = discordGuild.name;

    // create or update guild
    const [guildData] = await db
      .insert(guild)
      .values({ guildId, guildName })
      .onConflictDoUpdate({
        target: guild.guildId,
        set: { guildName },
      })
      .returning();

    const lookback = guildData.lookback;

    // get member join dates and sort ascending - use cache if fetch fails due to rate limit
    let members;
    try {
      members = await discordGuild.members.fetch();
    } catch {
      // Rate limited, use cached members
      members = discordGuild.members.cache;
    }
    const dates = members
      .map((m) => m.joinedAt || new Date())
      .sort((a, b) => a.getTime() - b.getTime());

    // if no dates, return null
    if (!dates[0]) return null;

    // create date array from first to today for each day
    const startEndDateArray = getDaysArray(
      dates[0],
      dayjs().add(1, "day").toDate(),
    );

    // O(n) algorithm: use sorted dates with a running pointer instead of O(n²) filter
    const datesArray = Array.from(dates);
    let datePointer = 0;
    const data: ChartDataPoint[] = [];

    for (const date of startEndDateArray) {
      const currentDay = dayjs(date);
      // Move pointer forward while dates are <= current day
      while (
        datePointer < datesArray.length &&
        dayjs(datesArray[datePointer]) <= currentDay
      ) {
        datePointer++;
      }
      data.push({
        x: currentDay.toDate(),
        y: datePointer,
      });
    }

    let thirtyDaysCount = data[data.length - 1]?.y ?? 0;
    let sevenDaysCount = data[data.length - 1]?.y ?? 0;
    let oneDayCount = data[data.length - 1]?.y ?? 0;

    // count total members for date ranges
    if (data.length > 31)
      thirtyDaysCount = data[data.length - 1]!.y - data[data.length - 30]!.y;
    if (data.length > 8)
      sevenDaysCount = data[data.length - 1]!.y - data[data.length - 7]!.y;
    if (data.length > 3)
      oneDayCount = data[data.length - 1]!.y - data[data.length - 2]!.y;

    return {
      guildId,
      guildName,
      lookback,
      data,
      thirtyDaysCount,
      sevenDaysCount,
      oneDayCount,
      memberCount: data[data.length - 1]?.y ?? 0,
    };
  }

  // Generate chart and return buffer
  private static async generateChartBuffer(
    data: ChartDataPoint[],
    lookback: number,
  ): Promise<Buffer> {
    const sliceStart = data.length - 2 < lookback ? 0 : -lookback;
    return generateChart(data.slice(sliceStart));
  }

  static async guildMemberCountChart(
    discordGuild: Guild,
  ): Promise<GuildMemberCountChart> {
    const stats = await this.computeMemberStats(discordGuild);

    if (!stats) return { error: "No members found" };

    const buffer = await this.generateChartBuffer(stats.data, stats.lookback);

    log(`Created guild member count ${stats.guildName}`);

    return {
      buffer,
      fileName: `${stats.guildId}.png`,
      thirtyDaysCount: stats.thirtyDaysCount,
      sevedDaysCount: stats.sevenDaysCount,
      oneDayCount: stats.oneDayCount,
      lookback: stats.lookback,
    };
  }

  // Returns member stats with base64 chart for API usage
  static async getMembersStatsForApi(discordGuild: Guild) {
    const stats = await this.computeMemberStats(discordGuild);

    if (!stats) {
      const guildData = await db.query.guild.findFirst({
        where: eq(guild.guildId, discordGuild.id),
      });

      return {
        thirtyDaysCount: 0,
        sevenDaysCount: 0,
        oneDayCount: 0,
        lookback: guildData?.lookback ?? 9999,
        memberCount: 0,
        chart: "",
      };
    }

    const buffer = await this.generateChartBuffer(stats.data, stats.lookback);
    const base64Chart = `data:image/png;base64,${buffer.toString("base64")}`;

    log(`Created guild member count for API ${stats.guildName}`);

    return {
      thirtyDaysCount: stats.thirtyDaysCount,
      sevenDaysCount: stats.sevenDaysCount,
      oneDayCount: stats.oneDayCount,
      lookback: stats.lookback,
      memberCount: stats.memberCount,
      chart: base64Chart,
    };
  }

  // Lookback methods
  static async setMemberLookback(
    memberId: string,
    guildId: string,
    lookback: number,
  ): Promise<void> {
    await db
      .insert(memberGuild)
      .values({ guildId, lookback, memberId, status: true })
      .onConflictDoUpdate({
        target: [memberGuild.memberId, memberGuild.guildId],
        set: { lookback },
      });
  }

  /**
   * Ensure the Guild row exists.
   *
   * MemberGuild, MemberRole and the rest all carry foreign keys to Guild, so
   * nothing about a member can be written until this row is there. Only the
   * stats, lookback and verify-users paths created it, none of which run at
   * startup - so on a database that had never run one of them every member
   * write failed with a foreign key violation.
   */
  static async upsertDbGuild(discordGuild: Guild): Promise<void> {
    await db
      .insert(guild)
      .values({ guildId: discordGuild.id, guildName: discordGuild.name })
      .onConflictDoUpdate({
        target: guild.guildId,
        set: { guildName: discordGuild.name },
      });
  }

  static async setGuildLookback(
    guildId: string,
    guildName: string,
    lookback: number,
  ): Promise<void> {
    await db
      .insert(guild)
      .values({ guildId, guildName, lookback })
      .onConflictDoUpdate({
        target: guild.guildId,
        set: { guildName, lookback },
      });
  }

  // Nickname methods
  static async updateNickname(
    oldMember: GuildMember | PartialGuildMember,
    newMember: GuildMember | PartialGuildMember,
  ) {
    if (oldMember.user.bot) return;

    if (oldMember.nickname !== newMember.nickname) {
      await ServerLogService.logNicknameChange(
        newMember.guild,
        newMember.user,
        oldMember.nickname ?? null,
        newMember.nickname ?? null,
      );

      const memberGuildData = await db.query.memberGuild.findFirst({
        where: and(
          eq(memberGuild.guildId, newMember.guild.id),
          eq(memberGuild.memberId, newMember.id),
        ),
      });
      if (memberGuildData) {
        await db
          .update(memberGuild)
          .set({ nickname: newMember.nickname })
          .where(eq(memberGuild.id, memberGuildData.id));
      }
    }
  }

  static async joinSettings(
    discordMember: GuildMember | PartialGuildMember,
    voiceState?: VoiceState,
  ) {
    // dont add bots to the list
    if (discordMember && discordMember?.user?.bot) return;

    const guildMember = await db.query.memberGuild.findFirst({
      where: and(
        eq(
          memberGuild.guildId,
          voiceState?.guild.id || discordMember?.guild.id,
        ),
        eq(
          memberGuild.memberId,
          discordMember?.id || voiceState?.member?.id || "",
        ),
      ),
    });

    if (guildMember && discordMember) {
      const fetchedMember = discordMember.partial
        ? await discordMember.fetch()
        : discordMember;

      if (
        guildMember.nickname &&
        guildMember.nickname !== fetchedMember.nickname
      ) {
        await fetchedMember.setNickname(guildMember.nickname);
      }

      if (voiceState?.channelId) {
        if (fetchedMember.voice.serverMute !== guildMember.muted)
          await fetchedMember.voice.setMute(guildMember.muted);

        if (fetchedMember.voice.serverDeaf !== guildMember.deafened)
          await fetchedMember.voice.setDeaf(guildMember.deafened);
      }
    }
  }
}
