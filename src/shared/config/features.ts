// Feature flags parsed from environment variables

export const IS_CONSTRAINED_TO_BOT_CHANNEL =
  process.env.IS_CONSTRAINED_TO_BOT_CHANNEL?.trim() === "true";

export const SHOULD_LOG_VOICE_EVENTS =
  process.env.SHOULD_LOG_VOICE_EVENTS?.trim() === "true";

export const SHOULD_COUNT_MEMBERS =
  process.env.SHOULD_COUNT_MEMBERS?.trim() === "true";

export const SHOULD_USER_LEVEL_UP =
  process.env.SHOULD_USER_LEVEL_UP?.trim() === "true";

// Opt-out rather than opt-in: privileged intents are the normal state, and a
// missing variable must not silently disable moderation.
export const PRIVILEGED_INTENTS_ENABLED =
  process.env.PRIVILEGED_INTENTS_ENABLED?.trim() !== "false";

// Opt-out for the same reason. This was previously gated on DOCKER, which
// conflated "am I containerised" with "should background jobs run": running
// outside a container queued member updates forever and never drained them, so
// display names, avatars and roles stayed empty with nothing reporting why.
export const BACKGROUND_WORKERS_ENABLED =
  process.env.BACKGROUND_WORKERS_ENABLED?.trim() !== "false";

export const CAN_READ_MESSAGE_CONTENT = PRIVILEGED_INTENTS_ENABLED;

export const CAN_TRACK_MEMBERS = PRIVILEGED_INTENTS_ENABLED;
