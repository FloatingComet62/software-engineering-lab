import { db } from "../db";
import type { RaceFinishSummary } from "../realtime/events";
import { calculateChanges, tier } from "./elo";

db.exec(`
  CREATE TABLE IF NOT EXISTS typing_rating (
    user_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    rating INTEGER NOT NULL DEFAULT 1000,
    races INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rating_change (
    race_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    rating_before INTEGER NOT NULL,
    rating_after INTEGER NOT NULL,
    change INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (race_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_typing_rating_board ON typing_rating(rating DESC);
`);
type RatingRow = {
	user_id: string;
	display_name: string;
	rating: number;
	races: number;
	wins: number;
};
export function getRating(userId: string) {
	const row = db
		.query<RatingRow, [string]>("SELECT * FROM typing_rating WHERE user_id = ?")
		.get(userId);
	const rating = row?.rating ?? 1000;
	const races = row?.races ?? 0;
	return {
		rating,
		races,
		wins: row?.wins ?? 0,
		tier: tier(rating),
		provisional: races < 10,
		placementRemaining: Math.max(0, 10 - races),
	};
}
/** Ledger and ratings commit together; retries cannot apply a race twice. */
export const applyRatings = db.transaction(
	(raceId: string, results: RaceFinishSummary[]) => {
		const prior = db
			.query<
				{
					user_id: string;
					rating_before: number;
					rating_after: number;
					change: number;
				},
				[string]
			>("SELECT * FROM rating_change WHERE race_id = ?")
			.all(raceId);
		if (prior.length)
			return results.map((result) => {
				const row = prior.find((item) => item.user_id === result.userId);
				return row
					? {
							...result,
							ratingBefore: row.rating_before,
							ratingAfter: row.rating_after,
							ratingChange: row.change,
						}
					: result;
			});
		if (results.length < 2 || results.some((result) => result.flags.length > 0))
			return results;
		const before = results.map((result) => ({
			...result,
			rating: getRating(result.userId).rating,
		}));
		const changes = calculateChanges(before);
		if (!changes.size) return results;
		const now = Date.now();
		return before.map((result) => {
			const change = changes.get(result.userId)!;
			const after = result.rating + change;
			db.query(`INSERT INTO typing_rating (user_id, display_name, rating, races, wins, updated_at) VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET display_name = excluded.display_name, rating = excluded.rating, races = races + 1, wins = wins + excluded.wins, updated_at = excluded.updated_at`).run(
				result.userId,
				result.displayName,
				after,
				result.position === 1 && result.finished ? 1 : 0,
				now,
			);
			db.query(
				"INSERT INTO rating_change (race_id, user_id, rating_before, rating_after, change, created_at) VALUES (?, ?, ?, ?, ?, ?)",
			).run(raceId, result.userId, result.rating, after, change, now);
			return {
				...results.find((original) => original.userId === result.userId)!,
				ratingBefore: result.rating,
				ratingAfter: after,
				ratingChange: change,
			};
		});
	},
);
export function leaderboard() {
	return db
		.query<RatingRow, []>(
			"SELECT * FROM typing_rating WHERE races >= 10 ORDER BY rating DESC, wins DESC, user_id LIMIT 50",
		)
		.all()
		.map((row, index) => ({
			rank: index + 1,
			userId: row.user_id,
			name: row.display_name,
			...getRating(row.user_id),
		}));
}

export function resultRating(raceId: string, userId: string) {
	const row = db
		.query<
			{ rating_before: number; rating_after: number; change: number },
			[string, string]
		>(
			"SELECT rating_before, rating_after, change FROM rating_change WHERE race_id = ? AND user_id = ?",
		)
		.get(raceId, userId);
	return row
		? {
				ratingBefore: row.rating_before,
				ratingAfter: row.rating_after,
				ratingChange: row.change,
			}
		: {};
}
