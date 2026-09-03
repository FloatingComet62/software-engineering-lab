import { Hono } from "hono";
import { type AppEnv, requireAuth } from "../lib/session";
import * as repo from "./repo";

/** Mounted at `/api/profile`. */
export const profileRoutes = new Hono<AppEnv>();

profileRoutes.use("*", requireAuth);

/** GET /api/profile — current user's profile, created on first read. */
profileRoutes.get("/", (c) => {
  const row = repo.getOrCreate(c.get("user"));
  return c.json({
    profile: {
      name: row.name,
      email: row.email,
      bestScore: row.best_score,
    },
  });
});
