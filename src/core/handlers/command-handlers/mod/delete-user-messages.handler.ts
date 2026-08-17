import { DeleteUserMessagesService } from "@/core/services/messages/delete-user-messages.service";
import type { CommandResult } from "@/types";
import type { CommandInteraction, User } from "discord.js";

export async function executeDeleteUserMessages(
  interaction: CommandInteraction,
  user: User | undefined,
  userId: string | undefined,
  jail: boolean,
  reason: string | undefined,
  deleteMessages: boolean = true,
  days: number | undefined = undefined,
): Promise<CommandResult> {
  const memberId = user?.id ?? userId;
  if (!memberId || !interaction.guild) {
    return { success: false, error: "Invalid user or guild" };
  }

  if (!jail && !deleteMessages) {
    return {
      success: false,
      error: "Nothing to do: set jail, delete-messages, or both.",
    };
  }

  const params = {
    guild: interaction.guild,
    memberId,
    jail,
    user: user ?? null,
    deleteMessages,
    days,
    reason: reason
      ? `${reason} (triggered by <@${interaction.user.id}>)`
      : `Manual moderation (triggered by <@${interaction.user.id}>)`,
  };

  // Deliberately not marked `automated`, so a moderator can still jail a
  // staff member by hand even though the filters never will.
  if (jail) {
    await DeleteUserMessagesService.jailUser(params);
  }

  if (!deleteMessages) {
    return { success: true, message: "User jailed. No messages were deleted." };
  }

  DeleteUserMessagesService.deleteUserMessages(params).catch(() => {});

  const window = `last ${days ?? 7} day${(days ?? 7) === 1 ? "" : "s"}`;

  return {
    success: true,
    message: jail
      ? `User jailed. Deleting their messages from the ${window} in the background.`
      : `Deleting their messages from the ${window} in the background.`,
  };
}
