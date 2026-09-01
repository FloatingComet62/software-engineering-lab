import { Server as Engine } from "@socket.io/bun-engine";
import { Server, type Socket } from "socket.io";
import { bus } from "../lib/bus";
import { config } from "../lib/config";
import { ApiError, replyWith } from "../lib/errors";
import { getSessionUser } from "../lib/session";
import * as lobbyRepo from "../lobby/repo";
import * as lobbyService from "../lobby/service";
import { raceManager } from "../race/manager";
import {
  type ClientToServerEvents,
  type InterServerEvents,
  lobbyRoom,
  type ServerToClientEvents,
  type SocketData,
  userRoom,
} from "./events";

export type RealtimeServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

type RealtimeSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/* ---------------------------------------------------------------- presence */

/**
 * Who is in which lobby, by socket.
 *
 * A user can have several tabs open; they only count as "gone" once the last
 * of their sockets for that lobby has dropped.
 */
class Presence {
  private readonly byLobby = new Map<string, Map<string, Set<string>>>();

  /** @returns true when this is the user's first socket in the lobby. */
  add(lobbyId: string, userId: string, socketId: string): boolean {
    const users = this.byLobby.get(lobbyId) ?? new Map<string, Set<string>>();
    this.byLobby.set(lobbyId, users);
    const sockets = users.get(userId) ?? new Set<string>();
    users.set(userId, sockets);
    const wasEmpty = sockets.size === 0;
    sockets.add(socketId);
    return wasEmpty;
  }

  /** @returns true when the user has no sockets left in the lobby. */
  remove(lobbyId: string, userId: string, socketId: string): boolean {
    const users = this.byLobby.get(lobbyId);
    const sockets = users?.get(userId);
    if (!users || !sockets) return false;
    sockets.delete(socketId);
    if (sockets.size > 0) return false;
    users.delete(userId);
    if (users.size === 0) this.byLobby.delete(lobbyId);
    return true;
  }

  has(lobbyId: string, userId: string): boolean {
    return (this.byLobby.get(lobbyId)?.get(userId)?.size ?? 0) > 0;
  }
}

const presence = new Presence();

/** Pending "you have really left" timers, keyed by `lobbyId:userId`. */
const graceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function graceKey(lobbyId: string, userId: string) {
  return `${lobbyId}:${userId}`;
}

function cancelGrace(lobbyId: string, userId: string) {
  const key = graceKey(lobbyId, userId);
  const timer = graceTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    graceTimers.delete(key);
  }
}

/* ------------------------------------------------------------------ server */

export function createRealtime() {
  const engine = new Engine({
    path: config.socket.path,
    cors: {
      origin: config.frontendUrls,
      credentials: true,
    },
  });

  const io: RealtimeServer = new Server();

  // The Bun engine implements engine.io's server contract but is not typed
  // against socket.io's `BaseServer`, so the bind needs a cast.
  io.bind(engine as unknown as Parameters<typeof io.bind>[0]);

  raceManager.attach(io);
  registerBusBridge(io);

  /* ---------------------------------------------------------- handshake */

  io.use(async (socket, next) => {
    const headers = new Headers();
    const cookie = socket.handshake.headers.cookie;
    if (cookie) headers.set("cookie", cookie);

    // Native/non-browser clients may pass the session as a bearer token.
    const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
    if (token) headers.set("authorization", `Bearer ${token}`);

    const user = await getSessionUser(headers);
    if (!user) {
      next(new Error("unauthorized"));
      return;
    }

    socket.data.user = user;
    socket.data.lobbyIds = new Set<string>();
    next();
  });

  io.on("connection", (socket) => registerHandlers(io, socket));

  return { io, engine };
}

/* ---------------------------------------------------------------- handlers */

