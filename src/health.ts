import { db } from "@/lib/db";
import { botLogger } from "@/lib/telemetry";
import { bot } from "@/main";
import { sql } from "drizzle-orm";
import { createServer } from "node:http";

const PORT = Number(process.env.HEALTH_PORT) || 4000;
const MB = 1024 * 1024;

/**
 * A bare health server on node's built-in http.
 *
 * This replaced a full Elysia API that existed to serve a website. Keeping a
 * framework, CORS, and an OpenAPI generator resident just to answer two routes
 * is not a good trade on a 512MB box, and `bot` is only ever touched inside a
 * request handler so the import cycle with main.ts resolves before any request
 * can arrive.
 */
function liveness() {
  const mem = process.memoryUsage();
  const ready = bot.isReady();

  return {
    ok: ready,
    body: {
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
    },
  };
}

async function readiness() {
  let database: "ok" | "unreachable" = "ok";

  try {
    await db.execute(sql`SELECT 1`);
  } catch {
    database = "unreachable";
  }

  const discordReady = bot.isReady();
  const ok = discordReady && database === "ok";

  return {
    ok,
    body: {
      status: ok ? "ok" : "degraded",
      discord: discordReady ? "ok" : "not ready",
      database,
    },
  };
}

export const healthServer = createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0];

  try {
    // Readiness adds a database round trip, so it sits on its own route:
    // polling it every minute would hold the Neon instance awake and spend its
    // compute budget. Point monitors at /health, deploy checks at /health/ready.
    const result =
      path === "/health"
        ? liveness()
        : path === "/health/ready"
          ? await readiness()
          : null;

    if (!result) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "not found" }));
      return;
    }

    // 503 rather than a cheerful 200 when the gateway is down: a bot that
    // cannot receive a message is not healthy, and a monitor checking only for
    // a response would never notice.
    res.writeHead(result.ok ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify(result.body));
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "error" }));
    botLogger.error("Health check failed", { error: String(e) });
  }
}).listen(PORT, () => {
  botLogger.info("Health server started", { port: PORT });
});
