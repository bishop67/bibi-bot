import { WarningsService } from "@/core/services/moderation/warnings.service";
import { safeDeferReply, safeEditReply } from "@/core/utils/command.utils";
import { db } from "@/lib/db";
import { memberCommandHistory } from "@/lib/db-schema";
import { MessageFlags } from "discord.js";
import type { CommandInteraction } from "discord.js";
import { ApplicationCommandOptionType, PermissionFlagsBits } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";

@Discord()
export class EditWarning {
  @Slash({
    name: "edit-warning",
    description: "Edit the reason on an existing warning",
    defaultMemberPermissions: PermissionFlagsBits.ManageRoles,
    dmPermission: false,
  })
  async editWarning(
    @SlashOption({
      name: "warning_id",
      description: "The warning ID (shown in /warnings)",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    warningId: number,
    @SlashOption({
      name: "new_reason",
      description: "The new reason text",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    newReason: string,
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
          command: "edit-warning",
        })
        .catch(() => {});
    }

    const updated = await WarningsService.editWarning(
      interaction.guildId,
      warningId,
      newReason,
    );

    if (!updated) {
      return safeEditReply(interaction, `No warning found with ID #${warningId}`);
    }

    return safeEditReply(interaction, `Updated warning #${warningId}`);
  }
}
