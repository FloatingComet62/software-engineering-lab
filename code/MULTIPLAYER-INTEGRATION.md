# Multiplayer integration guide

How the frontend talks to the backend for lobbies and live races.

The backend is authoritative for **everything that scores**. The client reports
two numbers — where its caret is and how many keys have been pressed — and the
server derives WPM, accuracy, placings and fair-play flags from its own clock.
Do not compute a final WPM in the browser and send it; it will be ignored.

- Backend: `code/backend`, Hono + Socket.IO on Bun, default `http://localhost:8787`
- Socket path: `/socket.io/`
- Auth: better-auth session cookie, shared by REST and the socket handshake
- Event contract in code: [`backend/src/realtime/events.ts`](backend/src/realtime/events.ts) — mirror it, don't re-invent it

---

## 0. The one design rule that shapes the UI

**No mistake information is ever broadcast during a race.**

`race:tick` carries `{ userId, cursor, wpm }` and nothing else. There is no
`isWrong`, no error index, no error count, by design.

Rendering an opponent's errors in red next to your own passage makes players
misread the red as their own — the eye does not reliably separate "their
mistake" from "my mistake" at speed — and it is a distraction with no
competitive value.

So:

- **Your own text**: full character-level feedback. Red on your own mistakes is fine and expected.
- **Opponents**: a position marker only — a progress bar, a caret in a shared passage, a car on a track. Never colour opponent characters by correctness, because you do not have that information and must not ask for it.

Aggregate accuracy does exist, but only *after* a player stops typing, in
`race:player_finished` and `race:finished`. Use it on the results screen, never
during the race.

---

## 1. Setup

```sh
cd code/backend
bun install
bun run auth:migrate   # once, creates better-auth's tables
bun run dev            # http://localhost:8787
```

Frontend:

```sh
cd code/frontend
bun add socket.io-client
```

Env (`code/frontend/.env.local`):

```
NEXT_PUBLIC_BACKEND_URL=http://localhost:8787
```

Backend env (all optional):

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | HTTP + socket port |
| `FRONTEND_URL` | `http://localhost:3000` | Allowed origins, comma-separated |
| `APP_DB_PATH` | `./app.db` | Lobby/race SQLite file |
| `MIN_PLAYERS_TO_START` | `2` | Set to `1` to test a race solo |
| `BETTER_AUTH_SECRET` | generated | Set a real 32+ char secret outside local dev |

---

## 2. Lobby lifecycle

A lobby has a **join code** (6 characters, from an alphabet with no `I`, `O`,
`0` or `1`, so it can be read aloud) and a **status**:

```
                 host emits race:start
   ┌──────────┐ ──────────────────────► ┌───────────┐
   │ in_lobby │                         │ countdown │  5s, text already sent
   └──────────┘                         └───────────┘
        ▲                                     │ gun
        │ 12s after results                   ▼
   ┌──────────┐ ◄──────────────────────  ┌─────────┐
   │ finished │   all done / time limit  │ playing │
   └──────────┘ ◄──────────────────────  └─────────┘
```

| Status | Meaning | Newcomers join as |
| --- | --- | --- |
| `in_lobby` | Idle; host can start, settings editable | `player` (or `spectator` if full) |
| `countdown` | Race about to start | `spectator` |
| `playing` | Race in progress | `spectator` |
| `finished` | Standings on screen | `spectator` |

**Spectators are automatic.** Anyone who joins while a race is running becomes
a spectator; the backend does it, the client never asks for it. When the race
ends the lobby returns to `in_lobby` after `lobbyReopensAt`, and spectators are
promoted to players (oldest first, up to `maxPlayers`). The frontend just
re-renders whatever the latest `lobby:state` says.

Roles: exactly one `host`, plus `player` and `spectator`. If the host leaves,
the oldest remaining member inherits the lobby; if everyone leaves, the lobby is
deleted.

---

## 3. REST API

All routes require the better-auth session cookie, so **every fetch needs
`credentials: "include"`**. Errors come back as
`{ error: { code, message } }` with a matching HTTP status — switch on `code`,
show `message`.

