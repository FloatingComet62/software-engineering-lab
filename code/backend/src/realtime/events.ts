import type { Ack } from "../lib/errors";
import type { LobbySnapshot } from "../lobby/types";
import type { SessionUser } from "../lib/session";

/**
 * The realtime contract.
 *
 * This file is the single source of truth for every Socket.IO event. The
 * frontend mirrors it verbatim (see MULTIPLAYER-INTEGRATION.md); if you change
 * an event here, change it there in the same commit.
 *
 * ---------------------------------------------------------------------------
 * DESIGN RULE: no mistake data crosses the wire during a race.
 * ---------------------------------------------------------------------------
 * `race:tick` carries a cursor position and a derived WPM, and nothing else.
 * It deliberately has no "isWrong", no error index, no error count. Rendering
 * an opponent's mistakes in red next to your own text makes players
 * misattribute the red to themselves, and it is a distraction with no
 * competitive value. Opponents are drawn as a position marker only.
 *
 * Aggregate accuracy exists (the server needs it for scoring), but it is only
 * ever sent in `race:player_finished` and `race:finished`, after the fact.
 */

/* --------------------------------------------------------------- payloads */

/** One opponent's position. This is the entire live race payload per player. */
export type CursorUpdate = {
  userId: string;
  /** Length of the correctly typed prefix, i.e. index of the caret. */
  cursor: number;
  /** Server-computed words per minute, rounded. */
  wpm: number;
};

export type RaceParticipantDTO = {
  userId: string;
  displayName: string;
  image: string | null;
  /** Spectators appear here too, with `spectator: true` and no cursor. */
  spectator: boolean;
  connected: boolean;
  cursor: number;
  wpm: number;
  finishedAt: number | null;
  position: number | null;
};

export type RaceCountdownPayload = {
  raceId: string;
  lobbyId: string;
  /** The passage. Revealed at countdown so clients can render before the gun. */
  text: string;
  /** Server epoch ms at which typing becomes legal. */
  startsAt: number;
  /** Server epoch ms when this payload was built; use it to fix clock skew. */
  serverTime: number;
  participants: RaceParticipantDTO[];
  /** True when this socket is watching rather than racing. */
  spectating: boolean;
};

export type RaceStartedPayload = {
  raceId: string;
  startedAt: number;
  /** Hard deadline; the race ends here even if nobody finished. */
  endsAt: number;
  serverTime: number;
};

/** Batched cursor broadcast, emitted at most every `tickIntervalMs`. */
export type RaceTickPayload = {
  raceId: string;
  serverTime: number;
  /** Only the participants whose cursor moved since the previous tick. */
  cursors: CursorUpdate[];
};

export type RaceFinishSummary = {
  userId: string;
  displayName: string;
  position: number | null;
  wpm: number;
  /** Aggregate only, and only after the player is done typing. */
  accuracy: number;
  correctChars: number;
  durationMs: number;
  finished: boolean;
  /** Fair-play annotations, empty when clean. */
  flags: string[];
};

export type RaceFinishedPayload = {
  raceId: string;
  lobbyId: string;
  endedAt: number;
  reason: "all_finished" | "time_limit" | "aborted" | "abandoned";
  results: RaceFinishSummary[];
  /** Epoch ms at which the lobby returns to `in_lobby`. */
  lobbyReopensAt: number;
};

/** Sent to anyone who joins or reconnects while a race is in flight. */
export type RaceSyncPayload = {
  raceId: string;
  lobbyId: string;
  status: "countdown" | "running";
  text: string;
  startsAt: number;
  startedAt: number | null;
  endsAt: number;
  serverTime: number;
  spectating: boolean;
  /** Your own persisted progress, present only when you are a racer. */
  you: { cursor: number; keystrokes: number } | null;
  participants: RaceParticipantDTO[];
};

