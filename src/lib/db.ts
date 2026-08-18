import "@dotenvx/dotenvx/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { resolve } from "path";
import postgres from "postgres";
import { botLogger } from "@/lib/telemetry";
import * as schema from "./db-schema";

const databaseUrl = process.env.DATABASE_URL!;

export const db = drizzle(postgres(databaseUrl, { onnotice: () => {}, max: 3 }), {
  schema,
});

/**
 * Resolves once migrations have finished, or failed.
 *
 * This used to be fired and forgotten, so the bot logged into Discord and
 * began querying while migrations were still running - a race it happened to
 * win most of the time, and would lose against a cold database or a slow
 * migration, with every query then hitting a table that did not exist yet.
 *
 * Deliberately resolves rather than rejects on failure: the container's
 * restart policy has been defeated before by a stale task, so degrading with a
 * loud error beats exiting on a transient database blip.
 */
export const migrationsReady: Promise<void> = process.env.STANDALONE
  ? Promise.resolve()
  : migrate(db, { migrationsFolder: resolve("drizzle") }).catch((e) => {
      botLogger.error(
        "Database migration failed - the bot is starting anyway, but any query against a missing or outdated table will fail",
        { error: String(e) },
      );
    });
