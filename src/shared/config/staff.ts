import { STAFF_ROLES } from "@/shared/config/roles";
import type { GuildMember } from "discord.js";

/**
 * Staff still get warned by the filters - the record is kept - but nothing is
 * ever done to them automatically: no jail, and none of their messages
 * removed. A moderator losing a post, or locking themselves out, over a link
 * is worse than whatever was being moderated.
 *
 * This is deliberately not SPAM_EXEMPT_ROLES. That skips the filters outright,
 * so nothing would be recorded at all; here the warning still lands.
 *
 * Manual moderation is unaffected - a moderator can still jail or purge a
 * colleague by running the command by hand.
 */
export function isStaffMember(
  member: GuildMember | null | undefined,
): boolean {
  if (!member || !STAFF_ROLES.length) return false;

  return member.roles.cache.some((role) => STAFF_ROLES.includes(role.name));
}
