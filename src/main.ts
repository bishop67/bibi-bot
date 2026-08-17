import "@dotenvx/dotenvx/config";

import { MemberUpdateQueueService } from "@/core/services/members/member-update-queue.service";
import { MembersService } from "@/core/services/members/members.service";
import { botLogger, shutdownTelemetry } from "@/lib/telemetry";
import {
  BACKGROUND_WORKERS_ENABLED,
  PRIVILEGED_INTENTS_ENABLED,
} from "@/shared/config/features";
import { validateGuildConfig } from "@/shared/config/guild-validator";
import { ConfigValidator } from "@/shared/config/validator";
import { ActivityType, GatewayIntentBits, Options, Partials } from "discord.js";
import { Client } from "discordx";
import "./bot";
import "./health";


ConfigValidator.validateConfig();

const token = process.env.TOKEN;

const rawGuildId = process.env.GUILD_ID?.trim();
if (!rawGuildId) {
  botLogger.error(
    "Could not find GUILD_ID in environment. Set GUILD_ID to a single server ID, " +
      "or a comma-separated list (e.g. GUILD_ID=123,456) to run the bot in multiple servers.",
  );
  throw Error("Could not find GUILD_ID in your environment");
}
const guildIds = rawGuildId
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Requesting a privileged intent Discord has not granted closes the gateway with
// 4014 and the process cannot start at all, so they are opt-in per environment.
const privilegedIntents = PRIVILEGED_INTENTS_ENABLED
  ? [
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildPresences,
      GatewayIntentBits.MessageContent,
    ]
  : [];

if (!PRIVILEGED_INTENTS_ENABLED) {
  botLogger.warn(
    "Running without privileged intents: member events, presence and message content are unavailable, so moderation filters and member tracking are disabled",
  );
}

// discord client config
export const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    ...privilegedIntents,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.GuildMember,
    Partials.GuildScheduledEvent,
    Partials.User,
  ],
  silent: false,
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 50,
  }),
  botGuilds: guildIds,
});

bot.once("clientReady", async () => {
  await bot.initApplicationCommands();
  if (BACKGROUND_WORKERS_ENABLED) {
    MemberUpdateQueueService.start();
  } else {
    botLogger.warn(
      "Background workers disabled: member updates will queue up and never be applied, so display names, avatars and roles will stay empty",
    );
  }

  botLogger.info("Bot started", { clientId: bot.user?.id });

  // Config is global but names are resolved per guild, so report anywhere a
  // configured role or channel does not actually exist.
  validateGuildConfig(bot);

  const BACKFILL_TIMEOUT_MS = 60_000;

  const backfillResults = await Promise.allSettled(
    bot.guilds.cache.map(async (guild) => {
      // Every member row points at this one, so it has to land first.
      await MembersService.upsertDbGuild(guild);

      const members = await Promise.race([
        guild.members.fetch(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("member fetch timed out")), BACKFILL_TIMEOUT_MS),
        ),
      ]);

      for (const member of members.values()) {
        if (member.user.bot) continue;
        await MembersService.upsertDbMember(member, "join");
      }
      botLogger.info(`Backfilled members for guild`, { guildId: guild.id, count: members.size });

      const firstMember = members.first();
      if (firstMember) await MembersService.updateMemberCount(firstMember);
    }),
  );

  backfillResults.forEach((result, i) => {
    if (result.status === "rejected") {
      const guild = bot.guilds.cache.at(i);
      botLogger.error(`Backfill failed for guild`, { guildId: guild?.id ?? "unknown", error: String(result.reason) });
    }
  });
});



bot.on("interactionCreate", (interaction) => {
  // Ignore DMs - only work in guild (server)
  if (!interaction.guild) return;
  // Skip command execution if not running in Docker
  // if (!process.env.DOCKER) return;
  void bot.executeInteraction(interaction);
});

bot.on("messageCreate", (message) => {
  // Ignore DMs - only work in guild (server)
  if (!message.guild) return;
  // // Skip command execution if not running in Docker
  // if (!process.env.DOCKER) return;
  void bot.executeCommand(message);
});

bot.on(
  "messageReactionAdd",
  (reaction, user) => void bot.executeReaction(reaction, user),
);

// discord.js rethrows an unhandled "error" event
bot.on("error", (e) => botLogger.error("Discord client error", { error: String(e) }));

bot.on("shardError", (e) => botLogger.error("Shard error", { error: String(e) }));

// A transient network fault must degrade, not kill the process: the container's
// restart policy can be defeated by a stale containerd task, turning a blip into
// a permanent outage.
process.on("unhandledRejection", (reason) => {
  botLogger.error("Unhandled rejection", { error: String(reason) });
});

process.on("uncaughtException", (err) => {
  botLogger.error("Uncaught exception", { error: String(err) });
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  botLogger.info("Received SIGTERM, shutting down");
  MemberUpdateQueueService.stop();
  await shutdownTelemetry();
  process.exit(0);
});

process.on("SIGINT", async () => {
  botLogger.info("Received SIGINT, shutting down");
  MemberUpdateQueueService.stop();
  await shutdownTelemetry();
  process.exit(0);
});

const main = async () => {
  if (!token) {
    botLogger.error("Could not find TOKEN in environment");
    throw Error("Could not find TOKEN in your environment");
  }

  await bot.login(token);

  bot.user?.setPresence(
    PRIVILEGED_INTENTS_ENABLED
      ? { activities: [{ name: "HEX4", type: ActivityType.Watching }] }
      : {
          status: "idle",
          activities: [
            {
              name: "limited mode - scam filters offline",
              type: ActivityType.Watching,
            },
          ],
        },
  );
};

main().catch((e) => {
  botLogger.error("Fatal startup error", { error: String(e) });
  process.exit(1);
});
