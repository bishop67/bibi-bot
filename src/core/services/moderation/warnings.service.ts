import { ensureMemberRows } from "@/core/services/members/ensure-member";
import { db } from "@/lib/db";
import { memberGuild, memberWarning } from "@/lib/db-schema";
import { and, count, eq, lte } from "drizzle-orm";

export class WarningsService {
  // MemberWarning is the source of truth; memberGuild.warnings is a derived
  // counter kept in sync so the jail-escalation logic (checkWarnings in
  // messages.service.ts) reads the same number the warning list shows.
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

    const warningCount = result?.count ?? 0;

    // Update only. Inserting here would create a MemberGuild row with
    // status true for someone who is not in the server - counting them as a
    // current member in stats - or fail the Member foreign key outright for
    // someone the bot has never synced.
    await db
      .update(memberGuild)
      .set({ warnings: warningCount })
      .where(
        and(
          eq(memberGuild.memberId, memberId),
          eq(memberGuild.guildId, guildId),
        ),
      );

    return warningCount;
  }

  static async addWarning({
    guildId,
    memberId,
    username,
    moderatorId,
    moderatorName,
    reason,
  }: {
    guildId: string;
    memberId: string;
    username?: string;
    moderatorId?: string;
    moderatorName?: string;
    reason: string;
  }) {
    // MemberWarning has FKs to Member for both columns - see ensureMemberRows.
    await ensureMemberRows([
      { memberId, username },
      { memberId: moderatorId, username: moderatorName },
    ]);

    const [warning] = await db
      .insert(memberWarning)
      .values({ guildId, memberId, moderatorId, reason })
      .returning();

    await this.syncWarningCount(memberId, guildId);

    // This warning's own position in the member's record, not the total after
    // it. Two warnings landing together would otherwise both read the total
    // past a multiple of three, and the jail on that multiple would never fire.
    const [position] = await db
      .select({ count: count() })
      .from(memberWarning)
      .where(
        and(
          eq(memberWarning.memberId, memberId),
          eq(memberWarning.guildId, guildId),
          lte(memberWarning.id, warning.id),
        ),
      );

    return { warning, warningCount: position?.count ?? 1 };
  }
}
