import { bus } from "../lib/bus";
import { config } from "../lib/config";
import { ApiError } from "../lib/errors";
import type { SessionUser } from "../lib/session";
import * as repo from "./repo";
import {
  ACTIVE_RACE_STATUSES,
  type LobbySnapshot,
  type LobbyStatus,
  type LobbyVisibility,
  type MemberRole,
  type PromptLength,
  toSnapshot,
} from "./types";

/**
 * Lobby business rules.
 *
 * Every mutation here ends with `publish(lobbyId)` so that whoever changed the
 * lobby — an HTTP route or a socket handler — results in the same authoritative
 * snapshot being pushed to the room. Callers never broadcast by hand.
 */

/* --------------------------------------------------------------- snapshots */

export function getSnapshot(lobbyId: string): LobbySnapshot {
  const lobby = repo.findById(lobbyId);
  if (!lobby) throw ApiError.notFound("lobby_not_found", "That lobby is gone.");
  return toSnapshot(lobby, repo.listMembers(lobbyId));
}

export function getSnapshotOrNull(lobbyId: string): LobbySnapshot | null {
  const lobby = repo.findById(lobbyId);
  if (!lobby) return null;
  return toSnapshot(lobby, repo.listMembers(lobbyId));
}

/** Announces that a lobby's persisted state changed. */
function publish(lobbyId: string) {
  bus.emit("lobby:changed", { lobbyId });
}

/* ------------------------------------------------------------- validation */

const NAME_MAX = 48;
const PROMPT_LENGTHS: readonly PromptLength[] = ["short", "medium", "long"];

function validateName(raw: unknown, fallback: string): string {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== "string") {
    throw ApiError.badRequest("invalid_name", "Lobby name must be text.");
  }
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length === 0) return fallback;
  if (name.length > NAME_MAX) {
    throw ApiError.badRequest(
      "invalid_name",
      `Lobby name must be ${NAME_MAX} characters or fewer.`,
    );
  }
  return name;
}

function validateVisibility(raw: unknown): LobbyVisibility {
  if (raw === undefined || raw === null) return "public";
  if (raw !== "public" && raw !== "private") {
    throw ApiError.badRequest(
      "invalid_visibility",
      'Visibility must be "public" or "private".',
    );
  }
  return raw;
}

function validateMaxPlayers(raw: unknown): number {
  if (raw === undefined || raw === null) return config.lobby.defaultMaxPlayers;
  const value = Number(raw);
  if (
    !Number.isInteger(value) ||
    value < 2 ||
    value > config.lobby.hardMaxPlayers
  ) {
    throw ApiError.badRequest(
      "invalid_max_players",
      `Max players must be a whole number between 2 and ${config.lobby.hardMaxPlayers}.`,
    );
  }
  return value;
}

function validatePromptLength(raw: unknown): PromptLength {
  if (raw === undefined || raw === null) return "medium";
  if (!PROMPT_LENGTHS.includes(raw as PromptLength)) {
    throw ApiError.badRequest(
      "invalid_prompt_length",
      'Prompt length must be "short", "medium" or "long".',
    );
  }
  return raw as PromptLength;
}

function validateRated(raw: unknown): boolean {
  if (raw === undefined || raw === null) return true;
  if (typeof raw !== "boolean") {
    throw ApiError.badRequest("invalid_rated", "Rated must be true or false.");
  }
  return raw;
}

/* ------------------------------------------------------------------ create */

export type CreateLobbyInput = {
  name?: unknown;
  visibility?: unknown;
  maxPlayers?: unknown;
  rated?: unknown;
  promptLength?: unknown;
};

export function createLobby(
  user: SessionUser,
  input: CreateLobbyInput,
): LobbySnapshot {
  const lobby = repo.insertLobby({
    id: crypto.randomUUID(),
    code: repo.generateUniqueCode(),
    name: validateName(input.name, `${user.name}'s lobby`),
    hostId: user.id,
    visibility: validateVisibility(input.visibility),
    maxPlayers: validateMaxPlayers(input.maxPlayers),
    rated: validateRated(input.rated),
    promptLength: validatePromptLength(input.promptLength),
  });

  repo.upsertMember({
    lobbyId: lobby.id,
    userId: user.id,
    displayName: user.name,
    image: user.image,
    role: "host",
  });

  return getSnapshot(lobby.id);
}

/* -------------------------------------------------------------------- read */

export function getByCode(code: string): LobbySnapshot {
  const normalized = repo.normalizeCode(code);
  const lobby = repo.findByCode(normalized);
  if (!lobby) {
    throw ApiError.notFound("lobby_not_found", "No lobby has that join code.");
  }
  return toSnapshot(lobby, repo.listMembers(lobby.id));
}

