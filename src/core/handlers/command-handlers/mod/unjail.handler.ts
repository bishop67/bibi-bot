import { DeleteUserMessagesService } from "@/core/services/messages/delete-user-messages.service";
import type { CommandResult } from "@/types";
import type { CommandInteraction, User } from "discord.js";

export async function executeUnjail(
  interaction: CommandInteraction,
  user: User | undefined,
  userId: string | undefined,
  reason: string | undefined,
): Promise<CommandResult> {
  const memberId = user?.id ?? userId;
  if (!memberId || !interaction.guild) {
    return { success: false, error: "Invalid user or guild" };
  }

  const result = await DeleteUserMessagesService.unjailUser({
    guild: interaction.guild,
    memberId,
    user: user ?? null,
    moderatorId: interaction.user.id,
    moderatorName: interaction.user.username,
    reason: reason
      ? `${reason} (released by <@${interaction.user.id}>)`
      : `Released by <@${interaction.user.id}>`,
  });

  if (!result.ok) return { success: false, error: result.message };

  return { success: true, message: result.message };
}
