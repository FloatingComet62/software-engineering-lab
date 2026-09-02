import { db } from "../db";

export type RaceStatus = "countdown" | "running" | "finished" | "aborted";

export type RaceRow = {
  id: string;
  lobby_id: string;
  prompt_text: string;
  status: RaceStatus;
  rated: number;
  created_at: number;
  started_at: number | null;
  ends_at: number | null;
  finished_at: number | null;
};

export type RaceResultRow = {
  id: string;
  race_id: string;
  user_id: string;
  display_name: string;
  position: number | null;
  correct_chars: number;
  keystrokes: number;
  wpm: number;
  accuracy: number;
  duration_ms: number;
  finished: number;
  flags: string;
  created_at: number;
};

export function insertRace(input: {
  id: string;
  lobbyId: string;
  promptText: string;
  rated: boolean;
  endsAt: number;
}): void {
  db.query(
    `INSERT INTO race (id, lobby_id, prompt_text, status, rated, created_at, ends_at)
     VALUES (?, ?, ?, 'countdown', ?, ?, ?)`,
  ).run(
    input.id,
    input.lobbyId,
    input.promptText,
    input.rated ? 1 : 0,
    Date.now(),
    input.endsAt,
  );
}

export function markRaceRunning(id: string, startedAt: number, endsAt: number) {
  db.query(
    "UPDATE race SET status = 'running', started_at = ?, ends_at = ? WHERE id = ?",
  ).run(startedAt, endsAt, id);
}

export function markRaceEnded(
  id: string,
  status: "finished" | "aborted",
  finishedAt: number,
) {
  db.query("UPDATE race SET status = ?, finished_at = ? WHERE id = ?").run(
    status,
    finishedAt,
    id,
  );
}

export type InsertResult = {
  raceId: string;
  userId: string;
  displayName: string;
  position: number | null;
  correctChars: number;
  keystrokes: number;
  wpm: number;
  accuracy: number;
  durationMs: number;
  finished: boolean;
  flags: string[];
};

const insertResultStatement = db.query(
  `INSERT INTO race_result
     (id, race_id, user_id, display_name, position, correct_chars, keystrokes,
      wpm, accuracy, duration_ms, finished, flags, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT (race_id, user_id) DO NOTHING`,
);

/** Persists a whole race's standings in one transaction. */
export const insertResults = db.transaction((results: InsertResult[]) => {
  const now = Date.now();
  for (const result of results) {
    insertResultStatement.run(
      crypto.randomUUID(),
      result.raceId,
      result.userId,
      result.displayName,
      result.position,
      result.correctChars,
      result.keystrokes,
      result.wpm,
      result.accuracy,
      result.durationMs,
      result.finished ? 1 : 0,
      JSON.stringify(result.flags),
      now,
    );
  }
});

export function findRace(id: string): RaceRow | null {
  return (db.query("SELECT * FROM race WHERE id = ?").get(id) as RaceRow) ?? null;
}

export function listResults(raceId: string): RaceResultRow[] {
  return db
    .query(
      `SELECT * FROM race_result WHERE race_id = ?
       ORDER BY finished DESC, position ASC, wpm DESC`,
    )
    .all(raceId) as RaceResultRow[];
}

/** Recent finished races for a lobby, newest first. */
export function listLobbyRaces(lobbyId: string, limit: number): RaceRow[] {
  return db
    .query(
      `SELECT * FROM race WHERE lobby_id = ? AND status = 'finished'
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(lobbyId, limit) as RaceRow[];
}
