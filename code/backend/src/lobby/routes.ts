import { Hono } from "hono";
import { ApiError } from "../lib/errors";
import { type AppEnv, requireAuth } from "../lib/session";
import { toResultDTO } from "../race/dto";
import * as raceRepo from "../race/repo";
import * as repo from "./repo";
import * as service from "./service";

/**
 * Lobby CRUD.
 *
 * REST owns the lifecycle of a lobby as a record: create, browse, read,
 * update settings, delete, join, leave. Anything that happens *during* a race
 * is realtime-only and lives in `realtime/io.ts` — there is deliberately no
 * HTTP endpoint that starts a race, so the socket connection is the single
 * authority over race state.
 *
 * Mounted at `/api/lobbies`.
 */
export const lobbyRoutes = new Hono<AppEnv>();

lobbyRoutes.use("*", requireAuth);

/** POST /api/lobbies — create a lobby and become its host. */
lobbyRoutes.post("/", async (c) => {
  const body = await readJson(c.req.raw);
  const snapshot = service.createLobby(c.get("user"), body);
  return c.json({ lobby: snapshot }, 201);
});

/** GET /api/lobbies — browse public lobbies. */
lobbyRoutes.get("/", (c) => {
  return c.json(
    service.listLobbies({
      status: c.req.query("status"),
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
    }),
  );
});

/** GET /api/lobbies/mine — every lobby the caller is currently a member of. */
lobbyRoutes.get("/mine", (c) => {
  const memberships = repo.findMembershipsOf(c.get("user").id);
  const lobbies = memberships
    .map((membership) => service.getSnapshotOrNull(membership.lobby_id))
    .filter((snapshot): snapshot is NonNullable<typeof snapshot> => !!snapshot);
  return c.json({ lobbies });
});

/** GET /api/lobbies/code/:code — resolve a join code without joining. */
lobbyRoutes.get("/code/:code", (c) => {
  return c.json({ lobby: service.getByCode(c.req.param("code")) });
});

/** POST /api/lobbies/join — join by code; may land you in as a spectator. */
lobbyRoutes.post("/join", async (c) => {
  const body = await readJson(c.req.raw);
  const code = typeof body.code === "string" ? body.code : "";
  if (!code) {
    throw ApiError.badRequest("invalid_code", "A join code is required.");
  }

  const user = c.get("user");
  const snapshot = service.joinByCode(user, code);
  const member = repo.findMember(snapshot.id, user.id);

  return c.json({
    lobby: snapshot,
    /** `spectator` when the lobby was mid-race or full. */
    role: member?.role ?? "spectator",
  });
});

/** GET /api/lobbies/:id — read one lobby. */
lobbyRoutes.get("/:id", (c) => {
  return c.json({ lobby: service.getSnapshot(c.req.param("id")) });
});

/** PATCH /api/lobbies/:id — host-only settings update, between races. */
lobbyRoutes.patch("/:id", async (c) => {
  const body = await readJson(c.req.raw);
  const snapshot = service.updateLobby(c.get("user"), c.req.param("id"), body);
  return c.json({ lobby: snapshot });
});

/** DELETE /api/lobbies/:id — host-only. Closes the lobby for everyone. */
lobbyRoutes.delete("/:id", (c) => {
  service.deleteLobby(c.get("user"), c.req.param("id"));
  return c.body(null, 204);
});

/** POST /api/lobbies/:id/leave — leave; the host seat is handed on. */
lobbyRoutes.post("/:id/leave", (c) => {
  service.leaveLobby(c.get("user").id, c.req.param("id"));
  return c.body(null, 204);
});

/** GET /api/lobbies/:id/members */
lobbyRoutes.get("/:id/members", (c) => {
  return c.json({ members: service.getSnapshot(c.req.param("id")).members });
});

/** GET /api/lobbies/:id/races — recent finished races with their standings. */
lobbyRoutes.get("/:id/races", (c) => {
  const lobbyId = c.req.param("id");
  const lobby = repo.findById(lobbyId);
  if (!lobby) throw ApiError.notFound("lobby_not_found", "That lobby is gone.");

  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 10, 1), 50);
  const races = raceRepo.listLobbyRaces(lobbyId, limit).map((race) => ({
    id: race.id,
    startedAt: race.started_at,
    finishedAt: race.finished_at,
    rated: race.rated === 1,
    results: raceRepo.listResults(race.id).map(toResultDTO),
  }));

  return c.json({ races });
});

/** Body parser that treats a missing or malformed body as `{}`. */
async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}
