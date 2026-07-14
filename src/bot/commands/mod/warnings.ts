import { executeWarnings } from "@/core/handlers/command-handlers/mod/warnings.handler";
import { safeDeferReply, safeEditReply } from "@/core/utils/command.utils";
import { db } from "@/lib/db";
import { memberCommandHistory } from "@/lib/db-schema";
import type { CommandInteraction, User } from "discord.js";
import { ApplicationCommandOptionType, PermissionFlagsBits } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";

@Discord()
export class Warnings {
  @Slash({
    name: "warnings",
    description: "List a member's warnings",
    defaultMemberPermissions: PermissionFlagsBits.ManageRoles,
    dmPermission: false,
  })
  async warnings(
    @SlashOption({
      name: "user",
      description: "The member to look up",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: User,
    @SlashOption({
      name: "page",
      description: "Page number (default 1)",
      required: false,
      minValue: 1,
      type: ApplicationCommandOptionType.Integer,
    })
    page: number = 1,
    interaction: CommandInteraction,
  ) {
    if (!(await safeDeferReply(interaction))) return;

    if (interaction.member?.user.id && interaction.guildId) {
      db.insert(memberCommandHistory)
        .values({
          channelId: interaction.channelId,
          memberId: interaction.member.user.id,
          guildId: interaction.guildId,
          command: "warnings",
        })
        .catch(() => {});
    }

    const result = await executeWarnings(interaction, user, page);

    if ("error" in result) return safeEditReply(interaction, result.error);

    return safeEditReply(interaction, {
      embeds: [result.embed],
      allowedMentions: { users: [], roles: [] },
    });
  }
}
