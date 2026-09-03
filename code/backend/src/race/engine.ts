import { config } from "../lib/config";
import type {
  CursorUpdate,
  RaceFinishSummary,
  RaceParticipantDTO,
} from "../realtime/events";

/**
 * The in-memory state of a single race.
 *
 * This class is deliberately transport-free and timer-free: it owns the
 * scoring rules and nothing else, so it can be reasoned about (and tested)
 * without Socket.IO. `RaceManager` drives it with timers and broadcasts.
 *
 * Everything that ends up in a result is computed from the server's own clock.
 * The client only ever tells us two numbers — where its caret is and how many
 * keys it has pressed — and both are clamped before use.
 */

export type RaceRuntimeStatus = "countdown" | "running" | "finished" | "aborted";

export type Participant = {
  userId: string;
  displayName: string;
  image: string | null;
  /** Spectators are tracked so the UI can list them; they never score. */
  spectator: boolean;
  connected: boolean;

  /** Last reported caret index. Can move backwards (backspace). */
  cursor: number;
  /** High-water mark of `cursor`; this is what scoring uses. */
  maxCursor: number;
  /** Total keys pressed as reported by the client, mistakes included. */
  keystrokes: number;

  finishedAt: number | null;
  position: number | null;

  lastProgressAt: number;
  flags: Set<string>;
};

/** Standard convention: five characters count as one word. */
const CHARS_PER_WORD = 5;

export function computeWpm(correctChars: number, elapsedMs: number): number {
  if (elapsedMs <= 0 || correctChars <= 0) return 0;
  const minutes = elapsedMs / 60_000;
  return correctChars / CHARS_PER_WORD / minutes;
}

export function computeAccuracy(
  correctChars: number,
  keystrokes: number,
): number {
  const denominator = Math.max(keystrokes, correctChars);
  if (denominator <= 0) return 0;
  return Math.min(1, correctChars / denominator);
}

export class Race {
  readonly participants = new Map<string, Participant>();

  status: RaceRuntimeStatus = "countdown";
  /** Epoch ms when typing becomes legal (end of the countdown). */
  startsAt: number;
  /** Epoch ms when the race actually began; null until the gun. */
  startedAt: number | null = null;
  /** Hard deadline, tightened once the first player finishes. */
  endsAt: number;
  endedAt: number | null = null;
  endReason: RaceEndReason = "all_finished";

  /** Participants whose cursor changed since the last broadcast. */
  private readonly dirty = new Set<string>();
  private finishedCount = 0;

  constructor(
    readonly id: string,
    readonly lobbyId: string,
    readonly text: string,
    readonly rated: boolean,
    now: number,
  ) {
    this.startsAt = now + config.race.countdownMs;
    this.endsAt = this.startsAt + config.race.maxDurationMs;
  }

  get length(): number {
    return this.text.length;
  }

  /* ------------------------------------------------------- participants */

  add(input: {
    userId: string;
    displayName: string;
    image: string | null;
    spectator: boolean;
    connected: boolean;
  }): Participant {
    const existing = this.participants.get(input.userId);
    if (existing) {
      existing.displayName = input.displayName;
      existing.image = input.image;
      existing.connected = input.connected;
      return existing;
    }

    const participant: Participant = {
      userId: input.userId,
      displayName: input.displayName,
      image: input.image,
      spectator: input.spectator,
      connected: input.connected,
      cursor: 0,
      maxCursor: 0,
      keystrokes: 0,
      finishedAt: null,
      position: null,
      lastProgressAt: 0,
      flags: new Set(),
    };
    this.participants.set(input.userId, participant);
    return participant;
  }

  get(userId: string): Participant | undefined {
    return this.participants.get(userId);
  }

  setConnected(userId: string, connected: boolean): void {
    const participant = this.participants.get(userId);
    if (participant) participant.connected = connected;
  }

  racers(): Participant[] {
    return [...this.participants.values()].filter((p) => !p.spectator);
  }

  /* ------------------------------------------------------------ progress */

  /**
   * Applies a client progress report.
   *
   * Returns whether this report completed the passage, so the caller can emit
   * `race:player_finished`. Reports outside a running race are ignored rather
   * than rejected — a keystroke in flight during the countdown is normal.
   */
  applyProgress(
    userId: string,
    rawCursor: number,
    rawKeystrokes: number,
    now: number,
  ): { accepted: boolean; finished: boolean } {
    const participant = this.participants.get(userId);
    if (!participant || participant.spectator) {
      return { accepted: false, finished: false };
    }
    if (this.status !== "running" || participant.finishedAt !== null) {
      return { accepted: false, finished: false };
    }

    const cursor = clampInt(rawCursor, 0, this.length);
    const keystrokes = clampInt(rawKeystrokes, 0, this.length * 8);

    // Fair play: a single leap this large is a paste, not typing.
    const jump = cursor - participant.maxCursor;
    if (jump >= config.race.pasteJumpChars) {
      participant.flags.add("paste_suspected");
    }

    // Fair play: instantaneous rate above what a human hand can produce. The
    // first report has no previous sample, so it is measured from the gun.
    const since =
      participant.lastProgressAt > 0
        ? participant.lastProgressAt
        : (this.startedAt ?? now);
    if (jump > 0 && now > since) {
      const dtSeconds = (now - since) / 1000;
      if (jump / dtSeconds > config.race.maxCharsPerSecond * 3) {
        participant.flags.add("impossible_rate");
      }
    }

    participant.cursor = cursor;
    participant.maxCursor = Math.max(participant.maxCursor, cursor);
    // Monotonic: a client that under-reports cannot lower its own key count.
    participant.keystrokes = Math.max(participant.keystrokes, keystrokes);
    participant.lastProgressAt = now;
    this.dirty.add(userId);

    if (participant.maxCursor >= this.length) {
      this.finish(userId, now);
      return { accepted: true, finished: true };
    }
    return { accepted: true, finished: false };
  }

