/**
 * Central runtime configuration.
 *
 * Everything tunable about the lobby / race lifecycle lives here so the
 * frontend integration document can quote exact numbers and so tests can
 * reason about timing without grepping the codebase.
 */

function int(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const frontendUrls = (process.env.FRONTEND_URL ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const config = {
  port: int(process.env.PORT, 8787),

  /** Every allowed browser origin (CORS + better-auth trusted origins). */
  frontendUrls,
  /** Canonical origin, used where a single value is required. */
  frontendUrl: frontendUrls[0] ?? "http://localhost:3000",

  /** Application database (lobbies / races). Auth lives in its own file. */
  dbPath: process.env.APP_DB_PATH ?? "./app.db",
} as const;

export type Config = typeof config;
