import { db } from "@/lib/db";
import { member, memberGuild, memberWarning } from "@/lib/db-schema";
import { and, count, desc, eq, sql } from "drizzle-orm";

const PAGE_SIZE = 10;

export class WarningsService {
  // Keep memberGuild.warnings in sync so existing jail-escalation logic
  // (checkWarnings in messages.service.ts) keeps working off the same counter.
  private static async syncWarningCount(memberId: string, guildId: string) {
    const [result] = await db
      .select({ count: count() })
      .from(memberWarning)
      .where(
        and(
          eq(memberWarning.memberId, memberId),
          eq(memberWarning.guildId, guildId),
        ),
      );

    await db
      .insert(memberGuild)
      .values({
        memberId,
        guildId,
        status: true,
        warnings: result?.count ?? 0,
      })
      .onConflictDoUpdate({
        target: [memberGuild.memberId, memberGuild.guildId],
        set: { warnings: result?.count ?? 0 },
      });
  }

  static async addWarning({
    guildId,
    memberId,
    moderatorId,
    reason,
  }: {
    guildId: string;
    memberId: string;
    moderatorId?: string;
    reason: string;
  }) {
    const [warning] = await db
      .insert(memberWarning)
      .values({ guildId, memberId, moderatorId, reason })
      .returning();

    await this.syncWarningCount(memberId, guildId);

    return warning;
  }

  static async getWarnings(
    guildId: string,
    memberId: string,
    page: number = 0,
  ) {
    const offset = page * PAGE_SIZE;

    const [warnings, [totalResult]] = await Promise.all([
      db.query.memberWarning.findMany({
        where: and(
          eq(memberWarning.guildId, guildId),
          eq(memberWarning.memberId, memberId),
        ),
        orderBy: desc(memberWarning.createdAt),
        limit: PAGE_SIZE,
        offset,
        with: {
          moderator: { columns: { username: true } },
        },
      }),
      db
        .select({ count: count() })
        .from(memberWarning)
        .where(
          and(
            eq(memberWarning.guildId, guildId),
            eq(memberWarning.memberId, memberId),
          ),
        ),
    ]);

    return {
      warnings,
      total: totalResult?.count ?? 0,
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.max(1, Math.ceil((totalResult?.count ?? 0) / PAGE_SIZE)),
    };
  }

  static async getWarningById(guildId: string, warningId: number) {
    return db.query.memberWarning.findFirst({
      where: and(
        eq(memberWarning.id, warningId),
        eq(memberWarning.guildId, guildId),
      ),
    });
  }

  static async editWarning(
    guildId: string,
    warningId: number,
    newReason: string,
  ) {
    const [updated] = await db
      .update(memberWarning)
      .set({ reason: newReason, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(
        and(
          eq(memberWarning.id, warningId),
          eq(memberWarning.guildId, guildId),
        ),
      )
      .returning();

    return updated;
  }

  static async deleteWarning(guildId: string, warningId: number) {
    const [deleted] = await db
      .delete(memberWarning)
      .where(
        and(
          eq(memberWarning.id, warningId),
          eq(memberWarning.guildId, guildId),
        ),
      )
      .returning();

    if (deleted) await this.syncWarningCount(deleted.memberId, guildId);

    return deleted;
  }

  static async clearWarnings(guildId: string, memberId: string) {
    const deleted = await db
      .delete(memberWarning)
      .where(
        and(
          eq(memberWarning.guildId, guildId),
          eq(memberWarning.memberId, memberId),
        ),
      )
      .returning();

    await this.syncWarningCount(memberId, guildId);

    return deleted.length;
  }

  static async getTopWarnings(guildId: string, page: number = 0) {
    const offset = page * PAGE_SIZE;

    const rows = await db
      .select({
        memberId: memberWarning.memberId,
        username: member.username,
        warningCount: count(memberWarning.id),
      })
      .from(memberWarning)
      .innerJoin(member, eq(member.memberId, memberWarning.memberId))
      .where(eq(memberWarning.guildId, guildId))
      .groupBy(memberWarning.memberId, member.username)
      .orderBy(desc(count(memberWarning.id)))
      .limit(PAGE_SIZE)
      .offset(offset);

    return { rows, page, pageSize: PAGE_SIZE };
  }
}
