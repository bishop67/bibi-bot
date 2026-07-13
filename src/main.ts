import "@dotenvx/dotenvx/config";

import { AttachmentRefreshQueueService } from "@/core/services/attachments/attachment-refresh-queue.service";
import { MemberUpdateQueueService } from "@/core/services/members/member-update-queue.service";
import { MembersService } from "@/core/services/members/members.service";
import { botLogger, shutdownTelemetry } from "@/lib/telemetry";
import { ConfigValidator } from "@/shared/config/validator";
import { ActivityType, GatewayIntentBits, Options, Partials } from "discord.js";
import { Client } from "discordx";
import "./bot";
import "./elysia";


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
const guildIds = rawGuildId.split(",").map((s) => s.trim()).filter(Boolean);

// discord client config
export const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
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
  process.env.DOCKER && MemberUpdateQueueService.start();
  process.env.DOCKER && AttachmentRefreshQueueService.start();
  botLogger.info("Bot started", { clientId: bot.user?.id });

  const BACKFILL_TIMEOUT_MS = 60_000;

  const backfillResults = await Promise.allSettled(
    bot.guilds.cache.map(async (guild) => {
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

// Graceful shutdown
process.on("SIGTERM", async () => {
  botLogger.info("Received SIGTERM, shutting down");
  MemberUpdateQueueService.stop();
  AttachmentRefreshQueueService.stop();
  await shutdownTelemetry();
  process.exit(0);
});

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
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
    activities: [{ name: "HEX4", type: ActivityType.Watching }],
  });
};

setInterval(
  () =>
    fetch("https://isolated-emili-spectredev-9a803c60.koyeb.app/api/api").catch(
      (e) => botLogger.error("Ping error", { error: String(e) }),
    ),
  300000,
);

main().catch((err) => console.error("MAIN FAILED:", err));