export type ListLobbiesQuery = {
  status?: string;
  visibility?: string;
  limit?: string;
  offset?: string;
};

export function listLobbies(query: ListLobbiesQuery) {
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 50);
  const offset = Math.max(Number(query.offset) || 0, 0);

  const status =
    query.status && query.status !== "any"
      ? (query.status as LobbyStatus)
      : undefined;

  // Private lobbies are reachable by code only; they never appear in browse.
  const { rows, total } = repo.listLobbies({
    status,
    visibility: "public",
    limit,
    offset,
  });

  return {
    lobbies: rows.map((row) => toSnapshot(row, repo.listMembers(row.id))),
    total,
    limit,
    offset,
  };
}

/* ------------------------------------------------------------------ update */

export function requireHost(lobbyId: string, userId: string) {
  const lobby = repo.findById(lobbyId);
  if (!lobby) throw ApiError.notFound("lobby_not_found", "That lobby is gone.");
  if (lobby.host_id !== userId) {
    throw ApiError.forbidden("not_host", "Only the host can do that.");
  }
  return lobby;
}

export type UpdateLobbyInput = CreateLobbyInput;

export function updateLobby(
  user: SessionUser,
  lobbyId: string,
  input: UpdateLobbyInput,
): LobbySnapshot {
  const lobby = requireHost(lobbyId, user.id);
  if (lobby.status !== "in_lobby") {
    throw ApiError.conflict(
      "lobby_busy",
      "Settings can only be changed between races.",
    );
  }

  const maxPlayers =
    input.maxPlayers === undefined
      ? undefined
      : validateMaxPlayers(input.maxPlayers);

  if (maxPlayers !== undefined) {
    const players = repo.countPlayers(lobbyId);
    if (maxPlayers < players) {
      throw ApiError.conflict(
        "max_players_too_low",
        `There are already ${players} players in this lobby.`,
      );
    }
  }

  repo.updateLobby(lobbyId, {
    name: input.name === undefined ? undefined : validateName(input.name, lobby.name),
    visibility:
      input.visibility === undefined
        ? undefined
        : validateVisibility(input.visibility),
    maxPlayers,
    rated: input.rated === undefined ? undefined : validateRated(input.rated),
    promptLength:
      input.promptLength === undefined
        ? undefined
        : validatePromptLength(input.promptLength),
  });

  const snapshot = getSnapshot(lobbyId);
  publish(lobbyId);
  return snapshot;
}

/* ------------------------------------------------------------------ delete */

export function deleteLobby(user: SessionUser, lobbyId: string): void {
  requireHost(lobbyId, user.id);
  repo.deleteLobby(lobbyId);
  bus.emit("lobby:closed", { lobbyId, reason: "closed_by_host" });
}

/* -------------------------------------------------------------- join/leave */

/**
 * Joins by code.
 *
 * Role assignment is the whole point of this function:
 *   - a race is running  -> spectator
 *   - the lobby is full  -> spectator
 *   - otherwise          -> player
 * Rejoining is idempotent, and a spectator who is still around when the lobby
 * reopens is promoted by `reopenAfterRace`.
 */
export function joinByCode(user: SessionUser, code: string): LobbySnapshot {
  const normalized = repo.normalizeCode(code);
  const lobby = repo.findByCode(normalized);
  if (!lobby) {
    throw ApiError.notFound("lobby_not_found", "No lobby has that join code.");
  }
  return joinLobby(user, lobby.id);
}

export function joinLobby(user: SessionUser, lobbyId: string): LobbySnapshot {
  const lobby = repo.findById(lobbyId);
  if (!lobby) throw ApiError.notFound("lobby_not_found", "That lobby is gone.");

  const existing = repo.findMember(lobbyId, user.id);
  if (existing) {
    // Keep the display name fresh, but never change an established role here.
    repo.upsertMember({
      lobbyId,
      userId: user.id,
      displayName: user.name,
      image: user.image,
      role: existing.role,
    });
    repo.touch(lobbyId);
    const snapshot = getSnapshot(lobbyId);
    publish(lobbyId);
    return snapshot;
  }

  const raceActive = ACTIVE_RACE_STATUSES.includes(lobby.status);
  const full = repo.countPlayers(lobbyId) >= lobby.max_players;
  const role: MemberRole = raceActive || full ? "spectator" : "player";

  repo.upsertMember({
    lobbyId,
    userId: user.id,
    displayName: user.name,
    image: user.image,
    role,
  });
  repo.touch(lobbyId);

  const snapshot = getSnapshot(lobbyId);
  publish(lobbyId);
  return snapshot;
}

/**
 * Removes a member. If the host leaves, the oldest remaining member inherits
 * the lobby; if nobody is left, the lobby is deleted.
 */
