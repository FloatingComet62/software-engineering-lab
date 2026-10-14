"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, type LobbySnapshot } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import type {
  RaceCountdownPayload,
  RaceFinishedPayload,
  RaceFinishSummary,
  RaceStartedPayload,
  RaceSyncPayload,
  RaceTickPayload,
} from "@/lib/race-events";
import { getSocket, joinLobby, leaveLobby } from "@/lib/socket";

type LiveRace = RaceSyncPayload;
const message = (err: unknown) =>
  err instanceof Error
    ? err.message
    : ((err as { message?: string })?.message ??
      "Something went wrong. Please try again.");

export default function LobbyPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [lobby, setLobby] = useState<LobbySnapshot | null>(null);
  const [race, setRace] = useState<LiveRace | null>(null);
  const [results, setResults] = useState<RaceFinishedPayload | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(0);
  const offset = useRef(0);
  const strokes = useRef(0);
  const progress = useRef({ cursor: 0, keystrokes: 0 });
  const raceRef = useRef<LiveRace | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  raceRef.current = race;

  useEffect(() => {
    const socket = getSocket();
    let mounted = true;
    const restore = (snapshot: RaceSyncPayload | null) => {
      if (!mounted || (snapshot && snapshot.lobbyId !== id)) return;
      setRace(snapshot);
      if (snapshot) {
        offset.current = snapshot.serverTime - Date.now();
        setNow(snapshot.serverTime);
        const cursor = snapshot.you?.cursor ?? 0;
        strokes.current = snapshot.you?.keystrokes ?? 0;
        progress.current = { cursor, keystrokes: strokes.current };
        setValue(snapshot.text.slice(0, cursor));
        setResults(null);
      }
    };
    const sync = () =>
      socket
        .timeout(8000)
        .emit("race:resync", { lobbyId: id }, (err, response) => {
          if (!mounted) return;
          if (err)
            setError("Could not restore the race. Reconnect to try again.");
          else if (response.ok) restore(response.data);
          else setError(response.error.message);
        });
    const join = () => {
      setOnline(true);
      setError("");
      void joinLobby(id)
        .then((snapshot) => {
          if (mounted) {
            setLobby(snapshot);
            sync();
          }
        })
        .catch((err) => {
          if (mounted) setError(message(err));
        });
    };
    const state = (snapshot: LobbySnapshot) => {
      if (snapshot.id !== id) return;
      setLobby(snapshot);
      if (snapshot.status === "in_lobby") {
        setRace(null);
        setValue("");
      }
    };
    const countdown = (payload: RaceCountdownPayload) => {
      if (payload.lobbyId !== id) return;
      strokes.current = 0;
      progress.current = { cursor: 0, keystrokes: 0 };
      restore({
        ...payload,
        status: "countdown",
        startedAt: null,
        endsAt: payload.startsAt + 300000,
        you: payload.spectating ? null : { cursor: 0, keystrokes: 0 },
      });
    };
    const started = (payload: RaceStartedPayload) => {
      offset.current = payload.serverTime - Date.now();
      setRace((current) =>
        current?.raceId === payload.raceId
          ? {
              ...current,
              status: "running",
              startedAt: payload.startedAt,
              endsAt: payload.endsAt,
            }
          : current,
      );
    };
    const tick = (payload: RaceTickPayload) => {
      setRace((current) =>
        current?.raceId === payload.raceId
          ? {
              ...current,
              participants: current.participants.map((player) => ({
                ...player,
                ...payload.cursors.find(
                  (cursor) => cursor.userId === player.userId,
                ),
              })),
            }
          : current,
      );
    };
    const playerFinished = (
      payload: RaceFinishSummary & { raceId: string },
    ) => {
      setRace((current) =>
        current?.raceId === payload.raceId
          ? {
              ...current,
              participants: current.participants.map((player) =>
                player.userId === payload.userId
                  ? {
                      ...player,
                      cursor: current.text.length,
                      wpm: payload.wpm,
                      position: payload.position,
                      finishedAt: Date.now(),
                    }
                  : player,
              ),
              endsAt: Math.min(
                current.endsAt,
                Date.now() + offset.current + 45000,
              ),
            }
          : current,
      );
    };
    const finished = (payload: RaceFinishedPayload) => {
      if (payload.lobbyId === id) {
        setResults(payload);
        setRace(null);
      }
    };
    const disconnected = () => {
      setOnline(false);
      setBusy(false);
    };
    const connectionError = (err: Error) => {
      setOnline(false);
      setError(
        err.message === "unauthorized"
          ? "Sign in to join this room."
          : "Game server unavailable. Reconnecting…",
      );
    };
    const gone = (payload: { lobbyId: string }) => {
      if (payload.lobbyId === id) router.push("/multiplayer");
    };
    const raceError = (payload: { message: string }) =>
      setError(payload.message);
    const visible = () => {
      if (document.visibilityState === "visible" && socket.connected) sync();
    };
    socket.on("connect", join);
    socket.on("disconnect", disconnected);
    socket.on("connect_error", connectionError);
    socket.on("lobby:state", state);
    socket.on("lobby:closed", gone);
    socket.on("lobby:removed", gone);
    socket.on("race:countdown", countdown);
    socket.on("race:started", started);
    socket.on("race:tick", tick);
    socket.on("race:player_finished", playerFinished);
    socket.on("race:finished", finished);
    socket.on("race:sync", restore);
    socket.on("race:error", raceError);
    document.addEventListener("visibilitychange", visible);
    if (socket.connected) join();
    else socket.connect();
    const clock = window.setInterval(
      () => setNow(Date.now() + offset.current),
      100,
    );
    const heartbeat = window.setInterval(() => {
      const current = raceRef.current;
      if (
        socket.connected &&
        current?.status === "running" &&
        !current.spectating
      )
        socket.volatile.emit("race:progress", {
          lobbyId: id,
          ...progress.current,
          clientTime: Date.now(),
        });
    }, 100);
    return () => {
      mounted = false;
      clearInterval(clock);
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", visible);
      socket.off("connect", join);
      socket.off("disconnect", disconnected);
      socket.off("connect_error", connectionError);
      socket.off("lobby:state", state);
      socket.off("lobby:closed", gone);
      socket.off("lobby:removed", gone);
      socket.off("race:countdown", countdown);
      socket.off("race:started", started);
      socket.off("race:tick", tick);
      socket.off("race:player_finished", playerFinished);
      socket.off("race:finished", finished);
      socket.off("race:sync", restore);
      socket.off("race:error", raceError);
      socket.disconnect();
    };
  }, [id, router]);

  const me = lobby?.members.find(
    (member) => member.userId === session?.user.id,
  );
  const host = me?.role === "host";
  const players =
    lobby?.members.filter((member) => member.role !== "spectator") ?? [];
  const connectedPlayers = players.filter((member) => member.connected);
  const ownRace = race?.participants.find(
    (player) => player.userId === session?.user.id,
  );
  const canType =
    online &&
    race?.status === "running" &&
    !race.spectating &&
    !ownRace?.finishedAt &&
    value !== race.text &&
    now < race.endsAt;
  const countdownNumber = race
    ? Math.max(0, Math.ceil((race.startsAt - now) / 1000))
    : 0;
  const canStart =
    online &&
    !busy &&
    lobby?.status === "in_lobby" &&
    connectedPlayers.length >= 2 &&
    connectedPlayers.every(
      (member) => member.role === "host" || member.isReady,
    );

  useEffect(() => {
    if (canType) input.current?.focus();
  }, [canType]);

  function command(action: "start" | "ready") {
    setBusy(true);
    setError("");
    const socket = getSocket();
    const done = (
      err: Error | null,
      response: { ok: boolean; error?: { message: string } },
    ) => {
      setBusy(false);
      if (err) setError("The server did not respond. Please try again.");
      else if (!response.ok)
        setError(response.error?.message ?? "Action failed.");
    };
    if (action === "start")
      socket.timeout(8000).emit("race:start", { lobbyId: id }, done);
    else
      socket
        .timeout(8000)
        .emit("lobby:ready", { lobbyId: id, ready: !me?.isReady }, done);
  }
  function type(next: string) {
    if (!canType || !race) return;
    if (next.length > value.length + 1) return;
    if (next.length > value.length)
      strokes.current += next.length - value.length;
    next = next.slice(0, race.text.length);
    setValue(next);
    let cursor = 0;
    while (cursor < next.length && next[cursor] === race.text[cursor]) cursor++;
    progress.current = { cursor, keystrokes: strokes.current };
    if (cursor === race.text.length)
      getSocket()
        .timeout(8000)
        .emit(
          "race:finish",
          { lobbyId: id, ...progress.current },
          (err, response) => {
            if (err)
              setError(
                "Confirming your finish. Reconnect if results do not appear.",
              );
            else if (!response.ok) setError(response.error.message);
          },
        );
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(lobby?.code ?? "");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Clipboard unavailable. Select and copy the room code instead.");
    }
  }
  async function settings(promptLength: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/lobbies/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ promptLength }),
      });
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="typing-app">
      <header className="site-header">
        <Link href="/" className="brand">
          i see i type<span className="brand-dot">.</span>
        </Link>
        <span className={`mp-connection ${online ? "connected" : ""}`}>
          {online ? "● connected" : "○ reconnecting"}
        </span>
        <button
          type="button"
          className="mp-link"
          onClick={async () => {
            await leaveLobby(id).catch(() => {});
            router.push("/multiplayer");
          }}
        >
          Leave room ↗
        </button>
      </header>
      <main className="mp-room">
        {error && (
          <div className="mp-error" role="alert">
            {error} <Link href="/login">Sign in</Link>
          </div>
        )}
        {!lobby ? (
          <p className="intro">Connecting to your room…</p>
        ) : (
          <>
            <div className="mp-room-heading">
              <div>
                <div className="eyebrow">
                  PRIVATE ROOM / {lobby.rated ? "RATED" : "FRIENDLY RACE"}
                </div>
                <h1>{lobby.name}</h1>
              </div>
              <button type="button" className="mp-code" onClick={copy}>
                <small>{copied ? "COPIED" : "INVITE CODE"}</small>
                {lobby.code}
              </button>
            </div>
            <div className="mp-room-grid">
              <div className="mp-game">
                {!race && !results && (
                  <section className="mp-panel mp-waiting">
                    <span className="mp-overline">THE STARTING LINE</span>
                    <h2>Good company. Great competition.</h2>
                    <p>
                      Share the room code, wait for your friends, then ready up.
                    </p>
                    <label className="mp-setting">
                      passage{" "}
                      <select
                        value={lobby.promptLength}
                        disabled={!host || busy || lobby.status !== "in_lobby"}
                        onChange={(event) => void settings(event.target.value)}
                      >
                        <option value="short">short</option>
                        <option value="medium">medium</option>
                        <option value="long">long</option>
                      </select>
                    </label>
                    <div className="mp-actions">
                      {host ? (
                        <button
                          className="mp-primary"
                          type="button"
                          disabled={!canStart}
                          onClick={() => command("start")}
                        >
                          Start race →
                        </button>
                      ) : me?.role !== "spectator" ? (
                        <button
                          className="mp-primary"
                          type="button"
                          disabled={
                            !online || busy || lobby.status !== "in_lobby"
                          }
                          onClick={() => command("ready")}
                        >
                          {me?.isReady ? "Unready" : "I’m ready →"}
                        </button>
                      ) : (
                        <span className="intro">
                          You’ll join when a player seat opens.
                        </span>
                      )}
                    </div>
                    <p className="keyboard-hint">
                      {connectedPlayers.length < 2
                        ? "At least two connected players are needed."
                        : "Every player must be ready before the host can start."}
                    </p>
                  </section>
                )}
                {race && (
                  <section className="typing-card mp-race">
                    <div className="card-top">
                      <span className="session-label">
                        {race.spectating
                          ? "SPECTATING"
                          : ownRace?.finishedAt || value === race.text
                            ? "FINISHED · WAITING FOR OTHERS"
                            : race.status === "countdown"
                              ? "GET READY"
                              : "RACE IN PROGRESS"}
                      </span>
                      <span className="timer">
                        {race.status === "countdown"
                          ? countdownNumber
                          : Math.max(0, Math.ceil((race.endsAt - now) / 1000))}
                        <small>{race.status === "countdown" ? "" : "s"}</small>
                      </span>
                    </div>
                    <div className="typing-area">
                      <div className="passage" aria-hidden="true">
                        {race.text.split(" ").map((word, wi, words) => {
                          const start =
                            words.slice(0, wi).join(" ").length + (wi ? 1 : 0);
                          return (
                            <span
                              className="word"
                              key={`${race.raceId}-${start}`}
                            >
                              {[
                                ...(word + (wi < words.length - 1 ? " " : "")),
                              ].map((char, i) => (
                                <span
                                  key={`${start + i}`}
                                  className={`${start + i < value.length ? (char === value[start + i] ? "correct" : "incorrect") : ""} ${start + i === value.length && canType ? "caret" : ""}`}
                                >
                                  {char}
                                </span>
                              ))}
                            </span>
                          );
                        })}
                      </div>
                      <textarea
                        ref={input}
                        aria-label={`Race passage: ${race.text}`}
                        value={value}
                        disabled={!canType}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        onPaste={(event) => event.preventDefault()}
                        onDrop={(event) => event.preventDefault()}
                        onChange={(event) => type(event.target.value)}
                      />
                    </div>
                    <div className="card-bottom">
                      {race.spectating
                        ? "Watch this round. You’ll join the next available race."
                        : !online
                          ? "Typing paused until you reconnect."
                          : "Correct mistakes to advance. Find your rhythm."}
                    </div>
                  </section>
                )}
                {results && (
                  <section className="mp-panel">
                    <span className="mp-overline">
                      {results.reason === "aborted" ||
                      results.reason === "abandoned"
                        ? "RACE ENDED"
                        : "THE FINISH LINE"}
                    </span>
                    <h2>
                      {results.results.some((result) => result.position === 1)
                        ? `${results.results.find((result) => result.position === 1)?.displayName} takes the win.`
                        : "Every round is progress."}
                    </h2>
                    <div className="mp-results-scroll">
                      <table className="mp-results">
                        <thead>
                          <tr>
                            <th>Place</th>
                            <th>Player</th>
                            <th>WPM</th>
                            <th>Accuracy</th>
                          </tr>
                        </thead>
                        <tbody>
                          {results.results.map((result) => (
                            <tr key={result.userId}>
                              <td>
                                {result.position
                                  ? `#${result.position}`
                                  : "DNF"}
                              </td>
                              <td>
                                {result.displayName}
                                {result.userId === session?.user.id
                                  ? " (you)"
                                  : ""}
                                {result.flags.length > 0 && (
                                  <small className="mp-muted"> · flagged</small>
                                )}
                              </td>
                              <td>{Math.round(result.wpm)}</td>
                              <td>{Math.round(result.accuracy * 100)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {lobby.status === "in_lobby" ? (
                      <button
                        type="button"
                        className="mp-primary"
                        onClick={() => setResults(null)}
                      >
                        Back to starting line →
                      </button>
                    ) : (
                      <p className="keyboard-hint">
                        Next round in{" "}
                        {Math.max(
                          0,
                          Math.ceil((results.lobbyReopensAt - now) / 1000),
                        )}
                        s
                      </p>
                    )}
                  </section>
                )}
              </div>
              <aside className="mp-panel mp-players">
                <span className="mp-overline">
                  PLAYERS / {players.length} OF {lobby.maxPlayers}
                </span>
                {players.map((player) => {
                  const live = race?.participants.find(
                    (participant) => participant.userId === player.userId,
                  );
                  const percent =
                    race && live
                      ? Math.min(100, (live.cursor / race.text.length) * 100)
                      : 0;
                  return (
                    <div className="mp-player" key={player.userId}>
                      <div className="mp-player-line">
                        <span className="mp-avatar">
                          {player.displayName.slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <strong>
                            {player.displayName}
                            {player.userId === session?.user.id ? " (you)" : ""}
                          </strong>
                          <small>
                            {!player.connected
                              ? "offline"
                              : live?.position
                                ? `finished #${live.position}`
                                : player.role === "host"
                                  ? "host"
                                  : player.isReady
                                    ? "ready"
                                    : "waiting"}
                          </small>
                        </div>
                        {live && (
                          <span className="mp-speed">
                            {live.wpm}
                            <small>wpm</small>
                          </span>
                        )}
                      </div>
                      {race && (
                        <div className="mp-track">
                          <span style={{ width: `${percent}%` }} />
                        </div>
                      )}
                    </div>
                  );
                })}
                {lobby.spectatorCount > 0 && (
                  <p className="keyboard-hint">
                    {lobby.spectatorCount} watching · join next round
                  </p>
                )}
                <p className="keyboard-hint">
                  A shared countdown.
                  <br />
                  One passage. Your best pace.
                </p>
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
