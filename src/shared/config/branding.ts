// Branding and visual constants

export const MEMBERS_TEMPLATE = "members count";
export const STATS_TEMPLATE = "user stats";
export const TOP_STATS_TEMPLATE = "top stats";
export const COMMAND_HISTORY_TEMPLATE = "command history";
export const DELETED_MESSAGES_HISTORY_TEMPLATE = "deleted messages history";

export const RED_COLOR = 0x121212; //0xff0000;
export const YELLOW_COLOR = 0x121212; //0xffaa00;
export const GREEN_COLOR = 0x121212; //0x57f287;
export const BOT_ICON =
  process.env.BOT_ICON?.trim() || "https://via.placeholder.com/32";

// Bot messages
const CODING_RESPONSE =
  "Thanks for your question, if someone gives you an answer it would be great if you upvoted them with a :arrow_up_small: in response.";

export function getThreadWelcomeMessage(
  boardType: string,
  threadId: string,
  threadName: string,
): string {
  const link = `[${threadName}](https://coding-global.com/${threadId})`;
  const includeLink = false;

  switch (boardType) {
    case "job-board":
      return `Good luck finding the right candidate! :four_leaf_clover:${includeLink ? `\n${link}` : ""}`;
    case "dev-board":
      return `Hope you find the perfect match! :handshake:${includeLink ? `\n${link}` : ""}`;
    case "showcase":
      return `Thanks for sharing your project! :star2:${includeLink ? `\n${link}` : ""}`;
    default:
      return `${CODING_RESPONSE}${includeLink ? `\n${link}` : ""}`;
  }
}
