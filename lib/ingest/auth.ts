import "server-only";

/**
 * Ingest auth — Bearer token shared between the Mac runner and the Pi
 * dashboard.
 *
 * The token lives in `INGEST_TOKEN` (Pi side) and `PULSE_INGEST_TOKEN` (Mac
 * runner side). They must match. Set via `.env` and Docker compose
 * environment.
 *
 * Dev mode without a configured token allows unauthenticated requests ONLY
 * when the request originates from localhost. A Pi running NODE_ENV=development
 * bound to 0.0.0.0 used to accept writes from anything on the LAN/Tailnet;
 * the localhost guard closes that door.
 */

let warnedMissingToken = false;

function isLocalhost(req: Request): boolean {
  // Next.js exposes the original remote address via x-forwarded-for when
  // proxied. In direct-connect mode the URL host is the bind address.
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const first = xff.split(",")[0]?.trim() ?? "";
  if (first === "127.0.0.1" || first === "::1" || first === "::ffff:127.0.0.1") return true;
  if (first) return false; // proxied but not from loopback
  const host = (() => {
    try {
      return new URL(req.url).hostname;
    } catch {
      return "";
    }
  })();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function checkIngestAuth(
  req: Request,
): { ok: true } | { ok: false; reason: string; status: number } {
  const expected = process.env.INGEST_TOKEN?.trim();
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, reason: "INGEST_TOKEN not configured", status: 500 };
    }
    if (!warnedMissingToken) {
      warnedMissingToken = true;
      console.warn(
        "[ingest/auth] INGEST_TOKEN not set — only localhost requests accepted. " +
          "Configure the token before exposing the dashboard on a network.",
      );
    }
    return isLocalhost(req)
      ? { ok: true }
      : { ok: false, reason: "INGEST_TOKEN required for non-local callers", status: 401 };
  }
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/.exec(header);
  if (!match) return { ok: false, reason: "missing bearer token", status: 401 };
  if (match[1] !== expected) return { ok: false, reason: "bad token", status: 403 };
  return { ok: true };
}
