/**
 * A tiny typed event bus.
 *
 * The REST layer mutates lobbies without knowing anything about Socket.IO;
 * it publishes here and the realtime layer turns that into a broadcast. This
 * keeps `lobby/service.ts` free of transport concerns and avoids an import
 * cycle between HTTP and websocket code.
 */
import type { LobbyEventPayload } from "../realtime/events";

export type BusEvents = {
  /** A lobby's persistent state changed; re-broadcast its snapshot. */
  "lobby:changed": { lobbyId: string };
  /** A lobby no longer exists; disconnect everyone in it. */
  "lobby:closed": { lobbyId: string; reason: string };
  /** A specific member must be removed from the realtime room. */
  "lobby:member_removed": { lobbyId: string; userId: string; reason: string };
  /** A transient, toast-worthy thing happened in a lobby. */
  "lobby:notice": { lobbyId: string; event: LobbyEventPayload };
};

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void;

const handlers = new Map<keyof BusEvents, Set<Handler<never>>>();

export const bus = {
  on<K extends keyof BusEvents>(event: K, handler: Handler<K>): () => void {
    const set = handlers.get(event) ?? new Set();
    set.add(handler as Handler<never>);
    handlers.set(event, set);
    return () => set.delete(handler as Handler<never>);
  },

  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
    const set = handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        (handler as Handler<K>)(payload);
      } catch (err) {
        console.error(`[bus] handler for "${event}" threw`, err);
      }
    }
  },
};
