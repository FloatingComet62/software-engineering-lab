import { io, type Socket } from "socket.io-client";
import { BACKEND_URL, type LobbySnapshot } from "./api";

import type { ClientToServerEvents, ServerToClientEvents } from "./race-events";

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
    getSocket()
      .timeout(8000)
      .emit("lobby:join", { lobbyId }, (err, res) =>
        err
          ? reject(new Error("The room did not respond. Please reconnect."))
          : res.ok
            ? resolve(res.data.snapshot)
            : reject(res.error),
      );
  });
}

export function leaveLobby(lobbyId: string) {
  return new Promise<void>((resolve, reject) => {
    getSocket()
      .timeout(5000)
      .emit("lobby:leave", { lobbyId }, (err, res) =>
        err
          ? reject(new Error("The room did not respond."))
          : res.ok
            ? resolve()
            : reject(res.error),
      );
  });
}
