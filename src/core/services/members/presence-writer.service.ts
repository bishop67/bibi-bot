import { db, isDatabaseUnavailable } from "@/lib/db";
import { botLogger } from "@/lib/telemetry";
import { sql } from "drizzle-orm";

/**
 * How long presence changes are collected before being written, or 0 to stop
 * persisting presence altogether.
 *
 * This is the quota dial, so it is worth stating the arithmetic. A serverless
 * Postgres compute only suspends after a stretch with no queries at all - five
 * minutes on Neon - and is billed for the whole time it is awake rather than
 * for the work done. Each flush therefore costs about five minutes of compute
 * no matter how small it is, which means the interval has to be several times
 * that window or the flushes simply chain into each other and the compute
 * never sleeps.
 *
 * At thirty minutes presence costs roughly five awake minutes in every thirty
 * - about a sixth of the month, or 30 of the 100 CU-hours a Neon free project
 * gets. That is a sixth of the budget spent on two columns nothing reads in
 * real time, so setting PRESENCE_FLUSH_INTERVAL_MS=0 to drop the feature
 * entirely is a perfectly reasonable trade and is the first thing to reach for
 * if the quota is still tight.
 */
const FLUSH_INTERVAL_MS = Number(
  process.env.PRESENCE_FLUSH_INTERVAL_MS ?? 30 * 60_000,
);

const PRESENCE_PERSISTENCE_ENABLED =
  Number.isFinite(FLUSH_INTERVAL_MS) && FLUSH_INTERVAL_MS > 0;

/**
 * Postgres caps a statement at 65535 bound parameters and each row here binds
 * five, so large buffers go out in several statements.
 */
const MAX_ROWS_PER_STATEMENT = 500;

type BufferedPresence = {
  memberId: string;
  guildId: string;
  status: string | null;
  activity: string | null;
  updatedAt: string;
};

/**
 * Collects presence changes in memory and writes them in batches.
 *
 * presenceUpdate is by far the loudest event Discord sends - every member
 * going idle, every game starting, every status flip - and each one used to
 * queue a full member resync: two forced Discord fetches followed by an upsert
 * of the member, an upsert of the guild membership, and a delete-and-reinsert
 * of every role that member holds. Five statements to store two columns that
 * nothing reads in real time, at a rate that guaranteed the database was never
 * idle long enough to suspend.
 *
 * Presence only ever touches presenceStatus, presenceActivity and
 * presenceUpdatedAt, so it is handled here instead: coalesced per member, so a
 * member who flips status twenty times in a window costs one row, and written
 * as a single statement per flush.
 */
export class PresenceWriterService {
  private static buffer = new Map<string, BufferedPresence>();
  private static flushTimer: NodeJS.Timeout | null = null;
  private static flushing = false;

  static record(
    memberId: string,
    guildId: string,
    status: string | null,
    activity: string | null,
  ) {
    // Buffering while persistence is off would grow a map nothing ever drains.
    if (!PRESENCE_PERSISTENCE_ENABLED) return;

    this.buffer.set(`${guildId}:${memberId}`, {
      memberId,
      guildId,
      status,
      activity,
      // The moment the change was seen, not the moment it is written - the two
      // are up to a flush interval apart, and the first one is the true one.
      updatedAt: new Date().toISOString(),
    });
  }

  static start() {
    if (this.flushTimer) return;

    if (!PRESENCE_PERSISTENCE_ENABLED) {
      botLogger.info(
        "Presence writer disabled: presence columns will keep their last written values",
      );
      return;
    }

    this.flushTimer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);

    botLogger.info("Presence writer started", {
      flushIntervalMs: FLUSH_INTERVAL_MS,
    });
  }

  static async stop() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Shutdown is the one flush worth waiting for: whatever is buffered is
    // lost otherwise, and there is no next interval to catch it.
    await this.flush();
  }

  static async flush() {
    // No buffered changes means no statement. This is the whole point of the
    // service - an empty tick has to stay completely silent, because a query
    // sent just to find nothing to do still counts as compute activity and
    // still resets the suspend timer.
    if (this.flushing || this.buffer.size === 0) return;

    this.flushing = true;

    const pending = [...this.buffer.values()];
    this.buffer.clear();

    try {
      for (let i = 0; i < pending.length; i += MAX_ROWS_PER_STATEMENT) {
        await this.writeBatch(pending.slice(i, i + MAX_ROWS_PER_STATEMENT));
      }
    } catch (err) {
      // Presence is disposable - the gateway sends the current state again on
      // the next change, and on reconnect. Replaying a failed batch into a
      // database that is already refusing work would spend quota to write
      // values that are about to be superseded anyway, so it is dropped.
      if (isDatabaseUnavailable(err)) {
        botLogger.warn("Skipped presence flush: database unavailable", {
          dropped: pending.length,
        });
      } else {
        botLogger.error("Failed to flush presence updates", {
          dropped: pending.length,
          error: String(err),
        });
      }
    } finally {
      this.flushing = false;
    }
  }

  /**
   * One UPDATE ... FROM (VALUES ...) per batch rather than one statement per
   * member.
   *
   * It has to be an update rather than an upsert: MemberGuild.status is NOT
   * NULL and the row is owned by the join and leave handlers, so inventing one
   * here for a member the bot has not recorded yet would either fail the
   * constraint or resurrect somebody who left. A member with no row simply
   * matches nothing, which is the correct outcome.
   */
  private static async writeBatch(rows: BufferedPresence[]) {
    // Every value is cast explicitly. Bound parameters inside a VALUES list
    // have no surrounding context to infer a type from, and a column that
    // happens to be null in every row of a batch - nobody playing anything -
    // fails outright with "could not determine data type of parameter".
    const values = rows.map(
      (row) =>
        sql`(${row.memberId}::text, ${row.guildId}::text, ${row.status}::text, ${row.activity}::text, ${row.updatedAt}::timestamp(3))`,
    );

    await db.execute(sql`
      update "MemberGuild" as mg
      set "presenceStatus" = v.status,
          "presenceActivity" = v.activity,
          "presenceUpdatedAt" = v."updatedAt"
      from (values ${sql.join(values, sql`, `)})
        as v("memberId", "guildId", status, activity, "updatedAt")
      where mg."memberId" = v."memberId"
        and mg."guildId" = v."guildId"
    `);
  }
}
