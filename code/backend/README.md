# Backend

Hono + Socket.IO on Bun. Auth via better-auth, lobbies and races in SQLite.

```sh
bun install
bun run auth:migrate   # once, creates better-auth's tables in auth.db
bun run dev            # http://localhost:8787
bun test               # race scoring unit tests
bun run typecheck
```

`auth:migrate` runs [`src/scripts/migrate-auth.ts`](src/scripts/migrate-auth.ts)
rather than `@better-auth/cli`: the CLI loads `src/auth.ts` under Node via jiti,
which cannot resolve `bun:sqlite`.

## Layout

```
src/
  index.ts            server bootstrap: Hono app + Socket.IO engine
  auth.ts             better-auth (its own auth.db)
  scripts/            one-off maintenance entry points
  db/index.ts         app.db schema, migrations, restart recovery
  lib/                config, errors, session, event bus
  lobby/              lobby CRUD: types, repo, service (rules), routes (REST)
  race/               prompts, scoring engine, race manager, results, routes
  realtime/           event contract + Socket.IO handlers
```

The split to keep in mind: **REST owns the lobby as a record**, **the socket
owns the race**. There is no HTTP endpoint that starts a race, so race state
has exactly one authority.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | HTTP + socket port |
| `FRONTEND_URL` | `http://localhost:3000` | Allowed origins, comma-separated |
| `APP_DB_PATH` | `./app.db` | Lobby/race database |
| `MIN_PLAYERS_TO_START` | `2` | Set to `1` to test a race solo |
| `BETTER_AUTH_SECRET` | generated | Set a real 32+ char secret outside local dev |

## Frontend integration

See [`../MULTIPLAYER-INTEGRATION.md`](../MULTIPLAYER-INTEGRATION.md) for the
full REST + socket contract, including the rule that no mistake information is
broadcast during a race.
