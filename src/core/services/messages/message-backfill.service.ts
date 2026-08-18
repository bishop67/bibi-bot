import { db } from "@/lib/db";
import { member, memberMessages, syncProgress } from "@/lib/db-schema";
import { botLogger } from "@/lib/telemetry";
import { and, eq } from "drizzle-orm";
import {
  ChannelType,
  DiscordAPIError,
  ForumChannel,
  Guild,
  GuildTextBasedChannel,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";

const SYNC_TYPE = "messages";
const PAGE_SIZE = 100;
// Fetched per channel and inserted in one statement. Large enough that a busy
// channel is not thousands of round trips, small enough that an interrupted
// run loses little.
const INSERT_BATCH = 500;

/**
 * The default drizzle put on SyncProgress.processedIds. It is not a channel,
 * and treating it as one would skip nothing but does clutter the list.
 */
const PLACEHOLDER_ID = "RAY";

export interface BackfillProgress {
  channelsDone: number;
  channelsTotal: number;
  inserted: number;
  channelName: string;
}

export class MessageBackfillService {
  /**
   * Import a guild's existing message history into MemberMessages.
   *
   * The bot only ever counted what it saw live, so on a server that existed
   * before it did, every level starts at zero however long people have been
   * talking. This reads the backlog once so the counts mean what members
   * expect them to.
   *
   * Resumable by channel: Discord will not serve a whole busy server's history
   * inside one run without rate limiting, and losing an hour of paging to a
   * restart is worse than storing a list of channel ids.
   */
  static async backfillGuild(
    guild: Guild,
    onProgress?: (progress: BackfillProgress) => void,
  ): Promise<{ inserted: number; channelsDone: number; skipped: string[] }> {
    const { done, cursors } = await this.loadProgress(guild.id);
    const channels = await this.collectChannels(guild);
    const skipped: string[] = [];
    let inserted = 0;
    let channelsDone = 0;

    for (const channel of channels) {
      channelsDone++;

      if (done.has(channel.id)) continue;

      if (!this.canRead(channel, guild)) {
        skipped.push(channel.name);
        done.add(channel.id);
        await this.saveProgress(guild.id, done, cursors);
        continue;
      }

      // Reported before the work, not after: a channel with tens of
      // thousands of messages takes minutes, and saying nothing until it
      // finishes is indistinguishable from having hung.
      onProgress?.({
        channelsDone,
        channelsTotal: channels.length,
        inserted,
        channelName: channel.name,
      });

      try {
        inserted += await this.backfillChannel(
          channel,
          guild.id,
          cursors.get(channel.id),
          (soFar, cursor) => {
            onProgress?.({
              channelsDone,
              channelsTotal: channels.length,
              inserted: inserted + soFar,
              channelName: channel.name,
            });

            // Written every batch, not every page: the cost of a restart is
            // then a few hundred re-fetched messages instead of a channel of
            // twenty thousand starting over, which is what made the first two
            // attempts get nowhere.
            cursors.set(channel.id, cursor);
            return this.saveProgress(guild.id, done, cursors);
          },
        );
      } catch (err) {
        // A channel that cannot be read is not a reason to abandon the rest,
        // but it must not be marked done either - leaving it out means a
        // retry picks it up.
        botLogger.warn("Message backfill failed for channel", {
          guildId: guild.id,
          channelId: channel.id,
          channelName: channel.name,
          error: String(err),
        });
        skipped.push(channel.name);
        continue;
      }

      done.add(channel.id);
      cursors.delete(channel.id);
      await this.saveProgress(guild.id, done, cursors);
    }

    return { inserted, channelsDone, skipped };
  }

  /** Forget the recorded progress so the next run starts from the beginning. */
  static async resetProgress(guildId: string): Promise<void> {
    await db
      .delete(syncProgress)
      .where(
        and(
          eq(syncProgress.guildId, guildId),
          eq(syncProgress.type, SYNC_TYPE),
        ),
      );
  }

  /**
   * Recorded progress, in one text array because that is the column
   * SyncProgress already has.
   *
   * A bare id means the channel is finished. `id:messageId` means it was
   * interrupted partway and paging should resume from that message rather
   * than from the newest one again.
   */
  private static async loadProgress(guildId: string): Promise<{
    done: Set<string>;
    cursors: Map<string, string>;
  }> {
    const row = await db.query.syncProgress.findFirst({
      where: and(
        eq(syncProgress.guildId, guildId),
        eq(syncProgress.type, SYNC_TYPE),
      ),
    });

    const done = new Set<string>();
    const cursors = new Map<string, string>();

    for (const entry of row?.processedIds ?? []) {
      if (entry === PLACEHOLDER_ID) continue;

      const [channelId, cursor] = entry.split(":");
      if (cursor) cursors.set(channelId, cursor);
      else done.add(channelId);
    }

    return { done, cursors };
  }

  private static async saveProgress(
    guildId: string,
    done: Set<string>,
    cursors: Map<string, string>,
  ) {
    const processedIds = [
      ...done,
      ...[...cursors].map(([channelId, cursor]) => `${channelId}:${cursor}`),
    ];

    await db
      .insert(syncProgress)
      .values({ guildId, type: SYNC_TYPE, processedIds, failedIds: [] })
      .onConflictDoUpdate({
        target: [syncProgress.guildId, syncProgress.type],
        set: { processedIds, updatedAt: new Date().toISOString() },
      });
  }

  private static async collectChannels(
    guild: Guild,
  ): Promise<GuildTextBasedChannel[]> {
    const byId = new Map<string, GuildTextBasedChannel>();
    const parents: (TextChannel | ForumChannel)[] = [];

    for (const channel of guild.channels.cache.values()) {
      if (
        [
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.GuildVoice,
          ChannelType.GuildStageVoice,
          ChannelType.GuildMedia,
        ].includes(channel.type)
      ) {
        byId.set(channel.id, channel as GuildTextBasedChannel);
      }

      // A forum holds no messages of its own - its posts are threads - so it
      // is a parent to search rather than a channel to read.
      if (
        channel.type === ChannelType.GuildForum ||
        channel.type === ChannelType.GuildText ||
        channel.type === ChannelType.GuildAnnouncement ||
        channel.type === ChannelType.GuildMedia
      ) {
        parents.push(channel as TextChannel | ForumChannel);
      }
    }

    const active = await guild.channels.fetchActiveThreads().catch(() => null);
    for (const thread of active?.threads.values() ?? []) {
      byId.set(thread.id, thread as GuildTextBasedChannel);
    }

    for (const parent of parents) {
      for (const type of ["public", "private"] as const) {
        let before: string | undefined;

        for (;;) {
          const archived = await parent.threads
            .fetchArchived({ type, limit: 100, ...(before ? { before } : {}) })
            .catch(() => null);

          if (!archived || archived.threads.size === 0) break;

          for (const thread of archived.threads.values()) {
            byId.set(thread.id, thread as GuildTextBasedChannel);
          }

          if (!archived.hasMore) break;
          before = archived.threads.last()?.id;
          if (!before) break;
        }
      }
    }

    return [...byId.values()];
  }

  private static canRead(channel: GuildTextBasedChannel, guild: Guild) {
    const me = guild.members.me;
    if (!me) return false;

    const perms = channel.permissionsFor(me);
    return Boolean(
      perms?.has(PermissionFlagsBits.ViewChannel) &&
        perms.has(PermissionFlagsBits.ReadMessageHistory),
    );
  }

  private static async backfillChannel(
    channel: GuildTextBasedChannel,
    guildId: string,
    resumeFrom?: string,
    onBatch?: (insertedSoFar: number, cursor: string) => void | Promise<void>,
  ): Promise<number> {
    let before: string | undefined = resumeFrom;
    let inserted = 0;
    let batch: {
      id: string;
      memberId: string;
      guildId: string;
      messageId: string;
      channelId: string;
      createdAt: string;
    }[] = [];
    const authors = new Map<string, string>();

    const flush = async () => {
      if (!batch.length) return;

      // MemberMessages.memberId is a foreign key, so an author the bot has
      // never recorded would reject the whole batch. Anyone who posted here
      // belongs in Member regardless of whether they are still in the guild.
      await db
        .insert(member)
        .values(
          [...authors].map(([memberId, username]) => ({ memberId, username })),
        )
        .onConflictDoNothing();

      await db.insert(memberMessages).values(batch).onConflictDoNothing();

      inserted += batch.length;
      batch = [];
      authors.clear();
    };

    for (;;) {
      const page = await channel.messages
        .fetch({ limit: PAGE_SIZE, ...(before ? { before } : {}) })
        .catch((err) => {
          if (err instanceof DiscordAPIError && err.code === 10003) return null;
          throw err;
        });

      if (!page || page.size === 0) break;

      before = page.last()!.id;

      for (const message of page.values()) {
        if (message.author.bot) continue;
        if (!message.content) continue;

        authors.set(message.author.id, message.author.username);
        batch.push({
          id: message.id,
          memberId: message.author.id,
          guildId,
          messageId: message.id,
          channelId: message.channelId,
          // The real send time, not now - lookback windows and the member
          // flow chart both read this column.
          createdAt: new Date(message.createdTimestamp)
            .toISOString()
            .slice(0, 23)
            .replace("T", " "),
        });
      }

      if (batch.length >= INSERT_BATCH) {
        await flush();
        await onBatch?.(inserted, before);
      }

      if (page.size < PAGE_SIZE) break;
    }

    await flush();
    return inserted;
  }
}
