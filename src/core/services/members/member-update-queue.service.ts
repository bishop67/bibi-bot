import { MemberDataService } from "@/core/services/members/member-data.service";
import { VerifyAllUsersService } from "@/core/services/members/verify-users.service";
import { bot } from "@/main";
import { db, isDatabaseUnavailable } from "@/lib/db";
import { memberUpdateQueue, memberGuild } from "@/lib/db-schema";
import { and, asc, eq } from "drizzle-orm";
import { error, log } from "console";

/** Spacing between items while the queue still has work, to pace both APIs. */
const PROCESS_INTERVAL_MS = 1000;

/** First wait after the database goes away; doubled on each further failure. */
const UNAVAILABLE_BASE_MS = 10_000;
const UNAVAILABLE_MAX_MS = 10 * 60_000;

/** A full verification run owns the guild, so there is no point racing it. */
const VERIFICATION_RETRY_MS = 30_000;

type Outcome =
  /** Nothing left to do - stop querying entirely until something is queued. */
  | "idle"
  /** An item was handled; come back after the usual spacing. */
  | "processed"
  /** Something else is working this guild; try again shortly. */
  | "paused"
  /** The database itself is unreachable; back off hard. */
  | "unavailable";

export class MemberUpdateQueueService {
  private static running = false;
  private static timer: NodeJS.Timeout | null = null;
  private static draining = false;
  private static consecutiveOutages = 0;

  static queueMemberUpdate(memberId: string, guildId: string, priority = 0) {
    db.insert(memberUpdateQueue)
      .values({ memberId, guildId, priority })
      .onConflictDoUpdate({
        target: [memberUpdateQueue.memberId, memberUpdateQueue.guildId],
        set: { priority },
      })
      // Waking on the write rather than on a clock is what lets the processor
      // go completely silent when there is nothing queued - see start().
      .then(() => this.schedule(PROCESS_INTERVAL_MS))
      .catch(() => {});
  }

  static start() {
    if (this.running) return;
    this.running = true;

    // This used to be a setInterval firing every second for the lifetime of
    // the process, which meant a SELECT every second whether or not anything
    // had been queued - around 2.6 million of them a month, all but a handful
    // finding an empty table. On a serverless Postgres that bills for the time
    // the compute is awake rather than for the work done, that single timer is
    // enough to hold the compute on permanently and burn the whole monthly
    // quota; it is what put the database over its limit.
    //
    // The queue is only ever written from inside this process, so a clock is
    // not needed to discover work: every enqueue wakes the drain directly.
    // One pass runs now to clear anything left behind by the last shutdown,
    // and once the table comes back empty the processor issues no queries at
    // all until the next enqueue - which is the silence the compute needs in
    // order to suspend.
    this.schedule(0);

    log("Member update queue processor started");
  }

  static stop() {
    this.running = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    log("Member update queue processor stopped");
  }

  /**
   * Books the next drain pass.
   *
   * An already-booked pass is never rescheduled. That matters most during an
   * outage: an enqueue arriving mid-backoff must not drag the retry forward to
   * a second from now, or a busy guild would defeat the backoff entirely and
   * go straight back to hammering a database that is already refusing work.
   */
  private static schedule(delayMs: number) {
    if (!this.running || this.draining || this.timer) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      // Nothing is awaiting this, so an escaping rejection would surface as an
      // unhandled rejection and, worse, leave nothing scheduled - the loop
      // would go quiet for good rather than retrying.
      this.drain().catch((err) => {
        error("Queue drain failed:", err);
        this.schedule(UNAVAILABLE_BASE_MS);
      });
    }, delayMs);
  }

  private static async drain() {
    if (!this.running || this.draining) return;
    this.draining = true;

    let outcome: Outcome;
    try {
      outcome = await this.processNextItem();
    } finally {
      this.draining = false;
    }

    switch (outcome) {
      case "idle":
        // Deliberately schedules nothing. The next enqueue restarts the loop.
        return;
      case "processed":
        return this.schedule(PROCESS_INTERVAL_MS);
      case "paused":
        return this.schedule(VERIFICATION_RETRY_MS);
      case "unavailable":
        return this.schedule(this.outageDelayMs());
    }
  }

  /** Exponential backoff, so an outage costs a handful of probes, not a flood. */
  private static outageDelayMs(): number {
    const delay = UNAVAILABLE_BASE_MS * 2 ** (this.consecutiveOutages - 1);
    return Math.min(delay, UNAVAILABLE_MAX_MS);
  }

  private static async processNextItem(): Promise<Outcome> {
    // Kept outside the try so a failure can still identify the row - see the
    // catch below.
    let currentItemId: number | null = null;

    try {
      const item = await db.query.memberUpdateQueue.findFirst({
        orderBy: asc(memberUpdateQueue.createdAt),
      });

      this.consecutiveOutages = 0;

      if (!item) return "idle";

      currentItemId = item.id;

      // Left in place rather than deleted: the verification run rewrites this
      // member anyway, and the row is the reminder to catch up afterwards.
      if (VerifyAllUsersService.isVerificationRunning(item.guildId)) {
        return "paused";
      }

      const deleteItem = () =>
        db
          .delete(memberUpdateQueue)
          .where(eq(memberUpdateQueue.id, item.id))
          .catch((e) => error("Failed to remove queue item:", e));

      const guild = bot.guilds.cache.get(item.guildId);
      if (!guild) {
        await deleteItem();
        return "processed";
      }

      let member;
      try {
        member = await guild.members.fetch(item.memberId);
      } catch {
        await db
          .update(memberGuild)
          .set({ status: false })
          .where(
            and(
              eq(memberGuild.memberId, item.memberId),
              eq(memberGuild.guildId, item.guildId),
            ),
          );
        await deleteItem();
        return "processed";
      }

      await MemberDataService.updateCompleteMemberData(member);
      await deleteItem();
      return "processed";
    } catch (err) {
      // An unreachable database is not this item's fault, and the row is fine
      // where it is. Crucially it must not be touched: the requeue below is
      // itself a write, so parking a failed item during an outage would answer
      // every failed query with a second query against the same dead database.
      if (isDatabaseUnavailable(err)) {
        this.consecutiveOutages += 1;

        // Logged once per outage instead of once per attempt - the previous
        // loop wrote this stack trace every second for as long as the database
        // stayed down, which buried everything else in the log.
        if (this.consecutiveOutages === 1) {
          error("Queue paused: database unavailable:", err);
        }

        return "unavailable";
      }

      error(`Failed to process queue item:`, err);

      // The oldest row is always picked first, so an item that fails every
      // time is retried forever and blocks every member queued behind it.
      // Send it to the back instead: it still gets another chance, without
      // holding up the queue.
      if (currentItemId !== null) {
        await db
          .update(memberUpdateQueue)
          .set({ createdAt: new Date().toISOString() })
          .where(eq(memberUpdateQueue.id, currentItemId))
          .catch((e) => error("Failed to requeue item:", e));
      }

      return "processed";
    }
  }
}
