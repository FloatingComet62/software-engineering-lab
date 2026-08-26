import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth";
import { config } from "./lib/config";
import { onError } from "./lib/errors";
import { lobbyRoutes } from "./lobby/routes";
import { sweepStaleLobbies } from "./lobby/service";
import { profileRoutes } from "./profile/routes";

const app = new Hono();

app.onError(onError);

app.use(
  "/api/*",
  cors({
    origin: config.frontendUrls,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  }),
);

/**
 * better-auth owns every path under `/api/auth/`.
 *
 * Mounted as a prefix check rather than a wildcard route on purpose: Hono
 * picks one of several internal routers depending on the route table, and
 * under some of them a wildcard does not match more than one segment — which
 * silently 404s `/api/auth/sign-up/email` while `/api/auth/ok` keeps working.
 * A prefix test cannot regress that way. It runs after the CORS middleware
 * above, so auth responses still carry the right headers.
 */
app.use("*", async (c, next) => {
  if (c.req.path.startsWith("/api/auth/")) {
    return auth.handler(c.req.raw);
  }
  await next();
});

app.route("/api/lobbies", lobbyRoutes);
app.route("/api/profile", profileRoutes);

app.get("/", (c) => c.text("I See I Type — API"));
app.get("/health", (c) => c.json({ ok: true, serverTime: Date.now() }));

console.log(
  `[server] listening on http://localhost:${config.port} (socket path ${config.socket.path})`,
);

export default {
  port: config.port,
  ...engine.handler(),
  fetch: app.fetch,
};
