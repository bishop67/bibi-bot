import { botLogger } from "@/lib/telemetry";
import { AuditLogEvent, PermissionFlagsBits, type Guild } from "discord.js";
import { LRUCache } from "lru-cache";

/**
 * Entries older than this are treated as unrelated. Discord gives us no link
 * between a gateway event and an audit entry, so recency plus a matching
 * target is the only correlation available - too wide a window and an old ban
 * gets attributed to someone who just left of their own accord.
 */
const MAX_ENTRY_AGE_MS = 10_000;

/**
 * The audit log is eventually consistent: the entry frequently is not there
 * yet when the gateway event arrives. One short retry catches almost all of
 * them without delaying the log noticeably.
 */
const RETRY_DELAY_MS = 1200;

export interface AuditActor {
  moderatorId?: string;
  moderatorName?: string;
  reason?: string;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function lookup(
  guild: Guild,
  type: AuditLogEvent,
  targetId: string,
): Promise<AuditActor | null> {
  const logs = await guild.fetchAuditLogs({ type, limit: 5 });

  // The target union spans every audit-loggable entity, and a few of them
  // (Invite, for one) carry no id at all, so it has to be probed rather than
  // read directly.
  const entryTargetId = (target: unknown): string | undefined =>
    target && typeof target === "object" && "id" in target
      ? String((target as { id: unknown }).id)
      : undefined;

  const entry = logs.entries.find(
    (e) =>
      entryTargetId(e.target) === targetId &&
      Date.now() - e.createdTimestamp < MAX_ENTRY_AGE_MS,
  );

  if (!entry) return null;

  return {
    moderatorId: entry.executor?.id,
    moderatorName: entry.executor?.username ?? undefined,
    reason: entry.reason ?? undefined,
  };
}

/**
 * Find who performed an action on a member, and why.
 *
 * Discord fires the same guildMemberRemove whether somebody left, was kicked
 * or was banned - only the audit log distinguishes them, so without this every
 * departure looks voluntary.
 *
 * Returns null when nothing matches, which is the normal answer for a member
 * who simply left.
 */
export async function findAuditActor(
  guild: Guild,
  type: AuditLogEvent,
  targetId: string,
): Promise<AuditActor | null> {
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
    botLogger.warn(
      "Cannot read the audit log: missing View Audit Log. Kicks, bans and timeouts will be logged without a moderator or reason",
      { guildId: guild.id },
    );
    return null;
  }

  try {
    const first = await lookup(guild, type, targetId);
    if (first) return first;

    await wait(RETRY_DELAY_MS);
    return await lookup(guild, type, targetId);
  } catch (e) {
    botLogger.error("Audit log lookup failed", {
      guildId: guild.id,
      targetId,
      error: String(e),
    });
    return null;
  }
}

/**
 * How many of each MessageDelete audit entry's deletions we have already
 * attributed.
 *
 * Discord does not write a fresh entry per deleted message: removing several of
 * the same author's messages in one channel increments `count` on the existing
 * entry and leaves its id - and therefore its timestamp - alone. So "is this
 * entry recent?" answers the wrong question, and every delete after the first
 * looks stale and gets blamed on the author. Counting off deletions against
 * `extra.count` is what tells a genuine second delete from a self-delete that
 * merely happened to follow one.
 */
const messageDeleteCounts = new LRUCache<string, number>({ max: 500 });

export interface MessageDeleteActor {
  executorId: string;
  /**
   * The author whose message was removed, taken from the audit entry. Worth
   * having because an uncached message carries no author of its own.
   */
  authorId: string;
  authorIsBot: boolean;
}

/**
 * Who deleted somebody else's message, and whose message it was.
 *
 * Returns null when nothing matches, which is the normal answer for a
 * self-delete: Discord writes no audit entry when you remove your own message.
 *
 * `authorId` narrows the search when the message was cached; pass null for an
 * uncached one and any recent delete in that channel matches instead.
 */
export async function findMessageDeleteActor(
  guild: Guild,
  channelId: string,
  authorId: string | null,
): Promise<MessageDeleteActor | null> {
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
    botLogger.warn(
      "Cannot read the audit log: missing View Audit Log. Deleted messages will all be logged as self-deletions",
      { guildId: guild.id },
    );
    return null;
  }

  const attempt = async (): Promise<MessageDeleteActor | null> => {
    // Not limit: 1 - any unrelated delete elsewhere in the guild lands on top
    // and would hide the entry we want.
    const logs = await guild.fetchAuditLogs({
      type: AuditLogEvent.MessageDelete,
      limit: 10,
    });

    for (const entry of logs.entries.values()) {
      if (!entry.targetId || !entry.executor) continue;
      if (authorId && entry.targetId !== authorId) continue;
      if (entry.extra?.channel?.id !== channelId) continue;

      const count = entry.extra?.count ?? 0;
      const seen = messageDeleteCounts.get(entry.id);

      // `seen` is how many of this entry's deletions we have already handed
      // out, not the count we last read - a moderator removing three messages
      // at once produces three gateway events against one entry of count 3,
      // and all three deserve the moderator's name.
      if (seen !== undefined && count <= seen) continue;

      // Never seen it before, and nothing ties it to this delete except its
      // age - a count bump we witnessed is fresh evidence on its own, a first
      // sighting is not. Without this an entry left over from before a restart
      // would be charged to the next self-delete.
      if (
        seen === undefined &&
        Date.now() - entry.createdTimestamp > MAX_ENTRY_AGE_MS
      ) {
        messageDeleteCounts.set(entry.id, count);
        continue;
      }

      messageDeleteCounts.set(entry.id, (seen ?? 0) + 1);

      return {
        executorId: entry.executor.id,
        authorId: entry.targetId,
        authorIsBot: entry.target?.bot ?? false,
      };
    }

    return null;
  };

  try {
    const first = await attempt();
    if (first) return first;

    // The audit log is eventually consistent and the gateway event usually
    // wins the race, so without this retry most moderator deletions read as
    // self-deletions.
    await wait(RETRY_DELAY_MS);
    return await attempt();
  } catch (e) {
    botLogger.error("Message delete audit lookup failed", {
      guildId: guild.id,
      channelId,
      error: String(e),
    });
    return null;
  }
}

export { AuditLogEvent };
