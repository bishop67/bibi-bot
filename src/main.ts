import "@dotenvx/dotenvx/config";

import { AttachmentRefreshQueueService } from "@/core/services/attachments/attachment-refresh-queue.service";
import { MemberUpdateQueueService } from "@/core/services/members/member-update-queue.service";
import { botLogger, shutdownTelemetry } from "@/lib/telemetry";
import { PRIVILEGED_INTENTS_ENABLED } from "@/shared/config/features";
import { ConfigValidator } from "@/shared/config/validator";
import { ActivityType, GatewayIntentBits, Partials } from "discord.js";
import { Client } from "discordx";
import "./bot";
import "./elysia";

ConfigValidator.validateConfig();

const token = process.env.TOKEN;

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
  silent: true,
  botGuilds: ["693908458986143824", "1314599700657340436"],
});

bot.once("clientReady", async () => {
  await bot.initApplicationCommands();
  process.env.DOCKER && MemberUpdateQueueService.start();
  process.env.DOCKER && AttachmentRefreshQueueService.start();
  botLogger.info("Bot started", { clientId: bot.user?.id });
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
  AttachmentRefreshQueueService.stop();
  await shutdownTelemetry();
  process.exit(0);
});

process.on("SIGINT", async () => {
  botLogger.info("Received SIGINT, shutting down");
  MemberUpdateQueueService.stop();
  AttachmentRefreshQueueService.stop();
  await shutdownTelemetry();
  process.exit(0);
});

const main = async () => {
  if (!token) {
    botLogger.error("Could not find TOKEN in environment");
    throw Error("Could not find TOKEN in your environment");
  }

  await bot.login(token);

  bot.user?.setPresence({
    activities: [{ name: ".gg/coding", type: ActivityType.Watching }],
  });
};

const PING_URL = "https://isolated-emili-spectredev-9a803c60.koyeb.app/api/api";
const PING_TIMEOUT_MS = 30_000;

const ping = async () => {
  try {
    const res = await fetch(PING_URL, {
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    res.body?.cancel().catch(() => {});
  } catch (e) {
    botLogger.warn("Ping failed", { error: String(e) });
  }
};

setInterval(() => void ping(), 300000);

main().catch((e) => {
  botLogger.error("Fatal startup error", { error: String(e) });
  process.exit(1);
});
