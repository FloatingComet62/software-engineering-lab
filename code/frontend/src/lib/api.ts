export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8787";

export type MemberRole = "host" | "player" | "spectator";

export type LobbyMember = {
  userId: string;
  displayName: string;
  image: string | null;
  role: MemberRole;
  isReady: boolean;
  connected: boolean;
  joinedAt: number;
};

export type LobbySnapshot = {
  id: string;
  code: string;
  name: string;
  hostId: string;
  status: "in_lobby" | "countdown" | "playing" | "finished";
  visibility: "public" | "private";
  maxPlayers: number;
  rated: boolean;
  promptLength: "short" | "medium" | "long";
  currentRaceId: string | null;
  playerCount: number;
  spectatorCount: number;
  createdAt: number;
  updatedAt: number;
  members: LobbyMember[];
};

export type ApiErrorBody = { code: string; message: string };

/** REST call against the backend; throws `{ code, message }` on failure. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BACKEND_URL}/api${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw (body.error ?? {
      code: "http_error",
      message: `Request failed (${res.status})`,
    }) as ApiErrorBody;
  }
  return body as T;
}
