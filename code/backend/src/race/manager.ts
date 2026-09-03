import { config } from "../lib/config";
import { ApiError } from "../lib/errors";
import type { SessionUser } from "../lib/session";
import * as lobbyRepo from "../lobby/repo";
import * as lobbyService from "../lobby/service";
import type { LobbyMemberRow } from "../lobby/types";
import {
  lobbyRoom,
  type RaceFinishSummary,
  type RaceSyncPayload,
} from "../realtime/events";
import type { RealtimeServer } from "../realtime/io";
import { Race, type RaceEndReason } from "./engine";
import { normalizePrompt, pickPrompt } from "./prompts";
import * as raceRepo from "./repo";

/**
 * Owns every in-flight race: timers, broadcasts and the transition back to
 * the lobby. There is exactly one instance (`raceManager`).
 *
 * Races live in memory only. The database records the outcome, not the
 * per-tick state — a restart aborts anything in flight (see `db/index.ts`).
 */

type Timers = {
  countdown?: ReturnType<typeof setTimeout>;
  tick?: ReturnType<typeof setInterval>;
  deadline?: ReturnType<typeof setTimeout>;
};

type ActiveRace = { race: Race; timers: Timers };

class RaceManager {
  private io: RealtimeServer | null = null;
  private readonly active = new Map<string, ActiveRace>();
  private readonly reopenTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  attach(io: RealtimeServer) {
    this.io = io;
  }

  private server(): RealtimeServer {
    if (!this.io) throw new Error("RaceManager used before attach()");
    return this.io;
  }

  getRace(lobbyId: string): Race | null {
    return this.active.get(lobbyId)?.race ?? null;
  }

  isRacing(lobbyId: string): boolean {
    const race = this.getRace(lobbyId);
    return race?.status === "countdown" || race?.status === "running";
  }

  /* ------------------------------------------------------------ starting */

  /**
   * Host-only. Validates the lobby, picks a passage, and opens the countdown.
   *
   * Only connected players are entered as racers; everybody else in the room
   * (spectators, and players who are offline right now) watches.
   */
  start(host: SessionUser, lobbyId: string): { raceId: string; startsAt: number } {
    const lobby = lobbyService.requireHost(lobbyId, host.id);

    if (lobby.status !== "in_lobby") {
      throw ApiError.conflict(
        "race_already_active",
        "This lobby is already in a race.",
      );
    }
    if (this.active.has(lobbyId)) {
      throw ApiError.conflict(
        "race_already_active",
        "This lobby is already in a race.",
      );
    }

    const racers = lobbyService.eligiblePlayers(lobbyId);
    if (racers.length < config.lobby.minPlayersToStart) {
      throw ApiError.conflict(
        "not_enough_players",
        `You need at least ${config.lobby.minPlayersToStart} connected players to start.`,
      );
    }

    const now = Date.now();
    const text = normalizePrompt(pickPrompt(lobby.prompt_length));
    const race = new Race(
      crypto.randomUUID(),
      lobbyId,
      text,
      lobby.rated === 1,
      now,
    );

    const racerIds = new Set(racers.map((member) => member.user_id));
    for (const member of lobbyRepo.listMembers(lobbyId)) {
      race.add({
        userId: member.user_id,
        displayName: member.display_name,
        image: member.image,
        spectator: !racerIds.has(member.user_id),
        connected: member.connected === 1,
      });
    }

    raceRepo.insertRace({
      id: race.id,
      lobbyId,
      promptText: text,
      rated: race.rated,
      endsAt: race.endsAt,
    });

    const entry: ActiveRace = { race, timers: {} };
    this.active.set(lobbyId, entry);
    this.cancelReopen(lobbyId);
    lobbyService.setStatus(lobbyId, "countdown", race.id);

    // Countdown payload differs per recipient only by the `spectating` flag,
    // so it is emitted per participant rather than to the room.
    const participants = race.participantList(now);
    for (const participant of race.participants.values()) {
      this.server()
        .to(`user:${participant.userId}`)
        .emit("race:countdown", {
          raceId: race.id,
          lobbyId,
          text,
          startsAt: race.startsAt,
          serverTime: now,
          participants,
          spectating: participant.spectator,
        });
    }

    entry.timers.countdown = setTimeout(
      () => this.begin(lobbyId),
      Math.max(0, race.startsAt - Date.now()),
    );

    return { raceId: race.id, startsAt: race.startsAt };
  }

