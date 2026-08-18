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

// Channels the bot must not log from - staff rooms, and busy information
// channels where edit spam is just clutter.
//
// Matches a channel's own name OR the name of the category it sits in, so a
// whole staff category can be excluded once instead of listing every channel
// and remembering to update it whenever somebody adds another.
export const LOG_EXEMPT_CHANNELS =
  process.env.LOG_EXEMPT_CHANNELS?.split(",")
    ?.map((s) => s.trim())
    ?.filter(Boolean) ?? [];

// Channels a jail leaves alone for members holding a DELETE_EXEMPT_ROLES role
// - the categories whose history is worth more than tidying up after one
// member. Anyone without such a role still has these swept.
//
// Like the log exemption this matches a channel's own name OR its category's,
// so an "Information" category can be protected once. Jailing deletes a
// member's last fortnight of messages everywhere at once and nothing brings
// them back, so this list is checked before the sweep starts.
export const DELETE_EXEMPT_CHANNELS =
  process.env.DELETE_EXEMPT_CHANNELS?.split(",")
    ?.map((s) => s.trim())
    ?.filter(Boolean) ?? [];

// Channels a jail never sweeps, whoever is being jailed and whatever roles
// they hold. Meant for channels whose contents are not really the member's
// posts at all - the welcome channel is Discord's own join notices, which are
// authored by the joining member and would otherwise be deleted along with
// everything else.
export const DELETE_NEVER_CHANNELS =
  process.env.DELETE_NEVER_CHANNELS?.split(",")
    ?.map((s) => s.trim())
    ?.filter(Boolean) ?? [];

// Forum boards whose posts are checked against a template by the AI. Empty
// means the feature is off - see the note in thread-create.handler.ts for why
// it does not default to the known board names.
// Valid values: job-board, dev-board, showcase
export const TEMPLATE_VALIDATION_BOARDS =
  process.env.TEMPLATE_VALIDATION_BOARDS?.split(",")
    ?.map((s) => s.trim())
    ?.filter(Boolean) ?? [];
