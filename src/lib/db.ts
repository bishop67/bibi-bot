import "@dotenvx/dotenvx/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { resolve } from "path";
import postgres from "postgres";
import { botLogger } from "@/lib/telemetry";
import * as schema from "./db-schema";

const databaseUrl = process.env.DATABASE_URL!;

export const db = drizzle(
  postgres(databaseUrl, { onnotice: () => {}, max: 3 }),
  {
    schema,
  },
);

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

/**
 * Postgres and postgres-js codes that mean "the database is not available
 * right now", as opposed to "this statement was wrong".
 *
 * The distinction matters because the two call for opposite responses: a bad
 * statement should be dropped or parked so it stops blocking the work behind
 * it, while an unavailable database should simply be left alone for a while.
 * Retrying into an unavailable Neon compute is worse than useless - every
 * attempt still counts as activity, so a tight retry loop spends the very
 * compute quota whose exhaustion caused the error in the first place.
 */
const DATABASE_UNAVAILABLE_CODES = new Set([
  "53000", // insufficient_resources - Neon's compute time quota is spent
  "53100", // disk_full
  "53200", // out_of_memory
  "53300", // too_many_connections
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now - compute still waking
  "08000", // connection_exception
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08003", // connection_does_not_exist
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
  "08006", // connection_failure
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EPIPE",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECTION_ENDED",
]);

/**
 * Drizzle wraps driver errors in a DrizzleQueryError, so the code that
 * identifies the failure sits on `cause` rather than on the error itself -
 * checking only the top-level error finds nothing and misclassifies every
 * outage as a bad statement.
 */
export function isDatabaseUnavailable(err: unknown): boolean {
  for (let current = err, depth = 0; current && depth < 8; depth++) {
    if (
      typeof current === "object" &&
      "code" in current &&
      typeof current.code === "string" &&
      DATABASE_UNAVAILABLE_CODES.has(current.code)
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}
