import { createMiddleware } from "hono/factory";
import { auth } from "../auth";
import { ApiError } from "./errors";

/** The slice of the better-auth user we care about across the app. */
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

export type AppEnv = {
  Variables: {
    user: SessionUser;
  };
};

/**
 * Resolves a better-auth session from raw headers.
 *
 * Works for both HTTP requests (cookie header) and the Socket.IO handshake,
 * where the cookie is forwarded by the browser when the client is created
 * with `withCredentials: true`.
 */
export async function getSessionUser(
  headers: Headers,
): Promise<SessionUser | null> {
  try {
    const session = await auth.api.getSession({ headers });
    if (!session?.user) return null;
    return {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? null,
    };
  } catch (err) {
    console.error("[auth] failed to resolve session", err);
    return null;
  }
}

/** Rejects the request unless a valid session is present. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const user = await getSessionUser(c.req.raw.headers);
  if (!user) throw ApiError.unauthorized();
  c.set("user", user);
  await next();
});
