import { Hono } from "hono";
import { ApiError } from "../lib/errors";
import { type AppEnv, requireAuth } from "../lib/session";
import { toResultDTO } from "./dto";
import * as raceRepo from "./repo";

/**
 * Read-only race history. Races are created and driven entirely over the
 * socket; HTTP only reads what the server already recorded.
 *
 * Mounted at `/api/races`.
 */
export const raceRoutes = new Hono<AppEnv>();

raceRoutes.use("*", requireAuth);

/** GET /api/races/:id — one race with its final standings. */
raceRoutes.get("/:id", (c) => {
  const race = raceRepo.findRace(c.req.param("id"));
  if (!race) throw ApiError.notFound("race_not_found", "No such race.");

  return c.json({
    race: {
      id: race.id,
      lobbyId: race.lobby_id,
      status: race.status,
      rated: race.rated === 1,
      // The passage is only revealed once the race is over.
      text: race.status === "finished" ? race.prompt_text : null,
      startedAt: race.started_at,
      finishedAt: race.finished_at,
      results: raceRepo.listResults(race.id).map(toResultDTO),
    },
  });
});
