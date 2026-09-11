import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * A failure that is safe to describe to the client.
 *
 * `code` is a stable machine-readable string; the frontend switches on it,
 * `message` is only ever shown to humans.
 */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  static badRequest(code: string, message: string) {
    return new ApiError(400, code, message);
  }
  static unauthorized(message = "You must be signed in.") {
    return new ApiError(401, "unauthorized", message);
  }
  static forbidden(code: string, message: string) {
    return new ApiError(403, code, message);
  }
  static notFound(code: string, message: string) {
    return new ApiError(404, code, message);
  }
  static conflict(code: string, message: string) {
    return new ApiError(409, code, message);
  }

  toPayload() {
    return { error: { code: this.code, message: this.message } };
  }
}

export function onError(err: Error, c: Context) {
  if (err instanceof ApiError) {
    return c.json(err.toPayload(), err.status);
  }
  console.error("[http] unhandled error", err);
  return c.json(
    { error: { code: "internal_error", message: "Something went wrong." } },
    500,
  );
}

/** Ack envelope used by every Socket.IO callback. */
export type Ack<T> = (
  response:
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string } },
) => void;

/** Runs `fn` and reports the outcome through a Socket.IO ack callback. */
export async function replyWith<T>(ack: Ack<T> | undefined, fn: () => T | Promise<T>) {
  try {
    const data = await fn();
    ack?.({ ok: true, data });
  } catch (err) {
    if (err instanceof ApiError) {
      ack?.({ ok: false, error: { code: err.code, message: err.message } });
      return;
    }
    console.error("[socket] unhandled error", err);
    ack?.({
      ok: false,
      error: { code: "internal_error", message: "Something went wrong." },
    });
  }
}
