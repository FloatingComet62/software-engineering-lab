import { describe, expect, test } from "bun:test";
import { calculateChanges, tier } from "./elo";

const player = (
	userId: string,
	rating: number,
	position: number | null,
	finished = true,
) => ({ userId, rating, position, finished });
describe("Typing Rating", () => {
	test("equal opponents exchange 16 points", () => {
		expect([
			...calculateChanges([
				player("a", 1000, 1),
				player("b", 1000, 2),
			]).values(),
		]).toEqual([16, -16]);
	});
	test("an upset earns more than an expected win", () => {
		const upset = calculateChanges([
			player("a", 1000, 1),
			player("b", 1400, 2),
		]);
		const expected = calculateChanges([
			player("a", 1400, 1),
			player("b", 1000, 2),
		]);
		expect(upset.get("a")!).toBeGreaterThan(expected.get("a")!);
		expect(upset.get("a")).toBe(29);
		expect(expected.get("a")).toBe(3);
	});
	test("a larger race averages opponents rather than multiplying rewards", () => {
		const changes = calculateChanges(
			Array.from({ length: 8 }, (_, i) => player(`${i}`, 1000, i + 1)),
		);
		expect(changes.get("0")).toBe(16);
		expect(changes.get("7")).toBe(-16);
		expect([...changes.values()].reduce((a, b) => a + b, 0)).toBe(0);
	});
	test("nonfinishers lose to finishers and tie each other", () => {
		expect([
			...calculateChanges([
				player("a", 1000, 1),
				player("b", 1000, null, false),
				player("c", 1000, null, false),
			]).values(),
		]).toEqual([16, -8, -8]);
	});
	test("solo and no-finisher races do not change ratings", () => {
		expect(calculateChanges([player("a", 1000, 1)]).size).toBe(0);
		expect(
			calculateChanges([
				player("a", 1000, null, false),
				player("b", 1000, null, false),
			]).size,
		).toBe(0);
	});
	test("rounding is zero-sum, bounded and independent of input order", () => {
		for (let n = 2; n <= 16; n++) {
			const players = Array.from({ length: n }, (_, i) =>
				player(`user-${i}`, 600 + ((i * 137) % 1500), n - i),
			);
			const changes = calculateChanges(players);
			expect([...changes.values()].reduce((a, b) => a + b, 0)).toBe(0);
			expect(
				[...changes.values()].every(
					(change) => Number.isInteger(change) && Math.abs(change) <= 32,
				),
			).toBe(true);
			const reversed = calculateChanges([...players].reverse());
			for (const [id, change] of changes) expect(reversed.get(id)).toBe(change);
		}
	});
	test("tier boundaries are stable", () => {
		expect([999, 1000, 1200, 1400, 1600, 1800].map(tier)).toEqual([
			"Bronze",
			"Silver",
			"Gold",
			"Platinum",
			"Diamond",
			"Master",
		]);
	});
});