function registerHandlers(io: RealtimeServer, socket: RealtimeSocket) {
  const user = socket.data.user;
  if (!socket.data.lobbyIds) socket.data.lobbyIds = new Set<string>();
  socket.join(userRoom(user.id));

  /* ------------------------------------------------------------- lobby */

  socket.on("lobby:join", (payload, ack) =>
    replyWith(ack, () => {
      const lobbyId = requireString(payload?.lobbyId, "lobbyId");

      const before = lobbyRepo.findMember(lobbyId, user.id);
      // Joining the room and joining the lobby are the same action for the
      // client: this is idempotent for an existing member.
      const snapshot = lobbyService.joinLobby(user, lobbyId);

      socket.join(lobbyRoom(lobbyId));
      socket.data.lobbyIds.add(lobbyId);
      cancelGrace(lobbyId, user.id);

      const isFirstSocket = presence.add(lobbyId, user.id, socket.id);
      if (isFirstSocket) {
        lobbyService.setConnected(lobbyId, user.id, true);
        raceManager.setConnected(lobbyId, user.id, true);
      }

      const member = lobbyRepo.findMember(lobbyId, user.id);
      if (member && member.role === "spectator") {
        // Walked in mid-race: register so they receive ticks.
        raceManager.admitSpectator(lobbyId, member);
      }

      if (!before) {
        socket.to(lobbyRoom(lobbyId)).emit("lobby:event", {
          type: "member_joined",
          userId: user.id,
          displayName: user.name,
          asSpectator: member?.role === "spectator",
        });
      }

      const race = raceManager.syncFor(user.id, lobbyId);
      return { snapshot, race };
    }),
  );

  socket.on("lobby:leave", (payload, ack) =>
    replyWith(ack, () => {
      const lobbyId = requireString(payload?.lobbyId, "lobbyId");
      leaveRoom(socket, lobbyId);
      lobbyService.leaveLobby(user.id, lobbyId);
      raceManager.setConnected(lobbyId, user.id, false);
      io.to(lobbyRoom(lobbyId)).emit("lobby:event", {
        type: "member_left",
        userId: user.id,
        displayName: user.name,
      });
      return { left: true as const };
    }),
  );

  socket.on("lobby:ready", (payload, ack) =>
    replyWith(ack, () => {
      const lobbyId = requireString(payload?.lobbyId, "lobbyId");
      const snapshot = lobbyService.setReady(
        user.id,
        lobbyId,
        payload?.ready === true,
      );
      return { snapshot };
    }),
  );

  socket.on("lobby:kick", (payload, ack) =>
    replyWith(ack, () => {
      const lobbyId = requireString(payload?.lobbyId, "lobbyId");
      const targetId = requireString(payload?.userId, "userId");
      const target = lobbyRepo.findMember(lobbyId, targetId);
      lobbyService.kickMember(user, lobbyId, targetId);
      io.to(lobbyRoom(lobbyId)).emit("lobby:event", {
        type: "member_kicked",
        userId: targetId,
        displayName: target?.display_name ?? "A player",
      });
      return { snapshot: lobbyService.getSnapshot(lobbyId) };
    }),
  );

  /* -------------------------------------------------------------- race */

  socket.on("race:start", (payload, ack) =>
    replyWith(ack, () => {
      const lobbyId = requireString(payload?.lobbyId, "lobbyId");
      return raceManager.start(user, lobbyId);
    }),
  );

  socket.on("race:abort", (payload, ack) =>
    replyWith(ack, () => {
      const lobbyId = requireString(payload?.lobbyId, "lobbyId");
      raceManager.abort(user, lobbyId);
      return { aborted: true as const };
    }),
  );

  /**
   * The hot path. No ack, no validation round-trip, no persistence: the
   * payload is clamped in the engine and flushed by the tick loop.
   */
  socket.on("race:progress", (payload) => {
    if (!payload || typeof payload.lobbyId !== "string") return;
    if (!socket.data.lobbyIds.has(payload.lobbyId)) return;
    raceManager.handleProgress(
      user,
      payload.lobbyId,
      Number(payload.cursor),
      Number(payload.keystrokes),
    );
  });

  socket.on("race:finish", (payload, ack) =>
    replyWith(ack, () => {
      const lobbyId = requireString(payload?.lobbyId, "lobbyId");
      return raceManager.handleFinish(
        user,
        lobbyId,
        Number(payload?.cursor),
        Number(payload?.keystrokes),
      );
    }),
  );

  socket.on("race:resync", (payload, ack) =>
    replyWith(ack, () => {
      const lobbyId = requireString(payload?.lobbyId, "lobbyId");
      return raceManager.syncFor(user.id, lobbyId);
    }),
  );

  socket.on("net:ping", (payload, ack) =>
    replyWith(ack, () => ({
      clientTime: Number(payload?.clientTime) || 0,
      serverTime: Date.now(),
    })),
  );

  /* -------------------------------------------------------- disconnect */

  socket.on("disconnect", () => {
    for (const lobbyId of socket.data.lobbyIds) {
      const gone = presence.remove(lobbyId, user.id, socket.id);
      if (!gone) continue;

      lobbyService.setConnected(lobbyId, user.id, false);
      raceManager.setConnected(lobbyId, user.id, false);

      // Give refreshes and flaky connections a window to come back before
      // the seat is released.
      const key = graceKey(lobbyId, user.id);
      const timer = setTimeout(() => {
        graceTimers.delete(key);
        if (presence.has(lobbyId, user.id)) return;
        if (raceManager.isRacing(lobbyId)) return;
        lobbyService.leaveLobby(user.id, lobbyId);
        io.to(lobbyRoom(lobbyId)).emit("lobby:event", {
          type: "member_left",
          userId: user.id,
          displayName: user.name,
        });
      }, config.lobby.disconnectGraceMs);
      graceTimers.set(key, timer);
    }
    socket.data.lobbyIds.clear();
  });
}

function leaveRoom(socket: RealtimeSocket, lobbyId: string) {
  socket.leave(lobbyRoom(lobbyId));
  socket.data.lobbyIds.delete(lobbyId);
  presence.remove(lobbyId, socket.data.user.id, socket.id);
  cancelGrace(lobbyId, socket.data.user.id);
}

/* -------------------------------------------------------------- bus bridge */

/**
 * Turns service-layer mutations into broadcasts.
 *
 * REST routes and socket handlers both go through `lobby/service.ts`, so this
 * is the only place a lobby snapshot is pushed.
 */
function registerBusBridge(io: RealtimeServer) {
  bus.on("lobby:changed", ({ lobbyId }) => {
    const snapshot = lobbyService.getSnapshotOrNull(lobbyId);
    if (!snapshot) return;
    io.to(lobbyRoom(lobbyId)).emit("lobby:state", snapshot);
  });

  bus.on("lobby:notice", ({ lobbyId, event }) => {
    io.to(lobbyRoom(lobbyId)).emit("lobby:event", event);
  });

  bus.on("lobby:closed", ({ lobbyId, reason }) => {
    raceManager.discard(lobbyId);
    io.to(lobbyRoom(lobbyId)).emit("lobby:closed", { lobbyId, reason });
    io.in(lobbyRoom(lobbyId)).socketsLeave(lobbyRoom(lobbyId));
  });

  bus.on("lobby:member_removed", ({ lobbyId, userId, reason }) => {
    io.to(userRoom(userId)).emit("lobby:removed", { lobbyId, reason });
    io.in(userRoom(userId)).socketsLeave(lobbyRoom(lobbyId));
  });
}

/* ------------------------------------------------------------------ helpers */

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw ApiError.badRequest("invalid_payload", `"${field}" is required.`);
  }
  return value;
}
