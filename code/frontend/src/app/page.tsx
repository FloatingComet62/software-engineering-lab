"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { type ApiErrorBody, api, type LobbySnapshot } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

const TARGET_TEXT = "The quick brown fox jumps over the lazy dog.";

export default function Home() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const focus = () => inputRef.current?.focus();

  const enterLobby = async (request: Promise<{ lobby: LobbySnapshot }>) => {
    setBusy(true);
    setError(null);
    try {
      const { lobby } = await request;
      router.push(`/lobby/${lobby.id}`);
    } catch (err) {
      setError((err as ApiErrorBody).message);
      setBusy(false);
    }
  };

  const createLobby = () =>
    enterLobby(api("/lobbies", { method: "POST", body: "{}" }));

  const joinByCode = (e: FormEvent) => {
    e.preventDefault();
    enterLobby(
      api("/lobbies/join", { method: "POST", body: JSON.stringify({ code }) }),
    );
  };

  
  const { data: session, isPending, error: _ } = authClient.useSession()

  return (
    <>
      <header className="relative flex items-center justify-center bg-zinc-900 px-6 py-4 font-mono text-sm text-white">
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={createLobby}
              disabled={busy}
              className="rounded bg-white px-4 py-2 font-medium text-zinc-900 disabled:opacity-50"
            >
              Create lobby
            </button>
            <form onSubmit={joinByCode} className="flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="JOIN CODE"
                maxLength={6}
                className="w-28 rounded border border-zinc-600 bg-zinc-800 px-3 py-2 uppercase outline-none focus:border-zinc-400"
              />
              <button
                type="submit"
                disabled={busy || code.length === 0}
                className="rounded border border-zinc-600 px-3 py-2 disabled:opacity-50"
              >
                Join
              </button>
            </form>
          </div>
          {error && <p className="text-red-400">{error}</p>}
        </div>
        {
          (isPending || !session) ? (
            <div className="absolute right-6 flex gap-4">
              <Link
                href="/signup"
                className="rounded border border-zinc-600 px-4 py-2 hover:border-zinc-400"
              >
                Sign Up
              </Link>
              <Link
                href="/login"
                className="rounded border border-zinc-600 px-4 py-2 hover:border-zinc-400"
              >
                Login
              </Link>
            </div>
          ) : (
            <div className="absolute right-6 flex gap-4">
              <Link
                href="/profile"
                className="rounded border border-zinc-600 px-4 py-2 hover:border-zinc-400"
              >
                Profile
              </Link>
              <button
                className="rounded border border-zinc-600 px-4 py-2 hover:border-zinc-400"
                onClick={() => {
                  authClient.signOut().then(() => alert("Logged out"))
                }}
              >
                Logout
              </button>
            </div>
          )
        }
      </header>
      <div
        className="flex flex-col flex-1 items-center justify-center bg-zinc-900 font-mono text-7xl text-white outline-none"
        onClick={focus}
        tabIndex={-1}
      >
        <main className="flex flex-col w-8xl text-center">
          <div className="relative flex flex-wrap break-words whitespace-pre-wrap leading-tight">
            {TARGET_TEXT.split("").map((char, i) => {
              const typedChar = input[i];
              let colorClass = "text-zinc-600/40";
              let underlineClass = "";
              if (i < input.length) {
                if (typedChar === char) {
                  colorClass = "text-white";
                } else {
                  colorClass = "text-red-500";
                  underlineClass = "underline decoration-red-500";
                }
              }
              const isCaret = i === input.length;
              return (
                <span key={i} className="relative">
                  <span className={`${colorClass} ${underlineClass}`}>
                    {char === " " ? "\u00A0" : char}
                  </span>
                  {isCaret && (
                    <span className="absolute top-0 left-0 h-full w-0.5 -translate-x-1/2 animate-pulse bg-zinc-300" />
                  )}
                </span>
              );
            })}
            <input
              ref={inputRef}
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="absolute top-0 left-0 h-0 w-0 opacity-0"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </div>
        </main>
      </div>
    </>
  );
}