/** Transient, toast-worthy things that a snapshot diff would not convey well. */
export type LobbyEventPayload =
  | { type: "member_joined"; userId: string; displayName: string; asSpectator: boolean }
  | { type: "member_left"; userId: string; displayName: string }
  | { type: "member_kicked"; userId: string; displayName: string }
  | { type: "host_changed"; userId: string; displayName: string }
  | { type: "promoted_to_player"; userId: string; displayName: string };

/* ------------------------------------------------------ server -> client  */

export type ServerToClientEvents = {
  /** Authoritative lobby state. Replace local state with this, never merge. */
  "lobby:state": (snapshot: LobbySnapshot) => void;
  "lobby:event": (payload: LobbyEventPayload) => void;
  /** The lobby no longer exists; navigate away. */
  "lobby:closed": (payload: { lobbyId: string; reason: string }) => void;
  /** You specifically were removed. */
  "lobby:removed": (payload: { lobbyId: string; reason: string }) => void;

  "race:countdown": (payload: RaceCountdownPayload) => void;
  "race:started": (payload: RaceStartedPayload) => void;
  "race:tick": (payload: RaceTickPayload) => void;
  "race:player_finished": (payload: RaceFinishSummary & { raceId: string }) => void;
  "race:finished": (payload: RaceFinishedPayload) => void;
  "race:sync": (payload: RaceSyncPayload) => void;

  /** Out-of-band failure for events that had no ack (`race:progress`). */
  "race:error": (payload: { code: string; message: string }) => void;
};

/* ------------------------------------------------------ client -> server  */

export type ClientToServerEvents = {
  /** Enter a lobby room. Also joins the lobby if you are not a member yet. */
  "lobby:join": (
    payload: { lobbyId: string },
    ack?: Ack<{ snapshot: LobbySnapshot; race: RaceSyncPayload | null }>,
  ) => void;
  "lobby:leave": (payload: { lobbyId: string }, ack?: Ack<{ left: true }>) => void;
  "lobby:ready": (
    payload: { lobbyId: string; ready: boolean },
    ack?: Ack<{ snapshot: LobbySnapshot }>,
  ) => void;
  "lobby:kick": (
    payload: { lobbyId: string; userId: string },
    ack?: Ack<{ snapshot: LobbySnapshot }>,
  ) => void;

  /** Host only. Begins the countdown. */
  "race:start": (
    payload: { lobbyId: string },
    ack?: Ack<{ raceId: string; startsAt: number }>,
  ) => void;
  /** Host only. Ends an in-flight race early. */
  "race:abort": (payload: { lobbyId: string }, ack?: Ack<{ aborted: true }>) => void;

  /**
   * Cursor heartbeat. Fire-and-forget, sent as a volatile event.
   *
   * `cursor`     - length of the correctly typed prefix.
   * `keystrokes` - total keys pressed, mistakes included. Used ONLY for
   *                server-side accuracy at the end; never rebroadcast live.
   * `clientTime` - client epoch ms, echoed back for latency attribution.
   */
  "race:progress": (payload: {
    lobbyId: string;
    cursor: number;
    keystrokes: number;
    clientTime: number;
  }) => void;

  /** Explicit completion. The server also detects this from `cursor`. */
  "race:finish": (
    payload: { lobbyId: string; cursor: number; keystrokes: number },
    ack?: Ack<RaceFinishSummary>,
  ) => void;

  /** Ask for a full race snapshot (after a reconnect or a tab wake-up). */
  "race:resync": (
    payload: { lobbyId: string },
    ack?: Ack<RaceSyncPayload | null>,
  ) => void;

  /** Round-trip probe for the latency metric. */
  "net:ping": (
    payload: { clientTime: number },
    ack?: Ack<{ clientTime: number; serverTime: number }>,
  ) => void;
};

export type InterServerEvents = Record<string, never>;

export type SocketData = {
  user: SessionUser;
  /** Lobby rooms this socket is currently in. */
  lobbyIds: Set<string>;
};

/** Room name for a lobby's broadcasts. */
export function lobbyRoom(lobbyId: string): string {
  return `lobby:${lobbyId}`;
}

/** Room name for every socket belonging to one user (multi-tab). */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}