  /** Fires the starting gun. */
  private begin(lobbyId: string) {
    const entry = this.active.get(lobbyId);
    if (!entry || entry.race.status !== "countdown") return;

    const { race, timers } = entry;
    const now = Date.now();

    race.status = "running";
    race.startedAt = now;
    race.endsAt = now + config.race.maxDurationMs;

    raceRepo.markRaceRunning(race.id, now, race.endsAt);
    lobbyService.setStatus(lobbyId, "playing", race.id);

    this.server().to(lobbyRoom(lobbyId)).emit("race:started", {
      raceId: race.id,
      startedAt: now,
      endsAt: race.endsAt,
      serverTime: now,
    });

    timers.tick = setInterval(
      () => this.tick(lobbyId),
      config.race.tickIntervalMs,
    );
    this.armDeadline(lobbyId, race.endsAt);
  }

  private armDeadline(lobbyId: string, at: number) {
    const entry = this.active.get(lobbyId);
    if (!entry) return;
    if (entry.timers.deadline) clearTimeout(entry.timers.deadline);
    entry.timers.deadline = setTimeout(
      () => this.end(lobbyId, "time_limit"),
      Math.max(0, at - Date.now()),
    );
  }

  /* --------------------------------------------------------- broadcasting */

  /**
   * Batched cursor broadcast.
   *
   * Progress events arrive per keystroke but are only flushed every
   * `tickIntervalMs`, which keeps the fan-out proportional to the number of
   * players rather than to the number of keys they press.
   */
  private tick(lobbyId: string) {
    const entry = this.active.get(lobbyId);
    if (!entry || entry.race.status !== "running") return;

    const now = Date.now();
    const cursors = entry.race.drainCursorUpdates(now);
    if (cursors.length === 0) return;

    this.server().to(lobbyRoom(lobbyId)).emit("race:tick", {
      raceId: entry.race.id,
      serverTime: now,
      cursors,
    });
  }

  /* -------------------------------------------------------------- progress */

  /** Handles a `race:progress` heartbeat. Silent on no-ops by design. */
  handleProgress(
    user: SessionUser,
    lobbyId: string,
    cursor: number,
    keystrokes: number,
  ): void {
    const race = this.getRace(lobbyId);
    if (!race) return;

    const result = race.applyProgress(user.id, cursor, keystrokes, Date.now());
    if (result.finished) this.announceFinish(lobbyId, user.id);
  }

  /** Handles an explicit `race:finish`. */
  handleFinish(
    user: SessionUser,
    lobbyId: string,
    cursor: number,
    keystrokes: number,
  ): RaceFinishSummary {
    const race = this.getRace(lobbyId);
    if (!race || race.status !== "running") {
      throw ApiError.conflict("no_active_race", "There is no race to finish.");
    }

    const participant = race.get(user.id);
    if (!participant || participant.spectator) {
      throw ApiError.forbidden("not_racing", "You are watching this race.");
    }

    const now = Date.now();
    if (participant.finishedAt === null) {
      race.applyProgress(user.id, cursor, keystrokes, now);
      if (participant.maxCursor < race.length) {
        throw ApiError.badRequest(
          "incomplete",
          "You have not reached the end of the passage.",
        );
      }
      this.announceFinish(lobbyId, user.id);
    }
    return race.summaryOf(participant, now);
  }

  private announceFinish(lobbyId: string, userId: string) {
    const entry = this.active.get(lobbyId);
    if (!entry) return;
    const { race } = entry;

    const participant = race.get(userId);
    if (!participant || participant.finishedAt === null) return;

    const now = Date.now();
    this.server()
      .to(lobbyRoom(lobbyId))
      .emit("race:player_finished", {
        raceId: race.id,
        ...race.summaryOf(participant, now),
      });

    if (race.allRacersFinished()) {
      this.end(lobbyId, "all_finished");
      return;
    }

    // Everyone still typing gets a bounded grace period after the first
    // finisher, so one slow racer cannot hold the lobby for five minutes.
    if (participant.position === 1) {
      this.armDeadline(
        lobbyId,
        Math.min(race.endsAt, now + config.race.graceAfterFirstFinishMs),
      );
    }
  }

  /* ------------------------------------------------------------- lifecycle */

  /** Host-only early termination. */
  abort(host: SessionUser, lobbyId: string): void {
    lobbyService.requireHost(lobbyId, host.id);
    if (!this.active.has(lobbyId)) {
      throw ApiError.conflict("no_active_race", "There is no race to abort.");
    }
    this.end(lobbyId, "aborted");
  }

