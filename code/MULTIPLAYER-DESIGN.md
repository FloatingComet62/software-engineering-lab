# Multiplayer typing design

## Play loop
Sign in, create a private room or join with a six-character code. Up to eight
players can race together. The host chooses passage length. Connected players
mark themselves ready; the host starts when at least two players are present
and all other connected players are ready. A shared five-second countdown
reveals the passage; everyone then races the same text. Finish the entire
passage correctly to place. Standings stay visible for twelve seconds before
the room reopens for a rematch. Late arrivals spectate until the next round.

## Authority and fairness
Reuse the existing Bun + Socket.IO backend. It owns start time, deadlines,
progress clamping, WPM, aggregate accuracy, and finish order. Client timestamps
never decide a winner. Browser clocks are corrected with server timestamps.
Only the correct prefix advances the racer; mistakes must be corrected.
Opponents display progress and speed, never their mistake information.
The browser prevents paste and sends progress at most every 100 ms, followed
by reliable completion. Keystrokes include incorrect insertions but not
navigation or deletion. The existing server flags suspicious jumps/speed;
these heuristics are not cryptographic proof of honest input. A competitive
ranked product would need server validation of input batches and abuse review.
Rooms created by this UI are private and unrated.

## Network behavior
Disable typing while disconnected. Rejoin on reconnect and restore the
server-confirmed correct prefix and keystroke count. Do not replay buffered
progress from an offline client. Fetch a snapshot when a hidden tab becomes
visible. Disconnects retain a seat for the backend grace period (20 seconds).
Show connection and action errors; socket commands time out instead of hanging.
A first finisher gives remaining racers up to 45 seconds; the overall ceiling
is five minutes. Non-finishers stay visible in results. Authentication is
required so users have stable identities across reconnects.

## Validation
Run frontend lint, TypeScript, production build and the existing backend race
tests. Exercise two separately authenticated clients: create/join, ready,
countdown, progress, mistakes/backspace, finish, standings, rematch, reconnect,
and a late spectator. Do not substitute two tabs of the same account: the
backend intentionally treats them as the same player.

## Verified implementation
Frontend production build and both frontend/backend TypeScript checks pass.
The backend has 14 passing race-engine tests, including the idle-heartbeat
rate-check regression. The socket smoke test uses three separate local test
accounts and verifies readiness enforcement, a common countdown/passage,
live progress, reconnect, late spectators, finish order, matching standings,
accuracy, clean fair-play flags, lobby reopening and spectator promotion.
Run it with the backend running:

```powershell
cd code/frontend
node tests/multiplayer-smoke.mjs
```

The smoke test creates local test accounts and race history. Use a disposable
database for automated CI. Start the backend with `bun run auth:migrate` then
`bun run start`, and the frontend with `bun run dev` in their respective
folders. For online play, deploy both services and configure the public backend
URL, allowed frontend origin and production auth settings; localhost is only
a local preview.