Base: `${NEXT_PUBLIC_BACKEND_URL}/api`

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/lobbies` | Create a lobby, become its host → `201 { lobby }` |
| `GET` | `/lobbies?status=&limit=&offset=` | Browse **public** lobbies → `{ lobbies, total, limit, offset }` |
| `GET` | `/lobbies/mine` | Lobbies you are currently in → `{ lobbies }` |
| `GET` | `/lobbies/code/:code` | Resolve a join code *without* joining → `{ lobby }` |
| `POST` | `/lobbies/join` | Join by code → `{ lobby, role }` |
| `GET` | `/lobbies/:id` | Read one lobby → `{ lobby }` |
| `PATCH` | `/lobbies/:id` | Host-only settings update → `{ lobby }` |
| `DELETE` | `/lobbies/:id` | Host-only; closes it for everyone → `204` |
| `POST` | `/lobbies/:id/leave` | Leave → `204` |
| `GET` | `/lobbies/:id/members` | → `{ members }` |
| `GET` | `/lobbies/:id/races?limit=` | Past races with standings → `{ races }` |
| `GET` | `/races/:id` | One race and its standings → `{ race }` |

**There is deliberately no REST endpoint that starts a race.** Starting,
progress and finishing are socket-only, so there is exactly one authority over
race state.

### Create / update body

```ts
{
  name?: string;                              // ≤ 48 chars
  visibility?: "public" | "private";          // private = code-only, hidden from browse
  maxPlayers?: number;                        // 2..16
  rated?: boolean;
  promptLength?: "short" | "medium" | "long";
}
```

`PATCH` only works while the lobby is `in_lobby` (`409 lobby_busy` otherwise),
and `maxPlayers` cannot be lowered below the current player count
(`409 max_players_too_low`).

### Shapes

```ts
type LobbySnapshot = {
  id: string;
  code: string;              // "H7KQ2M" — show this, it is the invite
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
  createdAt: number;         // epoch ms
  updatedAt: number;
  members: LobbyMember[];
};

type LobbyMember = {
  userId: string;
  displayName: string;
  image: string | null;
  role: "host" | "player" | "spectator";
  isReady: boolean;
  connected: boolean;        // has at least one live socket
  joinedAt: number;
};
```

### Error codes worth handling

| Code | Status | When |
| --- | --- | --- |
| `unauthorized` | 401 | No session — send them to sign-in |
| `lobby_not_found` | 404 | Bad code or the lobby was closed |
| `not_host` | 403 | Host-only action |
| `lobby_busy` | 409 | Settings changed mid-race |
| `max_players_too_low` | 409 | Shrinking below current players |
| `not_enough_players` | 409 | `race:start` with too few connected players |
| `race_already_active` | 409 | `race:start` while a race is running |
| `spectators_cannot_ready` | 409 | Ready toggle shown to a spectator |

---

## 4. Socket connection

One socket per browser tab, created once and kept for the session. Do not
create a socket per lobby.

```ts
// src/lib/socket.ts
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "./realtime-types";

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function getSocket() {
  if (socket) return socket;
  socket = io(process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8787", {
    path: "/socket.io/",
    withCredentials: true,   // REQUIRED: this is how the session cookie is sent
    transports: ["websocket", "polling"],
    autoConnect: false,
  });
  return socket;
}
```

`withCredentials: true` is not optional — the handshake is authenticated with
the better-auth cookie. A socket without it is rejected with
`connect_error: "unauthorized"`, which you should treat as "not signed in".

Every client→server event takes an ack callback with this envelope:

```ts
type Ack<T> =
  | { ok: true;  data: T }
  | { ok: false; error: { code: string; message: string } };
```

A small promise wrapper is worth writing once:

```ts
function emit<T>(event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    getSocket().emit(event, payload, (res: Ack<T>) =>
      res.ok ? resolve(res.data) : reject(res.error),
    );
  });
}
```

---

## 5. Events

### Client → server

| Event | Payload | Ack data | Notes |
| --- | --- | --- | --- |
| `lobby:join` | `{ lobbyId }` | `{ snapshot, race }` | Enters the room **and** joins the lobby. Idempotent. `race` is non-null if one is already in flight. |
| `lobby:leave` | `{ lobbyId }` | `{ left: true }` | |
| `lobby:ready` | `{ lobbyId, ready }` | `{ snapshot }` | Players only |
| `lobby:kick` | `{ lobbyId, userId }` | `{ snapshot }` | Host only |
| `race:start` | `{ lobbyId }` | `{ raceId, startsAt }` | Host only |
| `race:abort` | `{ lobbyId }` | `{ aborted: true }` | Host only |
| `race:progress` | `{ lobbyId, cursor, keystrokes, clientTime }` | — | Hot path, no ack. Send **volatile**. |
| `race:finish` | `{ lobbyId, cursor, keystrokes }` | `RaceFinishSummary` | Optional; the server also detects completion |
| `race:resync` | `{ lobbyId }` | `RaceSync \| null` | After a reconnect or tab wake-up |
| `net:ping` | `{ clientTime }` | `{ clientTime, serverTime }` | Latency + clock offset |

### Server → client

| Event | Payload | What to do |
| --- | --- | --- |
| `lobby:state` | `LobbySnapshot` | **Replace** local lobby state. Never merge. |
| `lobby:event` | `{ type, userId, displayName, ... }` | Toasts only: `member_joined`, `member_left`, `member_kicked`, `host_changed`, `promoted_to_player` |
| `lobby:closed` | `{ lobbyId, reason }` | The lobby is gone — navigate out |
| `lobby:removed` | `{ lobbyId, reason }` | *You* were removed (`kicked` / `left`) |
| `race:countdown` | see below | Show the passage and the countdown |
| `race:started` | `{ raceId, startedAt, endsAt, serverTime }` | Unlock the input |
| `race:tick` | `{ raceId, serverTime, cursors[] }` | Move opponent markers |
| `race:player_finished` | `RaceFinishSummary & { raceId }` | "Alice finished 1st" |
| `race:finished` | see below | Results screen |
| `race:sync` | `RaceSync` | Full state after a reconnect |

```ts
type RaceCountdown = {
  raceId: string;
  lobbyId: string;
  text: string;             // the passage — render it now, greyed out
  startsAt: number;         // server epoch ms when typing becomes legal
  serverTime: number;       // server epoch ms when this was sent
  participants: RaceParticipant[];
  spectating: boolean;      // true => you are watching, not racing
};

