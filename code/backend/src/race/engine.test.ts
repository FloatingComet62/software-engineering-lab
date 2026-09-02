import { describe, expect, test } from "bun:test";
import { computeAccuracy, computeWpm, Race } from "./engine";

const TEXT = "the quick brown fox";
const T0 = 1_000_000;

function runningRace(text = TEXT) {
  const race = new Race("race-1", "lobby-1", text, true, T0);
  race.add({
    userId: "a",
    displayName: "A",
    image: null,
    spectator: false,
    connected: true,
  });
  race.add({
    userId: "b",
    displayName: "B",
    image: null,
    spectator: false,
    connected: true,
  });
  race.add({
    userId: "s",
    displayName: "S",
    image: null,
    spectator: true,
    connected: true,
  });
  race.status = "running";
  race.startedAt = T0;
  return race;
}

describe("scoring", () => {
  test("wpm uses the five-characters-per-word convention", () => {
    expect(Math.round(computeWpm(60, 60_000))).toBe(12);
    expect(computeWpm(0, 60_000)).toBe(0);
    expect(computeWpm(60, 0)).toBe(0);
  });

  test("accuracy is correct characters over keys pressed", () => {
    expect(computeAccuracy(90, 100)).toBeCloseTo(0.9);
    expect(computeAccuracy(0, 0)).toBe(0);
    // A client under-reporting keystrokes cannot exceed 100%.
    expect(computeAccuracy(100, 10)).toBe(1);
  });
});

describe("progress", () => {
  test("backspacing lowers the caret but not the scoring high-water mark", () => {
    const race = runningRace();
    race.applyProgress("a", 5, 6, T0 + 1_000);
    race.applyProgress("a", 2, 8, T0 + 1_200);

    expect(race.get("a")!.cursor).toBe(2);
    expect(race.get("a")!.maxCursor).toBe(5);
  });

  test("spectators cannot report progress", () => {
    const race = runningRace();
    race.applyProgress("s", 10, 10, T0 + 1_000);
    expect(race.get("s")!.maxCursor).toBe(0);
  });

  test("progress is ignored before the gun and after finishing", () => {
    const race = runningRace();
    race.status = "countdown";
    expect(race.applyProgress("a", 5, 5, T0).accepted).toBe(false);

    race.status = "running";
    race.applyProgress("a", TEXT.length, 20, T0 + 3_000);
    expect(race.applyProgress("a", TEXT.length, 99, T0 + 4_000).accepted).toBe(
      false,
    );
  });

  test("the cursor is clamped to the passage", () => {
    const race = runningRace();
    race.applyProgress("a", 9_999, 10, T0 + 1_000);
    expect(race.get("a")!.maxCursor).toBe(TEXT.length);
  });
});

describe("broadcast payload", () => {
  test("a tick carries a cursor and a wpm, and nothing about mistakes", () => {
    const race = runningRace();
    race.applyProgress("a", 5, 9, T0 + 1_000);

    const [update] = race.drainCursorUpdates(T0 + 1_000);
    expect(Object.keys(update!).sort()).toEqual(["cursor", "userId", "wpm"]);
  });

  test("ticks only carry participants that moved", () => {
    const race = runningRace();
    race.applyProgress("a", 5, 5, T0 + 1_000);

    expect(race.drainCursorUpdates(T0 + 1_000)).toHaveLength(1);
    expect(race.drainCursorUpdates(T0 + 1_100)).toHaveLength(0);
  });
});

describe("finishing", () => {
  test("placings are assigned in completion order", () => {
    const race = runningRace();
    race.applyProgress("a", TEXT.length, 25, T0 + 5_000);
    expect(race.allRacersFinished()).toBe(false);

    race.applyProgress("b", TEXT.length, 30, T0 + 8_000);
    expect(race.get("a")!.position).toBe(1);
    expect(race.get("b")!.position).toBe(2);
    expect(race.allRacersFinished()).toBe(true);
  });

  test("a disconnected racer does not hold up the race", () => {
    const race = runningRace();
    race.applyProgress("a", TEXT.length, 25, T0 + 5_000);
    race.setConnected("b", false);
    expect(race.allRacersFinished()).toBe(true);
  });

  test("standings put finishers first, then the furthest along", () => {
    const race = runningRace();
    race.applyProgress("b", TEXT.length, 30, T0 + 6_000);
    race.applyProgress("a", 4, 4, T0 + 6_000);

    const standings = race.standings(T0 + 6_000);
    expect(standings.map((s) => s.userId)).toEqual(["b", "a"]);
    expect(standings[0]!.finished).toBe(true);
    expect(standings[1]!.finished).toBe(false);
    // Spectators never appear in the standings.
    expect(standings).toHaveLength(2);
  });
});

describe("fair play", () => {
  test("a large single jump is flagged as a paste", () => {
    const race = runningRace("x".repeat(200));
    race.add({
      userId: "c",
      displayName: "C",
      image: null,
      spectator: false,
      connected: true,
    });
    race.applyProgress("c", 150, 150, T0 + 500);

    const flags = [...race.get("c")!.flags];
    expect(flags).toContain("paste_suspected");
    expect(flags).toContain("impossible_rate");
  });

  test("ordinary typing is not flagged", () => {
    const race = runningRace();
    for (let i = 1; i <= TEXT.length; i++) {
      race.applyProgress("a", i, i, T0 + i * 120);
    }
    expect([...race.get("a")!.flags]).toEqual([]);
  });
});
