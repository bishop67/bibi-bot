import { executeStatus } from "@/core/handlers/command-handlers/mod/status-handler";
import { safeDeferReply, safeEditReply } from "@/core/utils/command.utils";
import { db } from "@/lib/db";
import { memberCommandHistory } from "@/lib/db-schema";
import { type CommandInteraction } from "discord.js";
import { Discord, Slash } from "discordx";

@Discord()
export class StatusCommand {
  @Slash({
    name: "status",
    description: "Displays bot CPU and RAM usage in detail.",
    dmPermission: false,
  })
  async status(interaction: CommandInteraction) {
    if (!(await safeDeferReply(interaction)))
      return;

    if (interaction.member?.user.id && interaction.guildId) {
      db.insert(memberCommandHistory)
        .values({
          channelId: interaction.channelId,
          memberId: interaction.member.user.id,
          guildId: interaction.guildId,
          command: "status",
        })
        .catch(() => {});
    }

    const result = await executeStatus(interaction);

    await safeEditReply(interaction, result);
  }
}