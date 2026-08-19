import type { InferSelectModel } from "drizzle-orm";
import type { memberRole } from "@/lib/db-schema";
import type { STATUS_ROLES } from "@/shared/config/roles";

type MemberRole = InferSelectModel<typeof memberRole>;
import type {
  APIEmbed,
  Collection,
  Guild,
  GuildMember,
  Message,
  PartialGuildMember,
  Role,
  User,
} from "discord.js";

export type StatusRoles = (typeof STATUS_ROLES)[number];

export type CommandResult = {
  success: boolean;
  error?: string;
  message?: string;
};

export type EmbedResult = { embed: APIEmbed } | { error: string };

export type MessageResult = { message: string } | { error: string };

export type TextResult = { text: string } | { error: string };

export type MembersCommandResult =
  | {
      embed: APIEmbed;
      attachment: { attachment: Buffer; name: string };
    }
  | { error: string };

export type ChartDataPoint = { x: Date; y: number };

export type GuildMemberCountChart = {
  buffer?: Buffer;
  fileName?: string;
  thirtyDaysCount?: number;
  sevedDaysCount?: number;
  oneDayCount?: number;
  lookback?: number;
  error?: string;
};

export type UserStatsExampleEmbed = {
  id: string;
  helpReceivedCount: number;
  helpCount: number;
  userGlobalName: string;
  userServerName: string;
  lookback: number;
  joinedAt: Date | null;
  createdAt: Date;
  lookbackDaysCount: number;
  sevenDaysCount: number;
  oneDayCount: number;
  mostActiveTextChannelId?: string;
  mostActiveTextChannelMessageCount: number;
  lastVoiceAt: string | null;
  lastMessageAt: string | null;
  mostActiveVoice: {
    channelId: string;
    sum: number;
  };
  lookbackVoiceSum: number;
  sevenDayVoiceSum: number;
  oneDayVoiceSum: number;
};

export type ToptatsExampleEmbed = {
  mostActiveMessageUsers: {
    memberId: string;
    count: number;
    username: string;
  }[];
  mostHelpfulUsers: { memberId: string; count: number; username: string }[];
  mostActiveMessageChannels: {
    channelId: string;
    count: number;
  }[];
  mostActiveVoiceUsers: { memberId: string; username: string; sum: number }[];
  mostActiveVoiceChannels: { channelId: string; sum: number }[];
  lookback: number;
};

// AI Service types
export interface AiChatResponse {
  text: string;
  gifUrl: string | null;
}

export interface MessageContext {
  context: string;
  images: string[];
}

export interface ReplyContext {
  replyContext: string;
  repliedImages: string[];
}

// Embed types
export interface UserJailedEmbedParams {
  memberId: string;
  displayName: string;
  username: string;
  reason?: string;
}

// Service types
export interface DeleteUserMessagesParams {
  guild: Guild;
  user: User | null;
  memberId: string;
  jail: string | number | boolean;
  reason?: string;
  /**
   * Skip message deletion entirely and only apply the jail. Defaults to
   * deleting.
   */
  deleteMessages?: boolean;
  /**
   * How many days back to delete. Discord refuses to bulk-delete anything
   * older than 14 days, so values above that silently do nothing.
   */
  days?: number;
  /**
   * Whether DELETE_EXEMPT_CHANNELS applies to this member. Filled in before
   * the jail role is applied - see captureDeleteExemption for why it cannot be
   * worked out later.
   */
  hasDeleteExemptRole?: boolean;
  /**
   * Set by the automated filters. A staff member can still be jailed by a
   * moderator running the command by hand - this only exempts them from the
   * bot deciding to do it on its own.
   */
  automated?: boolean;
  /**
   * The moderator who ordered this jail, for the ModLog entry. Left unset by
   * the automated filters, which is what makes those entries read as Automod.
   *
   * Naming them only inside `reason` is not enough: the rank check on /unjail
   * reads ModLog.moderatorId, and a null there means a hand-applied jail is
   * indistinguishable from an automatic one.
   */
  moderatorId?: string;
  moderatorName?: string;
}

// Roles service types
export type UpdateDbRolesArgs = {
  oldRoles: Role[];
  newRoles: Role[];
  oldMember: GuildMember | PartialGuildMember;
  newMember: GuildMember | PartialGuildMember;
  guildRoles: Collection<string, Role>;
  memberDbRoles: MemberRole[];
};

export interface HandleHelperReactionParams {
  threadId: string;
  threadOwnerId: string | null;
  helperId: string;
  thankerUserId: string;
  guildId: string;
  message: Message;
}

// Spam service types
export interface UserSpamState {
  count: number;
  lastContent: string;
  lastAttachmentHashes: string[];
  recentChannels: Array<{ channelId: string; timestamp: number }>;
  /** Last time this member was seen, so stale state can be evicted. */
  updatedAt: number;
}

export interface SpamDetectionContext {
  accountAge: number;
  memberAge: number | null;
  channelName: string;
  username: string;
  displayName: string;
  hasCustomAvatar: boolean;
  hasBanner: boolean;
  userFlags: string[];
  isSystemAccount: boolean;
  roles: string[];
  messageLength: number;
  hasLinks: boolean;
  hasMentions: boolean;
  imageCount: number;
  messageContent: string;
}

export interface SpamDetectionResult {
  isSpam: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
}

export interface TemplateValidationResult {
  isValid: boolean;
  missingFields: string[];
  suggestions: string;
  extractedFields: Record<string, string>;
  summary: string;
  scamRisk: "low" | "medium" | "high";
  scamReason: string;
}
