import { safeEditReply } from "@/core/utils/command.utils";
import { shutdown } from "@/lib/shutdown";
import { isBotOwner } from "@/shared/config/roles";
import { PermissionFlagsBits, type CommandInteraction } from "discord.js";

/**
 * Restarts the bot by exiting and letting the host start it again.
 *
 * Wispbyte offers no API key - its restart button is authorised by the
 * browser session, and starting can demand a captcha - so the bot cannot ask
 * the panel. It exits non-zero instead, which the host's crash detection
 * (Pterodactyl Wings underneath) treats as a crash and restarts. The startup
 * command runs `git pull` first, so this also deploys whatever is on main.
 *
 * If crash detection were ever turned off, the bot stays down until it is
 * started from the panel - the same as before this command existed.
 */
export async function executeRestart(
  interaction: CommandInteraction,
): Promise<string | null> {
  // defaultMemberPermissions is only a default - a server can hand any role
  // the command under Integrations - so the permission is checked again here.
  const isAdmin = interaction.memberPermissions?.has(
    PermissionFlagsBits.Administrator,
  );
  if (!isAdmin && !isBotOwner(interaction.user.id)) {
    return "Only administrators can restart me.";
  }

  // The reply has to be out before the process is.
  await safeEditReply(
    interaction,
    "Restarting and pulling the latest code - I'll be back in a minute or so.",
  );

  await shutdown(`/restart by ${interaction.user.id}`, 1);
  return null;
}
