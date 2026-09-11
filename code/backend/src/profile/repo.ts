import { db } from "../db";

export type ProfileRow = {
  user_id: string;
  name: string;
  email: string;
  best_score: number;
  updated_at: number;
};

/** Reads the profile, creating it from the session on first sight. */
export function getOrCreate(user: { id: string; name: string; email: string }): ProfileRow {
  const existing = db
    .query<ProfileRow, [string]>("SELECT * FROM profile WHERE user_id = ?")
    .get(user.id);
  if (existing) {
    if (existing.name !== user.name || existing.email !== user.email) {
      db.query(
        "UPDATE profile SET name = ?, email = ?, updated_at = ? WHERE user_id = ?",
      ).run(user.name, user.email, Date.now(), user.id);
      return { ...existing, name: user.name, email: user.email };
    }
    return existing;
  }

  const row: ProfileRow = {
    user_id: user.id,
    name: user.name,
    email: user.email,
    best_score: 0,
    updated_at: Date.now(),
  };
  db.query(
    "INSERT INTO profile (user_id, name, email, best_score, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(row.user_id, row.name, row.email, row.best_score, row.updated_at);
  return row;
}

export function setBestScore(userId: string, score: number): void {
  db.query(
    "UPDATE profile SET best_score = ?, updated_at = ? WHERE user_id = ? AND best_score < ?",
  ).run(score, Date.now(), userId, score);
}
