import {
  DELETE_EXEMPT_CHANNELS,
  DELETE_NEVER_CHANNELS,
} from "@/shared/config/channels";
import { DELETE_EXEMPT_ROLES } from "@/shared/config/roles";
import { channelNameChain } from "@/shared/utils/channel.utils";
import type { Channel, GuildMember, ThreadChannel } from "discord.js";

/**
 * Whether this member has earned the DELETE_EXEMPT_CHANNELS protection.
 *
 * Must be answered before the jail role goes on - see the note on
 * captureDeleteExemption. An empty list means the channel protection applies
 * to everyone, so DELETE_EXEMPT_CHANNELS still works on its own.
 */
export function hasDeleteExemptRole(
  member: GuildMember | null | undefined,
): boolean {
  if (!DELETE_EXEMPT_ROLES.length) return true;
  if (!member) return false;

  return member.roles.cache.some((role) =>
    DELETE_EXEMPT_ROLES.includes(role.name),
  );
}

/**
 * Whether a jail may sweep this channel.
 *
 * Two tiers, because "leave this alone" has two different reasons behind it:
 *
 * DELETE_NEVER_CHANNELS is absolute - the welcome channel is Discord's own
 * join notices, which are authored by the member and so look exactly like
 * their messages to a sweep, but deleting them only punches holes in the
 * server's history and tells you nothing about the offender.
 *
 * DELETE_EXEMPT_CHANNELS is earned. A member who has been around keeps their
 * contributions to the channels that matter; a raider holding nothing but the
 * base member role has the lot removed, which is the whole point of jailing
 * them.
 *
 * Both match a channel name or a category name, and a thread inherits its
 * parent's protection, exactly as the logging exemption does.
 */
export function isDeleteProtected(
  channel: Channel | ThreadChannel | null | undefined,
  options: { hasExemptRole: boolean },
): boolean {
  if (!channel) return false;

  const names = channelNameChain(channel);
  if (!names.length) return false;

  if (names.some((name) => DELETE_NEVER_CHANNELS.includes(name))) return true;
  if (!options.hasExemptRole) return false;

  return names.some((name) => DELETE_EXEMPT_CHANNELS.includes(name));
}
