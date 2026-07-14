import { WarningsService } from "@/core/services/moderation/warnings.service";
import { safeDeferReply, safeEditReply } from "@/core/utils/command.utils";
import { db } from "@/lib/db";
import { memberCommandHistory } from "@/lib/db-schema";
import { MessageFlags } from "discord.js";
import type { CommandInteraction, User } from "discord.js";
import { ApplicationCommandOptionType, PermissionFlagsBits } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";

@Discord()
export class ClearWarnings {
  @Slash({
    name: "clear-warnings",
    description: "Clear all warnings for a member",
    defaultMemberPermissions: PermissionFlagsBits.ManageRoles,
    dmPermission: false,
  })
  async clearWarnings(
    @SlashOption({
      name: "user",
      description: "The member whose warnings to clear",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: User,
    interaction: CommandInteraction,
  ) {
    if (!(await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral })))
      return;

    if (!interaction.guildId) {
      return safeEditReply(interaction, "This command can only be used in a server");
    }

    if (interaction.member?.user.id) {
      db.insert(memberCommandHistory)
        .values({
          channelId: interaction.channelId,
          memberId: interaction.member.user.id,
          guildId: interaction.guildId,
          command: "clear-warnings",
        })
        .catch(() => {});
    }

    const count = await WarningsService.clearWarnings(
      interaction.guildId,
      user.id,
    );

    return safeEditReply(
      interaction,
      `Cleared ${count} warning${count === 1 ? "" : "s"} for ${user.username}`,
    );
  }
}
