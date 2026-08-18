import { LOG_EXEMPT_CHANNELS } from "@/shared/config/channels";
import { channelNameChain } from "@/shared/utils/channel.utils";
import type { Channel, ThreadChannel } from "discord.js";

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
export function isLogExempt(
  channel: Channel | ThreadChannel | null | undefined,
): boolean {
  if (!channel || !LOG_EXEMPT_CHANNELS.length) return false;

  return channelNameChain(channel).some((name) =>
    LOG_EXEMPT_CHANNELS.includes(name),
  );
}
