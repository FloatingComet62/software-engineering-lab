"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, type LobbySnapshot } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

export default function Multiplayer() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [code, setCode] = useState("");
  const [ranked, setRanked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function enter(join: boolean) {
    setBusy(true);
    setError("");
    try {
      const { lobby } = await api<{ lobby: LobbySnapshot }>(
        join ? "/lobbies/join" : "/lobbies",
        {
          method: "POST",
          body: JSON.stringify(
            join
              ? { code }
              : {
                  name: `${session?.user.name ?? "Your"}'s room`,
                  visibility: "private",
                  rated: ranked,
                  maxPlayers: 8,
                  promptLength: "short",
                },
          ),
        },
      );
      router.push(`/lobby/${lobby.id}`);
    } catch (err) {
      setError(
        err instanceof Error
          ? "Could not connect to the game server. Please try again."
          : (err as { message: string }).message,
      );
      setBusy(false);
    }
  }
  return (
    <div className="typing-app">
      <header className="site-header">
        <Link href="/" className="brand">
          i see i type<span className="brand-dot">.</span>
        </Link>
        <Link href="/" className="mp-muted">
          ← solo practice
        </Link>
      </header>
      <main className="mp-entry">
        <div className="eyebrow">BETTER TOGETHER</div>
        <h1>
          A little friendly <span>competition.</span>
        </h1>
        <p className="intro">Same words. Same countdown. Your own rhythm.</p>
        <div className="mp-entry-grid">
          <section className="mp-panel">
            <span className="mp-overline">01 / HOST</span>
            <h2>Bring your people.</h2>
            <p>
              Create a private room for up to eight players. Share the code and
              race together.
            </p>
            <label className="mp-ranked-toggle">
              <input
                type="checkbox"
                checked={ranked}
                onChange={(event) => setRanked(event.target.checked)}
                disabled={busy}
              />{" "}
              Ranked race <span>affects Typing Rating</span>
            </label>
            <button
              type="button"
              className="mp-primary"
              disabled={busy || !session}
              onClick={() => enter(false)}
            >
              {busy ? "Connecting…" : "Create a room →"}
            </button>
          </section>
          <section className="mp-panel">
            <span className="mp-overline">02 / JOIN</span>
            <h2>Find your room.</h2>
            <p>
              Have an invite? Enter the six-character room code to join your
              friends.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void enter(true);
              }}
            >
              <label className="sr-only" htmlFor="room-code">
                Room code
              </label>
              <div className="mp-join">
                <input
                  id="room-code"
                  value={code}
                  onChange={(event) =>
                    setCode(
                      event.target.value
                        .toUpperCase()
                        .replace(/[^A-Z2-9]/g, ""),
                    )
                  }
                  maxLength={6}
                  placeholder="ABC234"
                  required
                  autoComplete="off"
                />
                <button
                  type="submit"
                  className="mp-primary"
                  disabled={busy || !session || code.length !== 6}
                >
                  Join →
                </button>
              </div>
            </form>
          </section>
        </div>
        {error && (
          <p className="mp-error" role="alert">
            {error}
          </p>
        )}
        {!session && !isPending && (
          <p className="mp-auth">
            <Link href="/login">Sign in</Link> or{" "}
            <Link href="/signup">create an account</Link> to race. Your account
            keeps your place if you reconnect.
          </p>
        )}
        <p className="keyboard-hint">
          ready up · race the same passage · climb the standings · do it again
        </p>
      </main>
    </div>
  );
}
