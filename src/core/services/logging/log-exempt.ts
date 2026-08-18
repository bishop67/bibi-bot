import { LOG_EXEMPT_CHANNELS } from "@/shared/config/channels";
import type { Channel } from "discord.js";

/**
 * Whether this channel is excluded from logging.
 *
 * Matches the channel's own name or its category's, so a staff category can be
 * named once rather than listing every channel inside it - which matters
 * because the failure mode of forgetting one is a private conversation being
 * mirrored into a log channel.
 *
 * A thread inherits the exemption of the channel it lives in; a private thread
 * in a staff room is exactly the case you would not want leaking.
 */
export function isLogExempt(channel: Channel | null | undefined): boolean {
  if (!channel || !LOG_EXEMPT_CHANNELS.length) return false;

  const names: string[] = [];

  if ("name" in channel && channel.name) names.push(channel.name);

  // Threads hang off a parent channel, which in turn hangs off a category.
  if ("parent" in channel && channel.parent) {
    if (channel.parent.name) names.push(channel.parent.name);
    const grandparent = "parent" in channel.parent ? channel.parent.parent : null;
    if (grandparent?.name) names.push(grandparent.name);
  }

  return names.some((name) => LOG_EXEMPT_CHANNELS.includes(name));
}
