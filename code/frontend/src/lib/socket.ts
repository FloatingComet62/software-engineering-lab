import { io, type Socket } from "socket.io-client";
import { type ApiErrorBody, BACKEND_URL, type LobbySnapshot } from "./api";

// Lobby slice of backend/src/realtime/events.ts; race events come later.
type ServerToClientEvents = {
  "lobby:state": (snapshot: LobbySnapshot) => void;
  "lobby:closed": (payload: { lobbyId: string; reason: string }) => void;
  "lobby:removed": (payload: { lobbyId: string; reason: string }) => void;
};

type Ack<T> = { ok: true; data: T } | { ok: false; error: ApiErrorBody };

type ClientToServerEvents = {
  "lobby:join": (
    payload: { lobbyId: string },
    ack: (res: Ack<{ snapshot: LobbySnapshot; race: unknown }>) => void,
  ) => void;
  "lobby:leave": (
    payload: { lobbyId: string },
    ack: (res: Ack<{ left: true }>) => void,
  ) => void;
};

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

/** One socket per tab, shared by every lobby screen. */
export function getSocket() {
  socket ??= io(BACKEND_URL, {
    path: "/socket.io/",
    withCredentials: true,
    transports: ["websocket", "polling"],
    autoConnect: false,
  });
  return socket;
}

export function joinLobby(lobbyId: string) {
  return new Promise<LobbySnapshot>((resolve, reject) => {
    getSocket().emit("lobby:join", { lobbyId }, (res) =>
      res.ok ? resolve(res.data.snapshot) : reject(res.error),
    );
  });
}

export function leaveLobby(lobbyId: string) {
  return new Promise<void>((resolve, reject) => {
    getSocket().emit("lobby:leave", { lobbyId }, (res) =>
      res.ok ? resolve() : reject(res.error),
    );
  });
}
