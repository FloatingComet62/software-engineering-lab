import { db } from "../db";
import { config } from "../lib/config";
import type {
  LobbyMemberRow,
  LobbyRow,
  LobbyStatus,
  LobbyVisibility,
  MemberRole,
  PromptLength,
} from "./types";

/* ------------------------------------------------------------------ codes */

/**
 * Generates a join code from an alphabet with no visually ambiguous glyphs,
 * retrying on the (very unlikely) unique-index collision.
 */
export function generateUniqueCode(): string {
  const { codeAlphabet, codeLength } = config.lobby;
  for (let attempt = 0; attempt < 16; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(codeLength));
    let code = "";
    for (const byte of bytes) code += codeAlphabet[byte % codeAlphabet.length];
    if (!findByCode(code)) return code;
  }
  throw new Error("Could not allocate a unique lobby code");
}

/** Normalises user input ("abc-123" / " AbC123 ") into a canonical code. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/* ------------------------------------------------------------------ lobby */

export function findById(id: string): LobbyRow | null {
  return (
    (db.query("SELECT * FROM lobby WHERE id = ?").get(id) as LobbyRow) ?? null
  );
}

export function findByCode(code: string): LobbyRow | null {
  return (
    (db.query("SELECT * FROM lobby WHERE code = ?").get(code) as LobbyRow) ??
    null
  );
}

export type InsertLobby = {
  id: string;
  code: string;
  name: string;
  hostId: string;
  visibility: LobbyVisibility;
  maxPlayers: number;
  rated: boolean;
  promptLength: PromptLength;
};

