import { safeEditReply } from "@/core/utils/command.utils";
import { botLogger } from "@/lib/telemetry";
import { isBotOwner } from "@/shared/config/roles";
import { PermissionFlagsBits, type CommandInteraction } from "discord.js";

/**
 * Restarts the bot through its hosting panel's API.
 *
 * The panel (Wispbyte, which speaks Pterodactyl's client API) is awkward to
 * reach by hand, and restarting there is the usual fix for a stuck bot and
 * the only way new code gets picked up. So the bot asks the panel to restart
 * it: the panel stops the container - SIGTERM, which flushes the workers in
 * main.ts - and starts it again.
 *
 * Deliberately no fallback to exiting the process. Whether the host brings a
 * dead process back is up to its crash detection, and if it does not, a
 * restart command would take the bot down with no way back from Discord.
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

  const panelUrl = process.env.PANEL_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.PANEL_API_KEY?.trim();
  const serverId = process.env.PANEL_SERVER_ID?.trim();

  if (!panelUrl || !apiKey || !serverId) {
    return "Restarting isn't set up yet - PANEL_URL, PANEL_API_KEY and PANEL_SERVER_ID need to be in my environment.";
  }

  botLogger.info("Restart requested", { by: interaction.user.id });

  // Said before asking, not after: the panel answers and sends SIGTERM almost
  // together, and a reply edited after that races the process exiting.
  await safeEditReply(
    interaction,
    "Restarting - I'll be back in a minute or so.",
  );

  try {
    const response = await fetch(
      `${panelUrl}/api/client/servers/${serverId}/power`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ signal: "restart" }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    // 204 is the panel accepting the signal; the restart itself follows, and
    // the reply already says so.
    if (response.ok) return null;

    const body = (await response.text().catch(() => "")).slice(0, 300);
    botLogger.error("Panel refused the restart", {
      status: response.status,
      body,
    });

    if (response.status === 401 || response.status === 403) {
      return `The panel rejected my API key (${response.status}) - PANEL_API_KEY needs replacing.`;
    }
    if (response.status === 404) {
      return "The panel doesn't know that server - check PANEL_SERVER_ID and PANEL_URL.";
    }
    return `The panel refused the restart (${response.status}).`;
  } catch (error) {
    botLogger.error("Could not reach the panel to restart", {
      error: String(error),
    });
    return "I couldn't reach the panel, so nothing was restarted.";
  }
}
