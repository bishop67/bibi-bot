// Channel configurations parsed from environment variables
export const GENERAL_CHANNELS =
  process.env.GENERAL_CHANNELS?.split(",")?.map((s) => s.trim()) || [];

export const BOT_CHANNELS =
  process.env.BOT_CHANNELS?.split(",")?.map((s) => s.trim()) || [];

export const VOICE_EVENT_CHANNELS =
  process.env.VOICE_EVENT_CHANNELS?.split(",")?.map((s) => s.trim()) || [];

export const JOIN_EVENT_CHANNELS =
  process.env.JOIN_EVENT_CHANNELS?.split(",")?.map((s) => s.trim()) || [];

export const MEMBERS_COUNT_CHANNELS =
  process.env.MEMBERS_COUNT_CHANNELS?.split(",")?.map((s) => s.trim()) || [];

export const TEMPLATE_VALIDATION_CHANNELS =
  process.env.TEMPLATE_VALIDATION_CHANNELS?.split(",")?.map((s) => s.trim()) || [];

export const SPAM_EXEMPT_CHANNELS =
  process.env.SPAM_EXEMPT_CHANNELS?.split(",")?.map((s) => s.trim()) || [];

export const REPORT_CHANNELS =
  process.env.REPORT_CHANNELS?.split(",")?.map((s) => s.trim()) || [];

export const MOD_LOG_CHANNELS =
  process.env.MOD_LOG_CHANNELS?.split(",")?.map((s) => s.trim()) || [];

// Detail logging: nickname changes, message edits and deletions. Falls back to
// the join/leave channel so it works without extra configuration - set this
// only if you want that traffic somewhere separate.
const parsedServerLogChannels =
  process.env.SERVER_LOG_CHANNELS?.split(",")
    ?.map((s) => s.trim())
    ?.filter(Boolean) ?? [];

export const SERVER_LOG_CHANNELS = parsedServerLogChannels.length
  ? parsedServerLogChannels
  : JOIN_EVENT_CHANNELS;
