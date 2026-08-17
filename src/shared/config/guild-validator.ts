import { botLogger } from "@/lib/telemetry";
import { MOD_LOG_CHANNELS, REPORT_CHANNELS } from "@/shared/config/channels";
import { JAIL, STATUS_ROLES, VOICE_ONLY } from "@/shared/config/roles";
import type { Client, Guild } from "discord.js";

/**
 * Roles and channels are configured globally, by name, while the bot can run
 * in several guilds at once. A guild that spells a role or channel differently
 * - or simply does not have it - fails silently: jailing finds no role and
 * returns, the mod log finds no channel and posts nothing. Nothing throws and
 * nothing is logged, so the bot looks healthy while moderation does nothing.
 *
 * Check the names against each guild once at startup and say plainly which
 * features are inert where.
 */
function findGuildProblems(guild: Guild): string[] {
  const problems: string[] = [];

  const roleNames = new Set(guild.roles.cache.map((role) => role.name));
  for (const name of STATUS_ROLES) {
    if (name && !roleNames.has(name)) {
      problems.push(`no role named "${name}" (status role)`);
    }
  }

  const channelNames = new Set(guild.channels.cache.map((c) => c.name));
  const channelChecks: [string, string[]][] = [
    ["moderation log", MOD_LOG_CHANNELS],
    ["member reports", REPORT_CHANNELS],
  ];

  // These are candidate lists - the bot uses the first name that matches - so
  // only a total miss disables the feature.
  for (const [feature, names] of channelChecks) {
    if (names.length && !names.some((name) => channelNames.has(name))) {
      problems.push(`${feature} disabled: none of [${names.join(", ")}] exist`);
    }
  }

  return problems;
}

export function validateGuildConfig(client: Client): void {
  if (!JAIL) {
    botLogger.warn(
      'STATUS_ROLES has no "jail" entry, so jailing is disabled everywhere - spam and invite filters will detect but never mute',
    );
  }

  if (!VOICE_ONLY) {
    botLogger.warn(
      'STATUS_ROLES has no "voiceonly" entry, so voice-only restriction is disabled everywhere',
    );
  }

  for (const guild of client.guilds.cache.values()) {
    const problems = findGuildProblems(guild);
    if (!problems.length) continue;

    botLogger.warn(
      "Guild is missing configured roles or channels - these features will silently do nothing there",
      { guildId: guild.id, guildName: guild.name, problems },
    );
  }
}