export function insertLobby(input: InsertLobby): LobbyRow {
  const now = Date.now();
  db.query(
    `INSERT INTO lobby
       (id, code, name, host_id, status, visibility, max_players, rated,
        prompt_length, current_race_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'in_lobby', ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(
    input.id,
    input.code,
    input.name,
    input.hostId,
    input.visibility,
    input.maxPlayers,
    input.rated ? 1 : 0,
    input.promptLength,
    now,
    now,
  );
  return findById(input.id)!;
}

export type UpdateLobbyPatch = {
  name?: string;
  visibility?: LobbyVisibility;
  maxPlayers?: number;
  rated?: boolean;
  promptLength?: PromptLength;
};

export function updateLobby(
  id: string,
  patch: UpdateLobbyPatch,
): LobbyRow | null {
  const sets: string[] = [];
  const values: (string | number)[] = [];

  if (patch.name !== undefined) {
    sets.push("name = ?");
    values.push(patch.name);
  }
  if (patch.visibility !== undefined) {
    sets.push("visibility = ?");
    values.push(patch.visibility);
  }
  if (patch.maxPlayers !== undefined) {
    sets.push("max_players = ?");
    values.push(patch.maxPlayers);
  }
  if (patch.rated !== undefined) {
    sets.push("rated = ?");
    values.push(patch.rated ? 1 : 0);
  }
  if (patch.promptLength !== undefined) {
    sets.push("prompt_length = ?");
    values.push(patch.promptLength);
  }
  if (sets.length === 0) return findById(id);

  sets.push("updated_at = ?");
  values.push(Date.now(), id);
  db.query(`UPDATE lobby SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return findById(id);
}

export function setStatus(
  id: string,
  status: LobbyStatus,
  currentRaceId: string | null = null,
): void {
  db.query(
    "UPDATE lobby SET status = ?, current_race_id = ?, updated_at = ? WHERE id = ?",
  ).run(status, currentRaceId, Date.now(), id);
}

export function setHost(id: string, hostId: string): void {
  db.query("UPDATE lobby SET host_id = ?, updated_at = ? WHERE id = ?").run(
    hostId,
    Date.now(),
    id,
  );
}

export function touch(id: string): void {
  db.query("UPDATE lobby SET updated_at = ? WHERE id = ?").run(Date.now(), id);
}

export function deleteLobby(id: string): void {
  db.query("DELETE FROM lobby WHERE id = ?").run(id);
}

export type ListFilter = {
  status?: LobbyStatus;
  visibility?: LobbyVisibility;
  limit: number;
  offset: number;
};

export function listLobbies(filter: ListFilter): {
  rows: LobbyRow[];
  total: number;
} {
  const where: string[] = [];
  const values: (string | number)[] = [];

  if (filter.status) {
    where.push("status = ?");
    values.push(filter.status);
  }
  if (filter.visibility) {
    where.push("visibility = ?");
    values.push(filter.visibility);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = (
    db.query(`SELECT COUNT(*) AS n FROM lobby ${clause}`).get(...values) as {
      n: number;
    }
  ).n;

  const rows = db
    .query(
      `SELECT * FROM lobby ${clause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...values, filter.limit, filter.offset) as LobbyRow[];

  return { rows, total };
}

/** Lobbies with no activity since `olderThan`; used by the sweeper. */
export function findStaleLobbyIds(olderThan: number): string[] {
  return (
    db.query("SELECT id FROM lobby WHERE updated_at < ?").all(olderThan) as {
      id: string;
    }[]
  ).map((row) => row.id);
}

/* ----------------------------------------------------------------- member */

export function listMembers(lobbyId: string): LobbyMemberRow[] {
  return db
    .query(
      "SELECT * FROM lobby_member WHERE lobby_id = ? ORDER BY joined_at ASC",
    )
    .all(lobbyId) as LobbyMemberRow[];
}

export function findMember(
  lobbyId: string,
  userId: string,
): LobbyMemberRow | null {
  return (
    (db
      .query("SELECT * FROM lobby_member WHERE lobby_id = ? AND user_id = ?")
      .get(lobbyId, userId) as LobbyMemberRow) ?? null
  );
}

/** Every lobby this user is currently a member of. */
export function findMembershipsOf(userId: string): LobbyMemberRow[] {
  return db
    .query("SELECT * FROM lobby_member WHERE user_id = ?")
    .all(userId) as LobbyMemberRow[];
}

export function countPlayers(lobbyId: string): number {
  return (
    db
      .query(
        "SELECT COUNT(*) AS n FROM lobby_member WHERE lobby_id = ? AND role <> 'spectator'",
      )
      .get(lobbyId) as { n: number }
  ).n;
}

export type UpsertMember = {
  lobbyId: string;
  userId: string;
  displayName: string;
  image: string | null;
  role: MemberRole;
};

export function upsertMember(input: UpsertMember): LobbyMemberRow {
  const now = Date.now();
  db.query(
    `INSERT INTO lobby_member
       (lobby_id, user_id, display_name, image, role, is_ready, connected,
        joined_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)
     ON CONFLICT (lobby_id, user_id) DO UPDATE SET
       display_name = excluded.display_name,
       image        = excluded.image,
       last_seen_at = excluded.last_seen_at`,
  ).run(
    input.lobbyId,
    input.userId,
    input.displayName,
    input.image,
    input.role,
    now,
    now,
  );
  return findMember(input.lobbyId, input.userId)!;
}

export function setMemberRole(
  lobbyId: string,
  userId: string,
  role: MemberRole,
): void {
  db.query(
    "UPDATE lobby_member SET role = ? WHERE lobby_id = ? AND user_id = ?",
  ).run(role, lobbyId, userId);
}

export function setMemberReady(
  lobbyId: string,
  userId: string,
  ready: boolean,
): void {
  db.query(
    "UPDATE lobby_member SET is_ready = ? WHERE lobby_id = ? AND user_id = ?",
  ).run(ready ? 1 : 0, lobbyId, userId);
}

export function setMemberConnected(
  lobbyId: string,
  userId: string,
  connected: boolean,
): void {
  db.query(
    "UPDATE lobby_member SET connected = ?, last_seen_at = ? WHERE lobby_id = ? AND user_id = ?",
  ).run(connected ? 1 : 0, Date.now(), lobbyId, userId);
}

export function clearReadyFlags(lobbyId: string): void {
  db.query("UPDATE lobby_member SET is_ready = 0 WHERE lobby_id = ?").run(
    lobbyId,
  );
}

/** Promotes spectators to players, oldest first, up to `slots` of them. */
export function promoteSpectators(lobbyId: string, slots: number): string[] {
  if (slots <= 0) return [];
  const candidates = db
    .query(
      `SELECT user_id FROM lobby_member
       WHERE lobby_id = ? AND role = 'spectator'
       ORDER BY joined_at ASC LIMIT ?`,
    )
    .all(lobbyId, slots) as { user_id: string }[];

  for (const candidate of candidates) {
    setMemberRole(lobbyId, candidate.user_id, "player");
  }
  return candidates.map((candidate) => candidate.user_id);
}

export function removeMember(lobbyId: string, userId: string): void {
  db.query("DELETE FROM lobby_member WHERE lobby_id = ? AND user_id = ?").run(
    lobbyId,
    userId,
  );
}

/** Oldest remaining member, preferring players over spectators. */
export function pickSuccessorHost(lobbyId: string): LobbyMemberRow | null {
  return (
    (db
      .query(
        `SELECT * FROM lobby_member WHERE lobby_id = ?
         ORDER BY (role = 'spectator') ASC, joined_at ASC LIMIT 1`,
      )
      .get(lobbyId) as LobbyMemberRow) ?? null
  );
}
