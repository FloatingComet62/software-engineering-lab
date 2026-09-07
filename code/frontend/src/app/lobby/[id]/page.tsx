"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ApiErrorBody, LobbySnapshot } from "@/lib/api";
import { getSocket, joinLobby, leaveLobby } from "@/lib/socket";

export default function LobbyPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [lobby, setLobby] = useState<LobbySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const socket = getSocket();

    const join = () =>
      joinLobby(id)
        .then(setLobby)
        .catch((err: ApiErrorBody) => setError(err.message));
    const onState = (snapshot: LobbySnapshot) => {
      if (snapshot.id === id) setLobby(snapshot);
    };
    const onGone = ({ lobbyId }: { lobbyId: string }) => {
      if (lobbyId === id) router.push("/");
    };
    const onConnectError = (err: Error) =>
      setError(
        err.message === "unauthorized"
          ? "You must be signed in to join a lobby."
          : err.message,
      );

    // Re-join on every (re)connect so a dropped socket gets its seat back.
    socket.on("connect", join);
    socket.on("connect_error", onConnectError);
    socket.on("lobby:state", onState);
    socket.on("lobby:closed", onGone);
    socket.on("lobby:removed", onGone);
    if (socket.connected) join();
    else socket.connect();

    return () => {
      socket.off("connect", join);
      socket.off("connect_error", onConnectError);
      socket.off("lobby:state", onState);
      socket.off("lobby:closed", onGone);
      socket.off("lobby:removed", onGone);
    };
  }, [id, router]);

  const leave = async () => {
    await leaveLobby(id).catch(() => {});
    router.push("/");
  };

  const copyCode = async () => {
    if (!lobby) return;
    await navigator.clipboard.writeText(lobby.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const players = lobby?.members.filter((m) => m.role !== "spectator") ?? [];
  const spectators = lobby?.members.filter((m) => m.role === "spectator") ?? [];

  return (
    <div className="flex min-h-screen flex-1 bg-zinc-900 font-mono text-white">
      <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
        {error && (
          <div className="flex flex-col items-center gap-2 rounded bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
            <Link href="/" className="text-zinc-300 underline">
              Back home
            </Link>
          </div>
        )}

        {lobby && (
          <>
            <h1 className="text-3xl">{lobby.name}</h1>
            <div className="flex flex-col items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-zinc-500">
                Join code
              </span>
              <button
                type="button"
                onClick={copyCode}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-6 py-3 text-4xl tracking-[0.3em] hover:border-zinc-500"
                title="Copy join code"
              >
                {lobby.code}
              </button>
              <span className="h-4 text-xs text-zinc-500">
                {copied ? "Copied!" : "Click to copy"}
              </span>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                disabled
                title="Racing is coming soon"
                className="cursor-not-allowed rounded bg-white px-6 py-3 font-medium text-zinc-900 opacity-40"
              >
                Start race
              </button>
              <button
                type="button"
                onClick={leave}
                className="rounded border border-zinc-600 px-6 py-3 hover:border-zinc-400"
              >
                Leave
              </button>
            </div>
          </>
        )}

        {!lobby && !error && <p className="text-zinc-500">Joining lobby…</p>}
      </main>

      <aside className="flex w-72 flex-col gap-4 border-l border-zinc-800 bg-zinc-950 p-6">
        <h2 className="text-sm uppercase tracking-wide text-zinc-400">
          Players {lobby && `(${players.length}/${lobby.maxPlayers})`}
        </h2>
        <ul className="flex flex-col gap-2">
          {players.map((member) => (
            <li
              key={member.userId}
              className="flex items-center gap-2 rounded bg-zinc-900 px-3 py-2"
            >
              <span
                className={`h-2 w-2 rounded-full ${member.connected ? "bg-emerald-400" : "bg-zinc-600"}`}
                title={member.connected ? "Online" : "Offline"}
              />
              <span className="flex-1 truncate">{member.displayName}</span>
              {member.role === "host" && (
                <span className="text-xs text-amber-400">host</span>
              )}
            </li>
          ))}
        </ul>
        {spectators.length > 0 && (
          <>
            <h2 className="text-sm uppercase tracking-wide text-zinc-400">
              Spectators
            </h2>
            <ul className="flex flex-col gap-2 text-zinc-400">
              {spectators.map((member) => (
                <li key={member.userId} className="truncate px-3">
                  {member.displayName}
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </div>
  );
}
