export type RatedPlayer = {
	userId: string;
	rating: number;
	position: number | null;
	finished: boolean;
};

/** Pairwise Elo averaged over opponents; all expectations use pre-race ratings. */
export function calculateChanges(players: RatedPlayer[]): Map<string, number> {
	if (players.length < 2 || !players.some((player) => player.finished))
		return new Map();
	const raw = players.map((player) => {
		let change = 0;
		for (const other of players) {
			if (other.userId === player.userId) continue;
			const score =
				player.finished && !other.finished
					? 1
					: !player.finished && other.finished
						? 0
						: !player.finished
							? 0.5
							: player.position === other.position
								? 0.5
								: (player.position ?? Infinity) < (other.position ?? Infinity)
									? 1
									: 0;
			const expected = 1 / (1 + 10 ** ((other.rating - player.rating) / 400));
			change += (32 * (score - expected)) / (players.length - 1);
		}
		return change;
	});
	// Largest-remainder rounding keeps integer updates exactly zero-sum.
	const rounded = raw.map(Math.floor);
	const remaining = -rounded.reduce((sum, change) => sum + change, 0);
	const order = raw
		.map((value, index) => ({ index, remainder: value - Math.floor(value) }))
		.sort(
			(a, b) =>
				b.remainder - a.remainder ||
				players[a.index]!.userId.localeCompare(players[b.index]!.userId),
		);
	for (let i = 0; i < remaining; i++) rounded[order[i]!.index]! += 1;
	return new Map(
		players.map((player, index) => [player.userId, rounded[index]!]),
	);
}
export function tier(rating: number) {
	return rating >= 1800
		? "Master"
		: rating >= 1600
			? "Diamond"
			: rating >= 1400
				? "Platinum"
				: rating >= 1200
					? "Gold"
					: rating >= 1000
						? "Silver"
						: "Bronze";
}
