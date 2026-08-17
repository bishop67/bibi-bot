import { relations } from "drizzle-orm/relations";
import { guild, guildVoiceEvents, member, memberGuild, memberRole, memberCommandHistory, memberDeletedMessages, memberHelper, memberMessages, memberWarning, modLog } from "./schema";


export const guildVoiceEventsRelations = relations(guildVoiceEvents, ({one}) => ({
	guild: one(guild, {
		fields: [guildVoiceEvents.guildId],
		references: [guild.guildId]
	}),
	member: one(member, {
		fields: [guildVoiceEvents.memberId],
		references: [member.memberId]
	}),
}));

export const guildRelations = relations(guild, ({many}) => ({
	guildVoiceEvents: many(guildVoiceEvents),
	memberGuilds: many(memberGuild),
	memberRoles: many(memberRole),
	memberCommandHistories: many(memberCommandHistory),
	memberDeletedMessages: many(memberDeletedMessages),
	memberHelpers: many(memberHelper),
	memberWarnings: many(memberWarning),
	modLogs: many(modLog),
	memberMessages: many(memberMessages),
}));

export const memberRelations = relations(member, ({many}) => ({
	guildVoiceEvents: many(guildVoiceEvents),
	memberGuilds: many(memberGuild),
	memberRoles: many(memberRole),
	memberCommandHistories: many(memberCommandHistory),
	memberDeletedMessages_deletedByMemberId: many(memberDeletedMessages, {
		relationName: "memberDeletedMessages_deletedByMemberId_member_memberId"
	}),
	memberDeletedMessages_messageMemberId: many(memberDeletedMessages, {
		relationName: "memberDeletedMessages_messageMemberId_member_memberId"
	}),
	memberHelpers: many(memberHelper),
	memberWarnings_memberId: many(memberWarning, {
		relationName: "memberWarning_member"
	}),
	memberWarnings_moderatorId: many(memberWarning, {
		relationName: "memberWarning_moderator"
	}),
	modLogs_targetId: many(modLog, {
		relationName: "modLog_target"
	}),
	modLogs_moderatorId: many(modLog, {
		relationName: "modLog_moderator"
	}),
	memberMessages: many(memberMessages),
}));

export const modLogRelations = relations(modLog, ({one}) => ({
	guild: one(guild, {
		fields: [modLog.guildId],
		references: [guild.guildId]
	}),
	target: one(member, {
		fields: [modLog.targetId],
		references: [member.memberId],
		relationName: "modLog_target"
	}),
	moderator: one(member, {
		fields: [modLog.moderatorId],
		references: [member.memberId],
		relationName: "modLog_moderator"
	}),
}));

export const memberWarningRelations = relations(memberWarning, ({one}) => ({
	guild: one(guild, {
		fields: [memberWarning.guildId],
		references: [guild.guildId]
	}),
	member: one(member, {
		fields: [memberWarning.memberId],
		references: [member.memberId],
		relationName: "memberWarning_member"
	}),
	moderator: one(member, {
		fields: [memberWarning.moderatorId],
		references: [member.memberId],
		relationName: "memberWarning_moderator"
	}),
}));

export const memberGuildRelations = relations(memberGuild, ({one}) => ({
	guild: one(guild, {
		fields: [memberGuild.guildId],
		references: [guild.guildId]
	}),
	member: one(member, {
		fields: [memberGuild.memberId],
		references: [member.memberId]
	}),
}));

export const memberRoleRelations = relations(memberRole, ({one}) => ({
	guild: one(guild, {
		fields: [memberRole.guildId],
		references: [guild.guildId]
	}),
	member: one(member, {
		fields: [memberRole.memberId],
		references: [member.memberId]
	}),
}));

export const memberCommandHistoryRelations = relations(memberCommandHistory, ({one}) => ({
	guild: one(guild, {
		fields: [memberCommandHistory.guildId],
		references: [guild.guildId]
	}),
	member: one(member, {
		fields: [memberCommandHistory.memberId],
		references: [member.memberId]
	}),
}));

export const memberDeletedMessagesRelations = relations(memberDeletedMessages, ({one}) => ({
	member_deletedByMemberId: one(member, {
		fields: [memberDeletedMessages.deletedByMemberId],
		references: [member.memberId],
		relationName: "memberDeletedMessages_deletedByMemberId_member_memberId"
	}),
	guild: one(guild, {
		fields: [memberDeletedMessages.guildId],
		references: [guild.guildId]
	}),
	member_messageMemberId: one(member, {
		fields: [memberDeletedMessages.messageMemberId],
		references: [member.memberId],
		relationName: "memberDeletedMessages_messageMemberId_member_memberId"
	}),
}));

export const memberHelperRelations = relations(memberHelper, ({one}) => ({
	guild: one(guild, {
		fields: [memberHelper.guildId],
		references: [guild.guildId]
	}),
	member: one(member, {
		fields: [memberHelper.memberId],
		references: [member.memberId]
	}),
}));

export const memberMessagesRelations = relations(memberMessages, ({one}) => ({
	guild: one(guild, {
		fields: [memberMessages.guildId],
		references: [guild.guildId]
	}),
	member: one(member, {
		fields: [memberMessages.memberId],
		references: [member.memberId]
	}),
}));
