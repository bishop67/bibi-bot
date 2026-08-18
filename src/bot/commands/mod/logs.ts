import { commandHistoryEmbed } from "@/core/embeds/command-history.embed";
import { deletedMessagesHistoryEmbed } from "@/core/embeds/deleted-messages.embed";
import { safeDeferReply, safeEditReply } from "@/core/utils/command.utils";
import { db } from "@/lib/db";
import { memberCommandHistory, memberDeletedMessages } from "@/lib/db-schema";
import { desc, eq } from "drizzle-orm";
import type { CommandInteraction } from "discord.js";
import { ApplicationCommandOptionType, PermissionFlagsBits } from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";

/** Command history is best-effort and must never delay the reply. */
function record(interaction: CommandInteraction, command: string) {
  if (!interaction.member?.user.id || !interaction.guildId) return;

  db.insert(memberCommandHistory)
    .values({
      channelId: interaction.channelId,
      memberId: interaction.member.user.id,
      guildId: interaction.guildId,
      command,
    })
    .catch(() => {});
}

@Discord()
@SlashGroup({
  name: "logs",
  description: "Recorded command and message history",
  // Discord applies permissions per top-level command, so a group cannot hold
  // two different levels. Gated at the lower of the two here, with `deleted`
  // enforcing Administrator itself - see below.
  defaultMemberPermissions: PermissionFlagsBits.ManageRoles,
  dmPermission: false,
})
@SlashGroup("logs")
export class LogsCommands {
  @Slash({ name: "commands", description: "Show command history" })
  async commands(
    @SlashOption({
      name: "count",
      description: "Amount of commands to show",
      type: ApplicationCommandOptionType.Integer,
      minValue: 1,
      maxValue: 100,
    })
    count: number = 10,
    interaction: CommandInteraction,
  ) {
    if (!(await safeDeferReply(interaction))) return;
    record(interaction, "logs commands");

    const history = await db.query.memberCommandHistory.findMany({
      where: eq(memberCommandHistory.guildId, interaction.guild!.id),
      limit: count,
      orderBy: desc(memberCommandHistory.createdAt),
    });

    await safeEditReply(interaction, {
      embeds: [commandHistoryEmbed(history)],
      allowedMentions: { users: [], roles: [] },
    });
  }

  @Slash({
    name: "deleted",
    description: "Show deleted messages",
  })
  async deleted(
    @SlashOption({
      name: "count",
      description: "Amount of messages to show",
      type: ApplicationCommandOptionType.Integer,
      minValue: 1,
      maxValue: 100,
    })
    count: number = 10,
    interaction: CommandInteraction,
  ) {
    if (!(await safeDeferReply(interaction))) return;

    // This reads the actual content of other people's deleted messages, which
    // is the most privacy-sensitive thing the bot can show. It was
    // Administrator-only as its own command and must not be downgraded just
    // because it now shares a group with command history.
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return safeEditReply(
        interaction,
        "That requires Administrator - deleted message content is not available to moderators.",
      );
    }

    record(interaction, "logs deleted");

    const history = await db.query.memberDeletedMessages.findMany({
      where: eq(memberDeletedMessages.guildId, interaction.guild!.id),
      limit: count,
      orderBy: desc(memberDeletedMessages.createdAt),
    });

    await safeEditReply(interaction, {
      embeds: [deletedMessagesHistoryEmbed(history)],
      allowedMentions: { users: [], roles: [] },
    });
  }
}