export function leaveLobby(userId: string, lobbyId: string): void {
  const lobby = repo.findById(lobbyId);
  if (!lobby) return;
  if (!repo.findMember(lobbyId, userId)) return;

  repo.removeMember(lobbyId, userId);
  bus.emit("lobby:member_removed", { lobbyId, userId, reason: "left" });

  const remaining = repo.listMembers(lobbyId);
  if (remaining.length === 0) {
    repo.deleteLobby(lobbyId);
    bus.emit("lobby:closed", { lobbyId, reason: "empty" });
    return;
  }

  if (lobby.host_id === userId) {
    const successor = repo.pickSuccessorHost(lobbyId);
    if (successor) {
      repo.setHost(lobbyId, successor.user_id);
      repo.setMemberRole(lobbyId, successor.user_id, "host");
      bus.emit("lobby:notice", {
        lobbyId,
        event: {
          type: "host_changed",
          userId: successor.user_id,
          displayName: successor.display_name,
        },
      });
    }
  }

  repo.touch(lobbyId);
  publish(lobbyId);
}

export function kickMember(
  host: SessionUser,
  lobbyId: string,
  targetUserId: string,
): void {
  requireHost(lobbyId, host.id);
  if (targetUserId === host.id) {
    throw ApiError.badRequest(
      "cannot_kick_host",
      "Leave the lobby instead of kicking yourself.",
    );
  }
  if (!repo.findMember(lobbyId, targetUserId)) {
    throw ApiError.notFound("member_not_found", "That player is not here.");
  }

  repo.removeMember(lobbyId, targetUserId);
  bus.emit("lobby:member_removed", {
    lobbyId,
    userId: targetUserId,
    reason: "kicked",
  });
  repo.touch(lobbyId);
  publish(lobbyId);
}

/* ------------------------------------------------------------------- ready */

export function setReady(
  userId: string,
  lobbyId: string,
  ready: boolean,
): LobbySnapshot {
  const lobby = repo.findById(lobbyId);
  if (!lobby) throw ApiError.notFound("lobby_not_found", "That lobby is gone.");

  const member = repo.findMember(lobbyId, userId);
  if (!member) {
    throw ApiError.forbidden("not_a_member", "You are not in this lobby.");
  }
  if (member.role === "spectator") {
    throw ApiError.conflict(
      "spectators_cannot_ready",
      "Spectators join the next race automatically.",
    );
  }

  repo.setMemberReady(lobbyId, userId, ready);
  const snapshot = getSnapshot(lobbyId);
  publish(lobbyId);
  return snapshot;
}

/* -------------------------------------------------------------- connection */

export function setConnected(
  lobbyId: string,
  userId: string,
  connected: boolean,
): void {
  if (!repo.findMember(lobbyId, userId)) return;
  repo.setMemberConnected(lobbyId, userId, connected);
  publish(lobbyId);
}

/* ------------------------------------------------------- race transitions */

/** Members eligible to race: players (host included) who are connected. */
export function eligiblePlayers(lobbyId: string) {
  return repo
    .listMembers(lobbyId)
    .filter((member) => member.role !== "spectator" && member.connected === 1);
}

export function setStatus(
  lobbyId: string,
  status: LobbyStatus,
  currentRaceId: string | null = null,
): void {
  repo.setStatus(lobbyId, status, currentRaceId);
  publish(lobbyId);
}

/**
 * Returns the lobby to `in_lobby` after a race, promoting the spectators who
 * were locked out while it was running.
 */
export function reopenAfterRace(lobbyId: string): LobbySnapshot | null {
  const lobby = repo.findById(lobbyId);
  if (!lobby) return null;

  repo.clearReadyFlags(lobbyId);
  const slots = lobby.max_players - repo.countPlayers(lobbyId);
  const promoted = repo.promoteSpectators(lobbyId, slots);
  repo.setStatus(lobbyId, "in_lobby", null);

  const snapshot = getSnapshot(lobbyId);
  publish(lobbyId);

  for (const userId of promoted) {
    const member = repo.findMember(lobbyId, userId);
    if (!member) continue;
    bus.emit("lobby:notice", {
      lobbyId,
      event: {
        type: "promoted_to_player",
        userId,
        displayName: member.display_name,
      },
    });
  }
  return snapshot;
}

/* ----------------------------------------------------------------- sweeper */

/** Deletes lobbies nobody has touched in `idleTtlMs`. */
export function sweepStaleLobbies(): number {
  const cutoff = Date.now() - config.lobby.idleTtlMs;
  const stale = repo.findStaleLobbyIds(cutoff);
  for (const lobbyId of stale) {
    repo.deleteLobby(lobbyId);
    bus.emit("lobby:closed", { lobbyId, reason: "expired" });
  }
  return stale.length;
}
