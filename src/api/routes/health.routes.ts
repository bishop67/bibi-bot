import { db } from "@/lib/db";
import { bot } from "@/main";
import { sql } from "drizzle-orm";
import { Elysia, status } from "elysia";

const MB = 1024 * 1024;

export const healthRoutes = new Elysia()
  /**
   * Liveness. Deliberately touches nothing external, so an uptime monitor can
   * poll it as often as it likes without waking the database or spending Neon
   * compute hours.
   *
   * Returns 503 rather than a cheerful 200 when the gateway is down: a bot that
   * cannot receive a single message is not healthy, and a monitor that only
   * checks for a response would never notice.
   */
  .get("/health", () => {
    const mem = process.memoryUsage();
    const ready = bot.isReady();

    const body = {
      status: ready ? "ok" : "starting",
      uptimeSeconds: Math.floor(process.uptime()),
      discord: {
        ready,
        // -1 until the first heartbeat completes
        websocketPingMs: Math.round(bot.ws.ping),
        guilds: bot.guilds.cache.size,
      },
      memory: {
        rssMb: Math.round(mem.rss / MB),
        heapUsedMb: Math.round(mem.heapUsed / MB),
      },
    };

    return ready ? body : status(503, body);
  })

  /**
   * Readiness. Same as above plus a database round trip, kept on its own route
   * because polling this every minute would hold the Neon instance permanently
   * awake and eat its compute budget. Point deploy checks here, monitors above.
   */
  .get("/health/ready", async () => {
    let database: "ok" | "unreachable" = "ok";

    try {
      await db.execute(sql`SELECT 1`);
    } catch {
      database = "unreachable";
    }

    const discordReady = bot.isReady();
    const ready = discordReady && database === "ok";

    const body = {
      status: ready ? "ok" : "degraded",
      discord: discordReady ? "ok" : "not ready",
      database,
    };

    return ready ? body : status(503, body);
  });
