import { botLogger } from "@/lib/telemetry";
import {
  DELETE_EXEMPT_CHANNELS,
  DELETE_NEVER_CHANNELS,
  LOG_EXEMPT_CHANNELS,
  MOD_LOG_CHANNELS,
  REPORT_CHANNELS,
} from "@/shared/config/channels";
import {
  DELETE_EXEMPT_ROLES,
  JAIL,
  STAFF_ROLES,
  STATUS_ROLES,
  VOICE_ONLY,
} from "@/shared/config/roles";
import { ChannelType } from "discord.js";
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

  // A name that resolves to nothing means no member ever qualifies, so the
  // exemption protects nobody - silently, and in the case of the delete
  // exemption, unrecoverably. Worth checking rather than assuming: these are
  // free-text role names, and this server's happen to contain quotes and
  // semicolons, which is easy to mistype and impossible to notice.
  const roleExemptionChecks: [string, string[], string][] = [
    [
      "delete exemption",
      DELETE_EXEMPT_ROLES,
      "jails will wipe protected channels for everyone",
    ],
    [
      "staff",
      STAFF_ROLES,
      "the filters will auto-jail moderators like anyone else",
    ],
  ];

  for (const [feature, names, consequence] of roleExemptionChecks) {
    for (const name of names) {
      if (!roleNames.has(name)) {
        problems.push(
          `no role named "${name}" (${feature}) - nobody qualifies, so ${consequence}`,
        );
      }
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

  // Every entry must match something, unlike the candidate lists above. A
  // misspelled exemption fails in the dangerous direction and silently: the
  // staff conversation keeps being mirrored into the log, the announcement
  // channel keeps being swept by the next jail.
  const categoryNames = new Set(
    guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildCategory)
      .map((c) => c.name),
  );

  const exemptionChecks: [string, string[], string][] = [
    ["log", LOG_EXEMPT_CHANNELS, "that channel is still being logged"],
    ["delete", DELETE_EXEMPT_CHANNELS, "a jail will still wipe that channel"],
    [
      "never-delete",
      DELETE_NEVER_CHANNELS,
      "a jail will still wipe that channel",
    ],
  ];

  for (const [kind, names, consequence] of exemptionChecks) {
    for (const name of names) {
      if (!channelNames.has(name) && !categoryNames.has(name)) {
        problems.push(
          `${kind} exemption "${name}" matches no channel or category - ${consequence}`,
        );
      }
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
