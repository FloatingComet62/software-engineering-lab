import { expect, test } from "bun:test";

test("rating ledger is idempotent, persistent, provisional and excludes flagged races", () => {
	// A separate process avoids sharing the application DB/config with other tests.
	const modulePath = `${import.meta.dir}/repo.ts`;
	const source = `
    import { applyRatings, getRating, leaderboard, resultRating } from ${JSON.stringify(modulePath)};
    import assert from "node:assert/strict";
    const result = (userId, position) => ({ userId, displayName: userId, position, wpm: 60, accuracy: 1, correctChars: 100, durationMs: 20000, finished: true, flags: [] });
    const results = [result("a", 1), result("b", 2)];
    assert.equal(getRating("a").rating, 1000);
    const first = applyRatings("first", results);
    assert.equal(first[0].ratingAfter, 1016);
    assert.equal(first[1].ratingAfter, 984);
    assert.deepEqual(applyRatings("first", results), first);
    assert.equal(getRating("a").races, 1);
    assert.equal(resultRating("first", "a").ratingChange, 16);
    applyRatings("flagged", [{ ...results[0], flags: ["impossible_rate"] }, results[1]]);
    assert.equal(getRating("a").races, 1);
    assert.equal(getRating("b").races, 1);
    assert.equal(leaderboard().length, 0);
    for (let i = 0; i < 9; i++) applyRatings("race-" + i, results);
    assert.equal(getRating("a").provisional, false);
    assert.equal(getRating("a").wins, 10);
    assert.equal(leaderboard().length, 2);
    assert.equal(leaderboard()[0].userId, "a");
    assert.equal(getRating("a").rating + getRating("b").rating, 2000);
  `;
	const child = Bun.spawnSync([process.execPath, "-e", source], {
		env: { ...process.env, APP_DB_PATH: ":memory:" },
		stdout: "pipe",
		stderr: "pipe",
	});
	expect(new TextDecoder().decode(child.stderr)).toBe("");
	expect(child.exitCode).toBe(0);
});
