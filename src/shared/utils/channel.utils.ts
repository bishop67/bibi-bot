import type { Channel, ThreadChannel } from "discord.js";

/**
 * The channel's own name plus those of its parent and grandparent.
 *
 * Channel exemptions are configured by name, and every one of them wants the
 * same reach: naming a category should cover the channels inside it, including
 * ones added later, and a thread should inherit whatever its parent channel
 * has. Threads hang off a channel which hangs off a category, so that is two
 * levels up rather than one.
 */
export function channelNameChain(
  channel: Channel | ThreadChannel | null | undefined,
): string[] {
  if (!channel) return [];

  const names: string[] = [];

  if ("name" in channel && channel.name) names.push(channel.name);

  if ("parent" in channel && channel.parent) {
    if (channel.parent.name) names.push(channel.parent.name);
    const grandparent =
      "parent" in channel.parent ? channel.parent.parent : null;
    if (grandparent?.name) names.push(grandparent.name);
  }

  return names;
}