type RaceParticipant = {
  userId: string;
  displayName: string;
  image: string | null;
  spectator: boolean;
  connected: boolean;
  cursor: number;
  wpm: number;
  finishedAt: number | null;
  position: number | null;
};

type CursorUpdate = { userId: string; cursor: number; wpm: number };
//                     ^ that is the whole live payload. No mistake data.

type RaceFinishSummary = {
  userId: string;
  displayName: string;
  position: number | null;   // null = did not finish
  wpm: number;
  accuracy: number;          // 0..1, results screen only
  correctChars: number;
  durationMs: number;
  finished: boolean;
  flags: string[];           // "paste_suspected" | "impossible_rate"
};

type RaceFinished = {
  raceId: string;
  lobbyId: string;
  endedAt: number;
  reason: "all_finished" | "time_limit" | "aborted" | "abandoned";
  results: RaceFinishSummary[];
  lobbyReopensAt: number;    // epoch ms the lobby returns to in_lobby
};

type RaceSync = {
  raceId: string;
  lobbyId: string;
  status: "countdown" | "running";
  text: string;
  startsAt: number;
  startedAt: number | null;
  endsAt: number;
  serverTime: number;
  spectating: boolean;
  you: { cursor: number; keystrokes: number } | null;  // null when spectating
  participants: RaceParticipant[];
};
```

---

## 6. The race, end to end

```
host                     server                    everyone in the room
 │  race:start ────────────►│
 │◄──── {raceId,startsAt}   │
 │                          │─ race:countdown ────────────► (text + startsAt,
 │                          │                                per-recipient
 │                          │                                `spectating` flag)
 │                          │   ...5s...
 │                          │─ race:started ──────────────►  unlock input
 │                          │
 │  race:progress ─────────►│  (per keystroke, volatile)
 │                          │  batched at 20 Hz
 │                          │─ race:tick ─────────────────►  move markers
 │                          │
 │                          │─ race:player_finished ──────►
 │                          │─ race:finished ─────────────►  standings
 │                          │   ...12s...
 │                          │─ lobby:state (in_lobby) ────►  spectators promoted
