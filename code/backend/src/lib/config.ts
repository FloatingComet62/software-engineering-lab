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

  socket: {
    path: "/socket.io/",
  },

  lobby: {
    /** Length of the human-typed join code. */
    codeLength: 6,
    /** Alphabet without visually ambiguous glyphs (no I/O/0/1). */
    codeAlphabet: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
    defaultMaxPlayers: 8,
    hardMaxPlayers: 16,
    /** How many connected players the host needs before a race can start. */
    minPlayersToStart: int(process.env.MIN_PLAYERS_TO_START, 2),
    /** Lobbies untouched for this long are garbage collected. */
    idleTtlMs: 6 * 60 * 60 * 1000,
    /** Sweep interval for the garbage collector. */
    sweepIntervalMs: 10 * 60 * 1000,
    /**
     * How long a member keeps their seat after their last socket drops.
     * Covers refreshes and flaky networks without stranding empty seats.
     */
    disconnectGraceMs: 20_000,
  },

  race: {
    /** Synchronised countdown between `race:countdown` and `race:started`. */
    countdownMs: 5_000,
    /** Broadcast cadence for batched cursor updates (20 Hz). */
    tickIntervalMs: 50,
    /** Hard ceiling on a single race. */
    maxDurationMs: 5 * 60 * 1000,
    /** Once someone finishes, everyone else gets at most this long. */
    graceAfterFirstFinishMs: 45_000,
    /** How long the finished standings stay up before the lobby reopens. */
    resultsDurationMs: 12_000,
    /** Fair play: sustained correct-characters-per-second ceiling. */
    maxCharsPerSecond: 22,
    /** Fair play: a single jump larger than this looks like a paste. */
    pasteJumpChars: 24,
  },
} as const;

export type Config = typeof config;
