import { pgTable, uniqueIndex, text, integer, foreignKey, serial, timestamp, boolean, bigint, jsonb, index, doublePrecision, primaryKey } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const guild = pgTable("Guild", {
	guildId: text().primaryKey().notNull(),
	guildName: text().notNull(),
	lookback: integer().default(9999).notNull(),
}, (table) => [
	uniqueIndex("Guild_guildId_key").using("btree", table.guildId.asc().nullsLast().op("text_ops")),
]);

export const guildVoiceEvents = pgTable("GuildVoiceEvents", {
	id: serial().primaryKey().notNull(),
	memberId: text().notNull(),
	guildId: text().notNull(),
	channelId: text().notNull(),
	join: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	leave: timestamp({ precision: 3, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.guildId],
			foreignColumns: [guild.guildId],
			name: "GuildVoiceEvents_guildId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.memberId],
			foreignColumns: [member.memberId],
			name: "GuildVoiceEvents_memberId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
]);

export const memberUpdateQueue = pgTable("MemberUpdateQueue", {
	id: serial().primaryKey().notNull(),
	memberId: text().notNull(),
	guildId: text().notNull(),
	priority: integer().default(0).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	uniqueIndex("MemberUpdateQueue_memberId_guildId_key").using("btree", table.memberId.asc().nullsLast().op("text_ops"), table.guildId.asc().nullsLast().op("text_ops")),
]);

export const memberGuild = pgTable("MemberGuild", {
	id: serial().primaryKey().notNull(),
	memberId: text().notNull(),
	guildId: text().notNull(),
	status: boolean().notNull(),
	nickname: text(),
	moveCounter: integer().default(0).notNull(),
	moving: boolean().default(false).notNull(),
	moveTimeout: integer().default(0).notNull(),
	warnings: integer().default(0).notNull(),
	muted: boolean().default(false).notNull(),
	deafened: boolean().default(false).notNull(),
	lookback: integer().default(9999).notNull(),
	avatarUrl: text(),
	displayHexColor: text(),
	displayName: text(),
	highestRolePosition: integer(),
	joinedAt: timestamp({ precision: 3, mode: 'string' }),
	presenceActivity: text(),
	presenceStatus: text(),
	presenceUpdatedAt: timestamp({ precision: 3, mode: 'string' }),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	bannerUrl: text(),
	avatarDecorationUrl: text(),
	communicationDisabledUntil: timestamp({ precision: 3, mode: 'string' }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	flags: bigint({ mode: "number" }),
	pending: boolean().default(false).notNull(),
	premiumSince: timestamp({ precision: 3, mode: 'string' }),
	avatarDecorationData: jsonb(),
	bannable: boolean().default(true).notNull(),
	displayColor: integer(),
	kickable: boolean().default(true).notNull(),
	manageable: boolean().default(true).notNull(),
	moderatable: boolean().default(true).notNull(),
}, (table) => [
	uniqueIndex("MemberGuild_memberId_guildId_key").using("btree", table.memberId.asc().nullsLast().op("text_ops"), table.guildId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.guildId],
			foreignColumns: [guild.guildId],
			name: "MemberGuild_guildId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.memberId],
			foreignColumns: [member.memberId],
			name: "MemberGuild_memberId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
]);

export const member = pgTable("Member", {
	memberId: text().primaryKey().notNull(),
	username: text().notNull(),
	accentColor: integer(),
	bannerUrl: text(),
	createdAt: timestamp({ precision: 3, mode: 'string' }),
	globalName: text(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	avatarUrl: text(),
	avatarDecorationUrl: text(),
	bot: boolean().default(false).notNull(),
	discriminator: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	flags: bigint({ mode: "number" }),
	system: boolean().default(false).notNull(),
	avatarDecorationData: jsonb(),
	collectibles: jsonb(),
	hexAccentColor: text(),
	primaryGuild: jsonb(),
}, (table) => [
	uniqueIndex("Member_memberId_key").using("btree", table.memberId.asc().nullsLast().op("text_ops")),
]);

export const memberRole = pgTable("MemberRole", {
	id: serial().primaryKey().notNull(),
	roleId: text().notNull(),
	guildId: text().notNull(),
	memberId: text().notNull(),
	name: text(),
	color: integer(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	hexColor: text(),
	hoist: boolean(),
	icon: text(),
	managed: boolean(),
	mentionable: boolean(),
	position: integer(),
	tags: jsonb(),
	unicodeEmoji: text(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("MemberRole_memberId_guildId_idx").using("btree", table.memberId.asc().nullsLast().op("text_ops"), table.guildId.asc().nullsLast().op("text_ops")),
	uniqueIndex("MemberRole_memberId_roleId_key").using("btree", table.memberId.asc().nullsLast().op("text_ops"), table.roleId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.guildId],
			foreignColumns: [guild.guildId],
			name: "MemberRole_guildId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.memberId],
			foreignColumns: [member.memberId],
			name: "MemberRole_memberId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
]);

export const modLog = pgTable("ModLog", {
	id: serial().primaryKey().notNull(),
	guildId: text().notNull(),
	action: text().notNull(),
	targetId: text().notNull(),
	moderatorId: text(),
	reason: text(),
	channelId: text(),
	logMessageId: text(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("ModLog_guildId_createdAt_idx").using("btree", table.guildId.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsLast()),
	foreignKey({
			columns: [table.guildId],
			foreignColumns: [guild.guildId],
			name: "ModLog_guildId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.targetId],
			foreignColumns: [member.memberId],
			name: "ModLog_targetId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.moderatorId],
			foreignColumns: [member.memberId],
			name: "ModLog_moderatorId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const memberWarning = pgTable("MemberWarning", {
	id: serial().primaryKey().notNull(),
	guildId: text().notNull(),
	memberId: text().notNull(),
	moderatorId: text(),
	reason: text().notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("MemberWarning_memberId_guildId_idx").using("btree", table.memberId.asc().nullsLast().op("text_ops"), table.guildId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.guildId],
			foreignColumns: [guild.guildId],
			name: "MemberWarning_guildId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.memberId],
			foreignColumns: [member.memberId],
			name: "MemberWarning_memberId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.moderatorId],
			foreignColumns: [member.memberId],
			name: "MemberWarning_moderatorId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const memberCommandHistory = pgTable("MemberCommandHistory", {
	id: serial().primaryKey().notNull(),
	memberId: text().notNull(),
	guildId: text().notNull(),
	command: text().notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	channelId: text().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.guildId],
			foreignColumns: [guild.guildId],
			name: "MemberCommandHistory_guildId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.memberId],
			foreignColumns: [member.memberId],
			name: "MemberCommandHistory_memberId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
]);

export const memberDeletedMessages = pgTable("MemberDeletedMessages", {
	id: serial().primaryKey().notNull(),
	deletedByMemberId: text().notNull(),
	messageMemberId: text().notNull(),
	guildId: text().notNull(),
	messageId: text().notNull(),
	channelId: text().notNull(),
	content: text().notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.deletedByMemberId],
			foreignColumns: [member.memberId],
			name: "MemberDeletedMessages_deletedByMemberId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.guildId],
			foreignColumns: [guild.guildId],
			name: "MemberDeletedMessages_guildId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.messageMemberId],
			foreignColumns: [member.memberId],
			name: "MemberDeletedMessages_messageMemberId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
]);

export const memberHelper = pgTable("MemberHelper", {
	id: serial().primaryKey().notNull(),
	memberId: text().notNull(),
	guildId: text().notNull(),
	threadId: text(),
	threadOwnerId: text(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.guildId],
			foreignColumns: [guild.guildId],
			name: "MemberHelper_guildId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.memberId],
			foreignColumns: [member.memberId],
			name: "MemberHelper_memberId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
]);

export const memberMessages = pgTable("MemberMessages", {
	id: text().primaryKey().notNull(),
	memberId: text().notNull(),
	guildId: text().notNull(),
	messageId: text().notNull(),
	channelId: text().notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	uniqueIndex("MemberMessages_messageId_key").using("btree", table.messageId.asc().nullsLast().op("text_ops")),
	// Counted per message by the level-up check and the first-message spam
	// filter. Without this it is a sequential scan of the largest table in the
	// schema on every single message sent.
	index("MemberMessages_memberId_guildId_idx").using("btree", table.memberId.asc().nullsLast().op("text_ops"), table.guildId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.guildId],
			foreignColumns: [guild.guildId],
			name: "MemberMessages_guildId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.memberId],
			foreignColumns: [member.memberId],
			name: "MemberMessages_memberId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
]);

export const syncProgress = pgTable("SyncProgress", {
	guildId: text().notNull(),
	type: text().notNull(),
	processedIds: text().array().default(["RAY"]),
	failedIds: text().array().default(["RAY"]),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	primaryKey({ columns: [table.type, table.guildId], name: "SyncProgress_pkey"}),
]);
