import { Database } from "bun:sqlite";
import { config } from "../lib/config";

/**
 * Application database (lobbies, races, results).
 *
 * Auth keeps its own file (`auth.db`) so that `better-auth` migrations never
 * collide with ours. `lobby.host_id` / `lobby_member.user_id` therefore hold
 * better-auth user ids without a foreign key.
 */
export const db = new Database(config.dbPath, { create: true });

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");

const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS lobby (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  host_id         TEXT NOT NULL,
  -- in_lobby | countdown | playing | finished
  status          TEXT NOT NULL DEFAULT 'in_lobby',
  visibility      TEXT NOT NULL DEFAULT 'public',
  max_players     INTEGER NOT NULL DEFAULT 8,
  rated           INTEGER NOT NULL DEFAULT 1,
  -- short | medium | long
  prompt_length   TEXT NOT NULL DEFAULT 'medium',
  current_race_id TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lobby_status     ON lobby (status, visibility, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_lobby_updated_at ON lobby (updated_at);

CREATE TABLE IF NOT EXISTS lobby_member (
  lobby_id     TEXT NOT NULL REFERENCES lobby (id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL,
  display_name TEXT NOT NULL,
  image        TEXT,
  -- host | player | spectator
  role         TEXT NOT NULL DEFAULT 'player',
  is_ready     INTEGER NOT NULL DEFAULT 0,
  connected    INTEGER NOT NULL DEFAULT 0,
  joined_at    INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (lobby_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_member_user ON lobby_member (user_id);

CREATE TABLE IF NOT EXISTS race (
  id          TEXT PRIMARY KEY,
  lobby_id    TEXT NOT NULL REFERENCES lobby (id) ON DELETE CASCADE,
  prompt_text TEXT NOT NULL,
  -- countdown | running | finished | aborted
  status      TEXT NOT NULL DEFAULT 'countdown',
  rated       INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  started_at  INTEGER,
  ends_at     INTEGER,
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_race_lobby ON race (lobby_id, created_at DESC);

CREATE TABLE IF NOT EXISTS race_result (
  id            TEXT PRIMARY KEY,
  race_id       TEXT NOT NULL REFERENCES race (id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  position      INTEGER,
  correct_chars INTEGER NOT NULL DEFAULT 0,
  keystrokes    INTEGER NOT NULL DEFAULT 0,
  wpm           REAL NOT NULL DEFAULT 0,
  accuracy      REAL NOT NULL DEFAULT 0,
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  finished      INTEGER NOT NULL DEFAULT 0,
  -- JSON array of fair-play flags, empty array when clean
  flags         TEXT NOT NULL DEFAULT '[]',
  created_at    INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_result_race_user ON race_result (race_id, user_id);
CREATE INDEX IF NOT EXISTS idx_result_user           ON race_result (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS profile (
  user_id    TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  best_score REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
`;

db.exec(SCHEMA);

/**
 * Nothing in-flight survives a restart: any lobby that was mid-race when the
 * process died is returned to `in_lobby`, and its race is marked aborted.
 */
function recoverFromRestart() {
  const now = Date.now();
  db.query(
    `UPDATE race SET status = 'aborted', finished_at = ?
     WHERE status IN ('countdown', 'running')`,
  ).run(now);
  db.query(
    `UPDATE lobby SET status = 'in_lobby', current_race_id = NULL, updated_at = ?
     WHERE status <> 'in_lobby'`,
  ).run(now);
  db.query(
    `UPDATE lobby_member SET connected = 0, is_ready = 0
     WHERE connected = 1 OR is_ready = 1`,
  ).run();
  db.query(
    `UPDATE lobby_member SET role = 'player'
     WHERE role = 'spectator'`,
  ).run();
}

recoverFromRestart();
