import type { ForumChannel } from "discord.js";

/**
 * Derive a board type from a forum channel's name, ignoring any leading emoji
 * or punctuation ("💼 job-board" -> "job-board").
 *
 * Lives here rather than in a service because it is pure string parsing with
 * no database behind it - the only piece of the old thread subsystem the
 * moderation path still needs.
 */
export function getThreadTypeFromChannel(channel: ForumChannel): string {
  const name = channel.name.toLowerCase();
  const match = name.match(/[^a-z0-9]*([a-z0-9-]+)$/i);
  return match?.[1] || name;
}
