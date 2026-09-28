import { executeRestart } from "@/core/handlers/command-handlers/admin/restart.handler";
import { safeDeferReply, safeEditReply } from "@/core/utils/command.utils";
import { db } from "@/lib/db";
import { memberCommandHistory } from "@/lib/db-schema";
import { isBotOwner } from "@/shared/config/roles";
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
    // The restart notice is public so the channel knows the bot is going down;
    // a refusal stays private, so it is decided before the reply is deferred.
    const allowed =
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
      isBotOwner(interaction.user.id);
    if (!allowed) {
      await interaction
        .reply({
          content: "Only administrators can restart me.",
          flags: [MessageFlags.Ephemeral],
        })
        .catch(() => {});
      return;
    }

    if (!(await safeDeferReply(interaction))) return;

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
