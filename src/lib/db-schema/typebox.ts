import { Type as t } from "@sinclair/typebox/type";
import { createSelectSchema } from "drizzle-typebox";
import {
  guild,
  guildVoiceEvents,
  member,
  memberCommandHistory,
  memberDeletedMessages,
  memberGuild,
  memberHelper,
  memberMessages,
  memberRole,
  memberUpdateQueue,
  syncProgress,
} from "./schema";

// Guild schemas
export const guildSelectSchema = createSelectSchema(guild);
export type Guild = typeof guildSelectSchema.static;
export const guildInsertSchema = t.Omit(guildSelectSchema, ["lookback"]);
export const guildUpdateSchema = t.Partial(guildSelectSchema);

// Member schemas
export const memberSelectSchema = createSelectSchema(member, {
  memberId: t.String({ minLength: 17, maxLength: 20 }),
  username: t.String({ minLength: 1, maxLength: 32 }),
});
export type Member = typeof memberSelectSchema.static;
export const memberInsertSchema = t.Omit(memberSelectSchema, ["updatedAt"]);
export const memberUpdateSchema = t.Partial(t.Omit(memberSelectSchema, ["memberId"]));

// MemberGuild schemas
export const memberGuildSelectSchema = createSelectSchema(memberGuild, {
  memberId: t.String({ minLength: 17, maxLength: 20 }),
  guildId: t.String({ minLength: 17, maxLength: 20 }),
});
export type MemberGuild = typeof memberGuildSelectSchema.static;
export const memberGuildInsertSchema = t.Omit(memberGuildSelectSchema, ["id", "updatedAt"]);
export const memberGuildUpdateSchema = t.Partial(t.Omit(memberGuildSelectSchema, ["id", "memberId", "guildId"]));

// MemberRole schemas
export const memberRoleSelectSchema = createSelectSchema(memberRole, {
  roleId: t.String({ minLength: 17, maxLength: 20 }),
  memberId: t.String({ minLength: 17, maxLength: 20 }),
  guildId: t.String({ minLength: 17, maxLength: 20 }),
});
export type MemberRole = typeof memberRoleSelectSchema.static;
export const memberRoleInsertSchema = t.Omit(memberRoleSelectSchema, ["id", "createdAt", "updatedAt"]);
export const memberRoleUpdateSchema = t.Partial(t.Omit(memberRoleSelectSchema, ["id", "memberId", "roleId"]));

// MemberMessages schemas
export const memberMessagesSelectSchema = createSelectSchema(memberMessages, {
  memberId: t.String({ minLength: 17, maxLength: 20 }),
  guildId: t.String({ minLength: 17, maxLength: 20 }),
  messageId: t.String({ minLength: 17, maxLength: 20 }),
  channelId: t.String({ minLength: 17, maxLength: 20 }),
});
export type MemberMessages = typeof memberMessagesSelectSchema.static;
export const memberMessagesInsertSchema = t.Omit(memberMessagesSelectSchema, ["createdAt"]);

// MemberDeletedMessages schemas
export const memberDeletedMessagesSelectSchema = createSelectSchema(memberDeletedMessages, {
  deletedByMemberId: t.String({ minLength: 17, maxLength: 20 }),
  messageMemberId: t.String({ minLength: 17, maxLength: 20 }),
  guildId: t.String({ minLength: 17, maxLength: 20 }),
  messageId: t.String({ minLength: 17, maxLength: 20 }),
  channelId: t.String({ minLength: 17, maxLength: 20 }),
});
export type MemberDeletedMessages = typeof memberDeletedMessagesSelectSchema.static;
export const memberDeletedMessagesInsertSchema = t.Omit(memberDeletedMessagesSelectSchema, ["id", "createdAt"]);

// MemberHelper schemas
export const memberHelperSelectSchema = createSelectSchema(memberHelper, {
  memberId: t.String({ minLength: 17, maxLength: 20 }),
  guildId: t.String({ minLength: 17, maxLength: 20 }),
});
export type MemberHelper = typeof memberHelperSelectSchema.static;
export const memberHelperInsertSchema = t.Omit(memberHelperSelectSchema, ["id", "createdAt"]);

// MemberCommandHistory schemas
export const memberCommandHistorySelectSchema = createSelectSchema(memberCommandHistory, {
  memberId: t.String({ minLength: 17, maxLength: 20 }),
  guildId: t.String({ minLength: 17, maxLength: 20 }),
  channelId: t.String({ minLength: 17, maxLength: 20 }),
});
export type MemberCommandHistory = typeof memberCommandHistorySelectSchema.static;
export const memberCommandHistoryInsertSchema = t.Omit(memberCommandHistorySelectSchema, ["id", "createdAt"]);

// MemberUpdateQueue schemas
export const memberUpdateQueueSelectSchema = createSelectSchema(memberUpdateQueue, {
  memberId: t.String({ minLength: 17, maxLength: 20 }),
  guildId: t.String({ minLength: 17, maxLength: 20 }),
});
export type MemberUpdateQueue = typeof memberUpdateQueueSelectSchema.static;
export const memberUpdateQueueInsertSchema = t.Omit(memberUpdateQueueSelectSchema, ["id", "createdAt"]);

// GuildVoiceEvents schemas
export const guildVoiceEventsSelectSchema = createSelectSchema(guildVoiceEvents, {
  memberId: t.String({ minLength: 17, maxLength: 20 }),
  guildId: t.String({ minLength: 17, maxLength: 20 }),
  channelId: t.String({ minLength: 17, maxLength: 20 }),
});
export type GuildVoiceEvents = typeof guildVoiceEventsSelectSchema.static;
export const guildVoiceEventsInsertSchema = t.Omit(guildVoiceEventsSelectSchema, ["id", "join"]);

// SyncProgress schemas
export const syncProgressSelectSchema = createSelectSchema(syncProgress, {
  guildId: t.String({ minLength: 17, maxLength: 20 }),
  type: t.Union([t.Literal("threads"), t.Literal("users")]),
});
export type SyncProgress = typeof syncProgressSelectSchema.static;
export const syncProgressInsertSchema = t.Omit(syncProgressSelectSchema, ["updatedAt"]);
export const syncProgressUpdateSchema = t.Partial(t.Omit(syncProgressSelectSchema, ["guildId", "type"]));
