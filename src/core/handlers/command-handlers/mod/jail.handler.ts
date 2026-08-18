import { DeleteUserMessagesService } from "@/core/services/messages/delete-user-messages.service";
import type { CommandResult } from "@/types";
import type { CommandInteraction, User } from "discord.js";

export async function executeJail(
  interaction: CommandInteraction,
  user: User | undefined,
  userId: string | undefined,
  reason: string | undefined,
  deleteMessages: boolean = true,
  days: number | undefined = undefined,
): Promise<CommandResult> {
  const memberId = user?.id ?? userId;
  if (!memberId || !interaction.guild) {
    return { success: false, error: "Invalid user or guild" };
  }

  const params = {
    guild: interaction.guild,
    memberId,
    jail: true,
    user: user ?? null,
    deleteMessages,
    days,
    reason: reason
      ? `${reason} (triggered by <@${interaction.user.id}>)`
      : `Manual moderation (triggered by <@${interaction.user.id}>)`,
  };

  // Deliberately not marked `automated`, so a moderator can still jail a
  // staff member by hand even though the filters never will.
  const { alreadyJailed } = await DeleteUserMessagesService.jailUser(params);

  // Refused rather than repeated: a second jail cannot punish them further,
  // but its sweep would delete the protected channels the first one spared.
  if (alreadyJailed) {
    return {
      success: false,
      error:
        "That member is already jailed. Unjail them first if you need to delete more of their messages.",
    };
  }

  if (!deleteMessages) {
    return { success: true, message: "User jailed. No messages were deleted." };
  }

  DeleteUserMessagesService.deleteUserMessages(params).catch(() => {});

  const window = `last ${days ?? 14} day${(days ?? 14) === 1 ? "" : "s"}`;

  return {
    success: true,
    message: `Member jailed. Deleting their messages from the ${window} in the background.`,
  };
}
