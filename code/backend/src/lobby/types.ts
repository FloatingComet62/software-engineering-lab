/** Lifecycle of a lobby. This is the value the frontend switches screens on. */
export type LobbyStatus =
  /** Idle. Members can join as players, the host can start a race. */
  | "in_lobby"
  /** A race is about to begin; the synchronised countdown is running. */
  | "countdown"
  /** A race is in progress. Newcomers become spectators. */
  | "playing"
  /** The race ended; standings are on screen before the lobby reopens. */
  | "finished";

export type LobbyVisibility = "public" | "private";

/** `host` is exactly one member and is also a player. */
export type MemberRole = "host" | "player" | "spectator";

export type PromptLength = "short" | "medium" | "long";

export const LOBBY_STATUSES: readonly LobbyStatus[] = [
  "in_lobby",
  "countdown",
  "playing",
  "finished",
];

/** Statuses in which a race is active and newcomers must spectate. */
export const ACTIVE_RACE_STATUSES: readonly LobbyStatus[] = [
  "countdown",
  "playing",
];

/** Raw `lobby` row. */
export type LobbyRow = {
  id: string;
  code: string;
  name: string;
  host_id: string;
  status: LobbyStatus;
  visibility: LobbyVisibility;
  max_players: number;
  rated: number;
  prompt_length: PromptLength;
  current_race_id: string | null;
  created_at: number;
  updated_at: number;
};

/** Raw `lobby_member` row. */
export type LobbyMemberRow = {
  lobby_id: string;
  user_id: string;
  display_name: string;
  image: string | null;
  role: MemberRole;
  is_ready: number;
  connected: number;
  joined_at: number;
  last_seen_at: number;
};

/** Member as sent to clients. */
export type LobbyMemberDTO = {
  userId: string;
  displayName: string;
  image: string | null;
  role: MemberRole;
  isReady: boolean;
  connected: boolean;
  joinedAt: number;
};

/** Lobby as sent to clients. */
export type LobbyDTO = {
  id: string;
  code: string;
  name: string;
  hostId: string;
  status: LobbyStatus;
  visibility: LobbyVisibility;
  maxPlayers: number;
  rated: boolean;
  promptLength: PromptLength;
  currentRaceId: string | null;
  playerCount: number;
  spectatorCount: number;
  createdAt: number;
  updatedAt: number;
};

/** The authoritative snapshot pushed on every lobby change. */
export type LobbySnapshot = LobbyDTO & {
  members: LobbyMemberDTO[];
};

export function toLobbyDTO(
  row: LobbyRow,
  members: LobbyMemberRow[],
): LobbyDTO {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    hostId: row.host_id,
    status: row.status,
    visibility: row.visibility,
    maxPlayers: row.max_players,
    rated: row.rated === 1,
    promptLength: row.prompt_length,
    currentRaceId: row.current_race_id,
    playerCount: members.filter((m) => m.role !== "spectator").length,
    spectatorCount: members.filter((m) => m.role === "spectator").length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toMemberDTO(row: LobbyMemberRow): LobbyMemberDTO {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    image: row.image,
    role: row.role,
    isReady: row.is_ready === 1,
    connected: row.connected === 1,
    joinedAt: row.joined_at,
  };
}

export function toSnapshot(
  row: LobbyRow,
  members: LobbyMemberRow[],
): LobbySnapshot {
  return {
    ...toLobbyDTO(row, members),
    members: members.map(toMemberDTO),
  };
}