  /** Ends a race, persists standings and schedules the lobby to reopen. */
  private end(lobbyId: string, reason: RaceEndReason) {
    const entry = this.active.get(lobbyId);
    if (!entry) return;

    const { race, timers } = entry;
    clearTimers(timers);
    this.active.delete(lobbyId);

    const now = Date.now();
    race.status = reason === "aborted" ? "aborted" : "finished";
    race.endedAt = now;
    race.endReason = reason;

    // Flush anything typed between the last tick and the final whistle.
    const trailing = race.drainCursorUpdates(now);
    if (trailing.length > 0) {
      this.server()
        .to(lobbyRoom(lobbyId))
        .emit("race:tick", { raceId: race.id, serverTime: now, cursors: trailing });
    }

    const results = race.standings(now);

    raceRepo.markRaceEnded(
      race.id,
      reason === "aborted" ? "aborted" : "finished",
      now,
    );
    if (reason !== "aborted") {
      raceRepo.insertResults(
        results.map((result) => ({
          raceId: race.id,
          userId: result.userId,
          displayName: result.displayName,
          position: result.position,
          correctChars: result.correctChars,
          keystrokes:
            race.get(result.userId)?.keystrokes ?? result.correctChars,
          wpm: result.wpm,
          accuracy: result.accuracy,
          durationMs: result.durationMs,
          finished: result.finished,
          flags: result.flags,
        })),
      );
    }

    const reopensAt = now + config.race.resultsDurationMs;
    lobbyService.setStatus(lobbyId, "finished", race.id);

    this.server().to(lobbyRoom(lobbyId)).emit("race:finished", {
      raceId: race.id,
      lobbyId,
      endedAt: now,
      reason,
      results,
      lobbyReopensAt: reopensAt,
    });

    this.scheduleReopen(lobbyId, config.race.resultsDurationMs);
  }

  private scheduleReopen(lobbyId: string, delayMs: number) {
    this.cancelReopen(lobbyId);
    const timer = setTimeout(() => {
      this.reopenTimers.delete(lobbyId);
      // Spectators who waited out the race become players here.
      lobbyService.reopenAfterRace(lobbyId);
    }, delayMs);
    this.reopenTimers.set(lobbyId, timer);
  }

  private cancelReopen(lobbyId: string) {
    const timer = this.reopenTimers.get(lobbyId);
    if (timer) {
      clearTimeout(timer);
      this.reopenTimers.delete(lobbyId);
    }
  }

  /** Drops a lobby's race without broadcasting (the lobby itself is gone). */
  discard(lobbyId: string) {
    const entry = this.active.get(lobbyId);
    if (entry) {
      clearTimers(entry.timers);
      raceRepo.markRaceEnded(entry.race.id, "aborted", Date.now());
      this.active.delete(lobbyId);
    }
    this.cancelReopen(lobbyId);
  }

  /* ----------------------------------------------------------- membership */

  /**
   * Someone walked in while a race was running. They are already a spectator
   * as far as the lobby is concerned; register them so they receive ticks and
   * appear in the participant list.
   */
  admitSpectator(lobbyId: string, member: LobbyMemberRow): void {
    const race = this.getRace(lobbyId);
    if (!race) return;
    race.add({
      userId: member.user_id,
      displayName: member.display_name,
      image: member.image,
      spectator: true,
      connected: true,
    });
  }

  setConnected(lobbyId: string, userId: string, connected: boolean): void {
    const race = this.getRace(lobbyId);
    if (!race) return;

    race.setConnected(userId, connected);
    if (connected) return;

    // A disconnect can be what ends the race.
    if (race.isAbandoned()) {
      this.end(lobbyId, "abandoned");
      return;
    }
    if (race.status === "running" && race.allRacersFinished()) {
      this.end(lobbyId, "all_finished");
    }
  }

  /** Full race state for a client that just joined, reconnected or woke up. */
  syncFor(userId: string, lobbyId: string): RaceSyncPayload | null {
    const race = this.getRace(lobbyId);
    if (!race || (race.status !== "countdown" && race.status !== "running")) {
      return null;
    }

    const now = Date.now();
    const participant = race.get(userId);
    const spectating = !participant || participant.spectator;

    return {
      raceId: race.id,
      lobbyId,
      status: race.status,
      text: race.text,
      startsAt: race.startsAt,
      startedAt: race.startedAt,
      endsAt: race.endsAt,
      serverTime: now,
      spectating,
      you:
        participant && !participant.spectator
          ? { cursor: participant.maxCursor, keystrokes: participant.keystrokes }
          : null,
      participants: race.participantList(now),
    };
  }
}

function clearTimers(timers: Timers) {
  if (timers.countdown) clearTimeout(timers.countdown);
  if (timers.tick) clearInterval(timers.tick);
  if (timers.deadline) clearTimeout(timers.deadline);
  timers.countdown = undefined;
  timers.tick = undefined;
  timers.deadline = undefined;
}

export const raceManager = new RaceManager();