  /** Marks a racer done and assigns their placing. Idempotent. */
  finish(userId: string, now: number): Participant | null {
    const participant = this.participants.get(userId);
    if (!participant || participant.spectator) return null;
    if (participant.finishedAt !== null) return participant;

    participant.finishedAt = now;
    participant.position = ++this.finishedCount;
    participant.cursor = participant.maxCursor;
    this.dirty.add(userId);

    // Overall rate check across the whole run, not just one event.
    const elapsed = now - (this.startedAt ?? now);
    if (elapsed > 0) {
      const cps = participant.maxCursor / (elapsed / 1000);
      if (cps > config.race.maxCharsPerSecond) {
        participant.flags.add("impossible_rate");
      }
    }
    return participant;
  }

  /** True once every connected racer has completed the passage. */
  allRacersFinished(): boolean {
    const racers = this.racers();
    if (racers.length === 0) return true;
    return racers.every((p) => p.finishedAt !== null || !p.connected);
  }

  /** True when nobody is left to race. */
  isAbandoned(): boolean {
    return this.racers().every((p) => !p.connected && p.finishedAt === null);
  }

  /* --------------------------------------------------------- projections */

  /** Elapsed race time, clamped so a pre-start read cannot go negative. */
  elapsedAt(now: number): number {
    if (this.startedAt === null) return 0;
    return Math.max(0, now - this.startedAt);
  }

  wpmOf(participant: Participant, now: number): number {
    const until = participant.finishedAt ?? now;
    return computeWpm(participant.maxCursor, this.elapsedAt(until));
  }

  /**
   * Cursor updates for participants that moved since the last call.
   *
   * This is the only payload sent while people are typing, and it carries no
   * mistake information by design — see `realtime/events.ts`.
   */
  drainCursorUpdates(now: number): CursorUpdate[] {
    if (this.dirty.size === 0) return [];
    const updates: CursorUpdate[] = [];
    for (const userId of this.dirty) {
      const participant = this.participants.get(userId);
      if (!participant) continue;
      updates.push({
        userId,
        cursor: participant.maxCursor,
        wpm: Math.round(this.wpmOf(participant, now)),
      });
    }
    this.dirty.clear();
    return updates;
  }

  /** Full cursor state, for a client that just joined or reconnected. */
  cursorSnapshot(now: number): CursorUpdate[] {
    return this.racers().map((participant) => ({
      userId: participant.userId,
      cursor: participant.maxCursor,
      wpm: Math.round(this.wpmOf(participant, now)),
    }));
  }

  participantList(now: number): RaceParticipantDTO[] {
    return [...this.participants.values()].map((participant) => ({
      userId: participant.userId,
      displayName: participant.displayName,
      image: participant.image,
      spectator: participant.spectator,
      connected: participant.connected,
      cursor: participant.spectator ? 0 : participant.maxCursor,
      wpm: participant.spectator ? 0 : Math.round(this.wpmOf(participant, now)),
      finishedAt: participant.finishedAt,
      position: participant.position,
    }));
  }

  summaryOf(participant: Participant, now: number): RaceFinishSummary {
    const until = participant.finishedAt ?? now;
    const durationMs = this.elapsedAt(until);
    return {
      userId: participant.userId,
      displayName: participant.displayName,
      position: participant.position,
      wpm: round2(computeWpm(participant.maxCursor, durationMs)),
      accuracy: round4(
        computeAccuracy(participant.maxCursor, participant.keystrokes),
      ),
      correctChars: participant.maxCursor,
      durationMs,
      finished: participant.finishedAt !== null,
      flags: [...participant.flags],
    };
  }

  /** Final standings: finishers by placing, then everyone else by distance. */
  standings(now: number): RaceFinishSummary[] {
    return this.racers()
      .map((participant) => this.summaryOf(participant, now))
      .sort((a, b) => {
        if (a.finished !== b.finished) return a.finished ? -1 : 1;
        if (a.finished && b.finished) {
          return (a.position ?? 0) - (b.position ?? 0);
        }
        return b.correctChars - a.correctChars;
      });
  }
}

export type RaceEndReason =
  | "all_finished"
  | "time_limit"
  | "aborted"
  | "abandoned";

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
