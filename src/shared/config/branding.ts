// Branding and visual constants

import type { ClientUser } from "discord.js";

export const MEMBERS_TEMPLATE = "members count";
export const STATS_TEMPLATE = "user stats";
export const TOP_STATS_TEMPLATE = "top stats";
export const COMMAND_HISTORY_TEMPLATE = "command history";
export const DELETED_MESSAGES_HISTORY_TEMPLATE = "deleted messages history";

export const RED_COLOR = 0x121212; //0xff0000;
export const YELLOW_COLOR = 0x121212; //0xffaa00;
export const GREEN_COLOR = 0x121212; //0x57f287;
let botUser: ClientUser | null = null;

/** Called once the client is ready, so footers can show bibi's avatar. */
export function setBotUser(user: ClientUser | null) {
  botUser = user;
}

/**
 * The footer icon on every embed: bibi's own avatar, read live so it follows
 * any avatar change. This used to be a hardcoded BOT_ICON link, which went
 * dead and left every footer without its icon.
 */
export function botIcon(): string | undefined {
  return botUser?.displayAvatarURL() ?? undefined;
}

// Bot messages

/**
 * Help threads get no welcome post: reacting with 🔼 still credits the
 * helper, it just is not announced in every thread.
 */
export function getThreadWelcomeMessage(
  boardType: string,
  threadId: string,
  threadName: string,
): string | null {
  switch (boardType) {
    case "job-board":
      return `Good luck finding the right candidate! :four_leaf_clover:`;
    case "dev-board":
      return `Hope you find the perfect match! :handshake:`;
    case "showcase":
      return `Thanks for sharing your project! :star2:`;
    default:
      return null;
  }
}