```

### Timings

| What | Value |
| --- | --- |
| Countdown | 5 s |
| Tick broadcast | every 50 ms (20 Hz), only for players who moved |
| Grace after the first finisher | 45 s |
| Race hard limit | 5 min |
| Results screen before reopening | 12 s |
| Disconnect grace before losing your seat | 20 s |

### Clock skew

Every timed payload includes `serverTime`. Compute the offset once and use
server time for all countdowns:

```ts
const offset = payload.serverTime - Date.now();       // add to local now
const msUntilStart = payload.startsAt - (Date.now() + offset);
```

Refine it with `net:ping`:

```ts
const t0 = Date.now();
const { serverTime } = await emit("net:ping", { clientTime: t0 });
const rtt = Date.now() - t0;
const offset = serverTime + rtt / 2 - Date.now();
```

---

## 7. The typing surface

### What the client tracks

- `cursor` — length of the **correctly typed prefix**. It is the index of the first character not yet correctly typed. Backspacing lowers it.
- `keystrokes` — every key that produced or deleted a character, mistakes included. Monotonically increasing. This is what accuracy is computed from.

Recommended input model: an invisible/controlled `<input>` or a `keydown`
handler over a rendered passage, with **paste disabled** (`onPaste →
preventDefault`). The server flags large jumps as `paste_suspected` anyway, but
blocking it client-side is a better experience than being flagged.

```ts
// typed = what the user has actually entered, character by character
const cursor = commonPrefixLength(typed, text);
```

Where the classic "type through mistakes" model applies: the user may keep
typing after an error, but `cursor` does not advance past the first wrong
character until they fix it. Render your own wrong characters in red; the
cursor is what gets sent.

### Sending progress

Send on every keystroke, **volatile** so a stalled connection drops stale
positions instead of queuing them:

```ts
socket.volatile.emit("race:progress", {
  lobbyId,
  cursor,
  keystrokes,
  clientTime: Date.now(),
});
```

Do not throttle in the client. The server batches at 20 Hz; extra client-side
throttling only adds latency to the metric the project is graded on.

When `cursor === text.length`, optionally call `race:finish` to get your own
summary immediately — the server detects completion from `race:progress`
regardless, so this is a UX nicety, not a requirement.

### Rendering opponents

Keep opponent state in a `Map<userId, { cursor, wpm }>` fed by `race:tick`, and
render each as a marker positioned at `cursor / text.length`. Interpolate
between ticks if you want smooth motion (50 ms is already smooth enough for a
progress bar; a caret in shared text benefits from a short CSS transition).

**Again: you have no mistake data for opponents, and must not display any.**
Their marker moves forward when they are correct and stalls when they are not,
which is all the signal a competitor needs.

---

## 8. Screens

**Lobby browser** — `GET /api/lobbies`, plus a join-code input that calls
`POST /api/lobbies/join` and routes to `/lobby/[id]`.

**Lobby room** — on mount, `lobby:join`. Render the snapshot: join code
(prominent, copyable), member list with `role` / `isReady` / `connected`,
settings (editable only by the host, only while `in_lobby`), and a Start button
for the host, disabled when `playerCount < 2` with `not_enough_players`
surfaced as a tooltip. If the `lobby:join` ack returns a non-null `race`, skip
straight to the race screen in the state that payload describes.

**Race screen** — countdown overlay, then the passage. Spectators see the same
screen with the input disabled and a "Spectating" badge; drive that entirely
from `spectating` in `race:countdown` / `race:sync`, not from role guessing.

**Results** — `race:finished.results`, ordered as given. Show `wpm`, `accuracy`,
placing, and a subtle marker for anything in `flags`. A `lobbyReopensAt`
countdown tells everyone when the lobby comes back.

---

## 9. Reconnection

Socket.IO reconnects on its own. What the app must do afterwards:

```ts
socket.on("connect", async () => {
  const { snapshot, race } = await emit("lobby:join", { lobbyId });
  setLobby(snapshot);
  if (race) restoreRace(race);   // resume mid-race, cursor and all
  else clearRace();
});
```

`race.you.cursor` is the server's record of your progress. Trust it over local
state — if the user typed while disconnected, the server did not see it and it
does not count.

You keep your seat for 20 s after your last socket drops (refreshes and flaky
networks are fine). If a race is running you are never dropped mid-race; a
disconnected racer simply stops progressing, and if everyone disconnects the
race ends as `abandoned`.

---

## 10. Latency instrumentation

The project's primary metric is end-to-end update latency, so wire this in from
the start rather than bolting it on:

- `race:progress.clientTime` — when the client sent it
- `race:tick.serverTime` — when the server broadcast it
- `performance.now()` at render — when the frame showed it

Log `serverTime - clientTime` (network + server) and `renderTime - serverTime`
(delivery + render) separately. Reporting one opaque number makes the delay
unattributable, which is exactly what the proposal says to avoid.

---

## 11. Checklist

- [ ] `socket.io-client` installed, single shared socket, `withCredentials: true`
- [ ] `ClientToServerEvents` / `ServerToClientEvents` mirrored from `backend/src/realtime/events.ts`
- [ ] Every REST call uses `credentials: "include"` and handles `{ error: { code, message } }`
- [ ] `lobby:state` **replaces** local state
- [ ] Countdown driven by `startsAt` + clock offset, not a local 5-second timer
- [ ] `race:progress` sent volatile on every keystroke, un-throttled
- [ ] Opponents rendered as position markers only — **no red, no error state**
- [ ] Spectator mode driven by the `spectating` flag
- [ ] `connect` handler re-joins and restores from `race:sync`
- [ ] Paste disabled on the typing surface
- [ ] Latency samples logged with all three timestamps
