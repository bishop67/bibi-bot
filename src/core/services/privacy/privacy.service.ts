import { LRUCache } from "lru-cache";
import { db } from "@/lib/db";
import {
  memberDeletedMessages,
  memberGuild,
  memberMessages,
} from "@/lib/db-schema";
import { and, eq } from "drizzle-orm";

type OptOutFlags = { messageOptOut: boolean; presenceOptOut: boolean };

const NO_OPT_OUT: OptOutFlags = {
  messageOptOut: false,
  presenceOptOut: false,
};

export class PrivacyService {
  // memberId:guildId -> flags. Keeps the message-create hot path off the DB.
  // Bounded: an unbounded Map would keep an entry per member seen, for the
  // life of the process. Eviction is harmless - a miss just re-reads the row.
  private static cache = new LRUCache<string, OptOutFlags>({ max: 5000 });

  private static key(memberId: string, guildId: string) {
    return `${memberId}:${guildId}`;
  }

  static async getFlags(
    memberId: string,
    guildId: string,
  ): Promise<OptOutFlags> {
    const cached = this.cache.get(this.key(memberId, guildId));
    if (cached) return cached;

    const row = await db.query.memberGuild.findFirst({
      where: and(
        eq(memberGuild.memberId, memberId),
        eq(memberGuild.guildId, guildId),
      ),
      columns: { messageOptOut: true, presenceOptOut: true },
    });

    const flags: OptOutFlags = row
      ? {
          messageOptOut: row.messageOptOut,
          presenceOptOut: row.presenceOptOut,
        }
      : NO_OPT_OUT;

    this.cache.set(this.key(memberId, guildId), flags);
    return flags;
  }

  static async hasMessageOptOut(
    memberId: string,
    guildId: string,
  ): Promise<boolean> {
    return (await this.getFlags(memberId, guildId)).messageOptOut;
  }

  static async hasPresenceOptOut(
    memberId: string,
    guildId: string,
  ): Promise<boolean> {
    return (await this.getFlags(memberId, guildId)).presenceOptOut;
  }

  static invalidate(memberId: string, guildId: string) {
    this.cache.delete(this.key(memberId, guildId));
  }

  static async setMessageOptOut(
    memberId: string,
    guildId: string,
    optOut: boolean,
  ): Promise<void> {
    // Upsert rather than update: a plain UPDATE matches nothing for a member
    // with no MemberGuild row yet, and the command would still answer "opted
    // out" while having changed nothing at all.
    await db
      .insert(memberGuild)
      .values({ memberId, guildId, status: true, messageOptOut: optOut })
      .onConflictDoUpdate({
        target: [memberGuild.memberId, memberGuild.guildId],
        set: { messageOptOut: optOut },
      });
    this.invalidate(memberId, guildId);
    if (optOut) await this.purgeMessageData(memberId, guildId);
  }

  static async setPresenceOptOut(
    memberId: string,
    guildId: string,
    optOut: boolean,
  ): Promise<void> {
    // Upsert rather than update: a plain UPDATE matches nothing for a member
    // with no MemberGuild row yet, and the command would still answer "opted
    // out" while having changed nothing at all.
    await db
      .insert(memberGuild)
      .values({ memberId, guildId, status: true, presenceOptOut: optOut })
      .onConflictDoUpdate({
        target: [memberGuild.memberId, memberGuild.guildId],
        set: { presenceOptOut: optOut },
      });
    this.invalidate(memberId, guildId);
    if (optOut) await this.purgePresenceData(memberId, guildId);
  }

  // Removes stored message content for the member in this guild.
  static async purgeMessageData(
    memberId: string,
    guildId: string,
  ): Promise<void> {
    await Promise.all([
      db
        .delete(memberMessages)
        .where(
          and(
            eq(memberMessages.memberId, memberId),
            eq(memberMessages.guildId, guildId),
          ),
        ),
      db
        .delete(memberDeletedMessages)
        .where(
          and(
            eq(memberDeletedMessages.messageMemberId, memberId),
            eq(memberDeletedMessages.guildId, guildId),
          ),
        ),
    ]);
  }

  // Clears stored presence fields for the member in this guild.
  static async purgePresenceData(
    memberId: string,
    guildId: string,
  ): Promise<void> {
    await db
      .update(memberGuild)
      .set({
        presenceStatus: null,
        presenceActivity: null,
        presenceUpdatedAt: null,
      })
      .where(
        and(
          eq(memberGuild.memberId, memberId),
          eq(memberGuild.guildId, guildId),
        ),
      );
  }
}
