import { MemberDataService } from "@/core/services/members/member-data.service";
import { VerifyAllUsersService } from "@/core/services/members/verify-users.service";
import { bot } from "@/main";
import { db } from "@/lib/db";
import { memberUpdateQueue, memberGuild } from "@/lib/db-schema";
import { and, asc, eq } from "drizzle-orm";
import { error, log } from "console";

const PROCESS_INTERVAL_MS = 1000;

export class MemberUpdateQueueService {
  private static processorInterval: NodeJS.Timeout | null = null;
  private static isProcessing = false;

  static queueMemberUpdate(memberId: string, guildId: string, priority = 0) {
    db.insert(memberUpdateQueue)
      .values({ memberId, guildId, priority })
      .onConflictDoUpdate({
        target: [memberUpdateQueue.memberId, memberUpdateQueue.guildId],
        set: { priority },
      })
      .catch(() => {});
  }

  static start() {
    if (this.processorInterval) return;

    this.processorInterval = setInterval(() => {
      this.processNextItem().catch((err) => {
        error("Queue processor error:", err);
      });
    }, PROCESS_INTERVAL_MS);

    log("Member update queue processor started");
  }

  static stop() {
    if (this.processorInterval) {
      clearInterval(this.processorInterval);
      this.processorInterval = null;
      log("Member update queue processor stopped");
    }
  }

  private static async processNextItem() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    // Kept outside the try so a failure can still identify the row - see the
    // catch below.
    let currentItemId: number | null = null;

    try {
      const item = await db.query.memberUpdateQueue.findFirst({
        orderBy: asc(memberUpdateQueue.createdAt),
      });

      if (!item) return;

      currentItemId = item.id;

      if (VerifyAllUsersService.isVerificationRunning(item.guildId)) return;

      const deleteItem = () =>
        db
          .delete(memberUpdateQueue)
          .where(eq(memberUpdateQueue.id, item.id))
          .catch((e) => error("Failed to remove queue item:", e));

      const guild = bot.guilds.cache.get(item.guildId);
      if (!guild) {
        await deleteItem();
        return;
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
        return;
      }

      await MemberDataService.updateCompleteMemberData(member);
      await deleteItem();
    } catch (err) {
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
    } finally {
      this.isProcessing = false;
    }
  }
}
