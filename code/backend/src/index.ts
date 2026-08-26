import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth";
import { config } from "./lib/config";

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

app.use("*", async (c, next) => {
  if (c.req.path.startsWith("/api/auth/")) {
    return auth.handler(c.req.raw);
  }
  await next();
});

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
