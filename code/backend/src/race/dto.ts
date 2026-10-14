import { resultRating } from "../rating/repo";
import type { RaceResultRow } from "./repo";

/** Maps a persisted result row to the shape the frontend consumes. */
export function toResultDTO(row: RaceResultRow) {
	return {
		...resultRating(row.race_id, row.user_id),
		userId: row.user_id,
		displayName: row.display_name,
		position: row.position,
		wpm: row.wpm,
		accuracy: row.accuracy,
		correctChars: row.correct_chars,
		durationMs: row.duration_ms,
		finished: row.finished === 1,
		flags: JSON.parse(row.flags) as string[],
	};
}
