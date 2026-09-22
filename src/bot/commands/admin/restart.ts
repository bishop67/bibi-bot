import { executeRestart } from "@/core/handlers/command-handlers/admin/restart.handler";
import { safeDeferReply, safeEditReply } from "@/core/utils/command.utils";
import { db } from "@/lib/db";
import { memberCommandHistory } from "@/lib/db-schema";
import {
  MessageFlags,
  PermissionFlagsBits,
  type CommandInteraction,
} from "discord.js";
import { Discord, Slash } from "discordx";

@Discord()
export class Restart {
  @Slash({
    name: "restart",
    description: "Restart the bot and pull the latest code",
    defaultMemberPermissions: PermissionFlagsBits.Administrator,
    dmPermission: false,
  })
  async restart(interaction: CommandInteraction) {
    if (
      !(await safeDeferReply(interaction, { flags: [MessageFlags.Ephemeral] }))
    )
      return;

    if (interaction.member?.user.id && interaction.guildId) {
      db.insert(memberCommandHistory)
        .values({
          channelId: interaction.channelId,
          memberId: interaction.member.user.id,
          guildId: interaction.guildId,
          command: "restart",
        })
        .catch(() => {});
    }

    // Null means the restart is under way and the handler has already replied.
    const result = await executeRestart(interaction);

    if (result) await safeEditReply(interaction, result);
  }
}
