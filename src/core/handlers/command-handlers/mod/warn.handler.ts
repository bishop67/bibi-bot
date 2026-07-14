import { WarningsService } from "@/core/services/moderation/warnings.service";
import { ModLogService } from "@/core/services/moderation/modlog.service";
import type { MessageResult } from "@/types";
import type { CommandInteraction, User } from "discord.js";

export async function executeWarn(
  interaction: CommandInteraction,
  target: User,
  reason: string,
): Promise<MessageResult> {
  if (!interaction.guild) {
    return { error: "This command can only be used in a server" };
  }

  if (target.bot) {
    return { error: "You can't warn a bot" };
  }

  if (target.id === interaction.member?.user.id) {
    return { error: "You can't warn yourself" };
  }

  const warning = await WarningsService.addWarning({
    guildId: interaction.guild.id,
    memberId: target.id,
    moderatorId: interaction.member?.user.id,
    reason,
  });

  await ModLogService.postLog({
    guild: interaction.guild,
    action: "warn",
    targetId: target.id,
    targetName: target.username,
    moderatorId: interaction.member?.user.id,
    moderatorName: interaction.member?.user.username,
    reason,
  });

  try {
    await target.send(
      `You have been warned in **${interaction.guild.name}**: ${reason}`,
    );
  } catch {
    // user has DMs closed or has left - warning is still recorded
  }

  return {
    message: `Warned ${target.username} (warning #${warning.id}): ${reason}`,
  };
}
