import { executeStatus } from "@/core/handlers/command-handlers/mod/status-handler";
import { safeDeferReply, safeEditReply } from "@/core/utils/command.utils";
import { db } from "@/lib/db";
import { memberCommandHistory } from "@/lib/db-schema";
import { PermissionFlagsBits, type CommandInteraction } from "discord.js";
import { Discord, Slash } from "discordx";

@Discord()
export class ServerCommand {
  @Slash({
    name: "server",
    description: "Bot server stats: CPU, memory and latency",
    defaultMemberPermissions: PermissionFlagsBits.ManageRoles,
    dmPermission: false,
  })
  async server(interaction: CommandInteraction) {
    if (!(await safeDeferReply(interaction))) return;

    if (interaction.member?.user.id && interaction.guildId) {
      db.insert(memberCommandHistory)
        .values({
          channelId: interaction.channelId,
          memberId: interaction.member.user.id,
          guildId: interaction.guildId,
          command: "server",
        })
        .catch(() => {});
    }

    const result = await executeStatus(interaction);

    await safeEditReply(interaction, result);
  }
}
