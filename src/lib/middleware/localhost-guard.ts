/**
 * Localhost Guard — restricts destructive/admin operations to localhost callers.
 *
 * Two layered checks:
 *
 *   1. IP / bind layer. We do NOT trust X-Forwarded-For / X-Real-IP
 *      (spoofable). Two trusted signals are accepted:
 *        a. NextRequest.ip when it is populated (Vercel + a few adapters).
 *        b. The server's bind address — if HOSTNAME (or HOST) is a
 *           loopback address (127.0.0.1 / ::1 / localhost), the OS
 *           guarantees no remote socket can reach the listener at all.
 *           This is the load-bearing signal for self-hosted Node runtime
 *           (standalone server.js + `next start`), where NextRequest.ip
 *           is undefined by default and there is no spoof-proof per-
 *           request alternative.
 *      Without (b), every RBAC-off POST/PUT/PATCH/DELETE returned 403 on
 *      production builds because there was no IP and prod-mode falls
 *      closed — including legitimate dashboard mutations.
 *
 *   2. Origin / Referer layer. On state-changing methods, refuse any
 *      cross-origin request. the reviewer's 2026-05-13 DAST showed evil.com
 *      successfully POSTing to /api/system/purge, /api/break-glass/
 *      activate, /api/proxy/block-mode, and /api/config/defaults via
 *      this exact vector. With the bind-layer trust above, this is the
 *      CSRF defense — a browser tab on attacker.com is on a non-loopback
 *      origin, so its Origin/Referer host won't match ownHost and the
 *      request is refused.
 *
 * @module middleware/localhost-guard
 */

import { NextRequest, NextResponse } from "next/server";
import { validateOriginMatch } from "../auth/origin-match";

const LOCALHOST_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOOPBACK_HOSTNAMES = new Set([
  "127.0.0.1",
  "::1",
  "localhost",
  "0.0.0.0", // NOT loopback-only — flagged below; included so we can recognize and refuse it
]);

const DENY_RESPONSE = NextResponse.json(
  {
    error: "This operation is restricted to localhost. Enable RBAC for remote access with role-based authentication.",
    hint: "Run this from the machine hosting ClawNex, or set up a reverse proxy with authentication.",
  },
  { status: 403 },
);

function isLoopbackBind(): boolean {
  // Standalone server + systemd unit set HOSTNAME (Next.js convention).
  // Fall back to HOST for plain-`node server.js` invocations. Empty string
  // means "no explicit bind" — Next.js defaults to 0.0.0.0 in that case,
  // which is NOT loopback-only, so deny.
  const h = (process.env.HOSTNAME || process.env.HOST || "").trim();
  if (!h) return false;
  if (h === "0.0.0.0" || h === "::") return false;
  return LOOPBACK_HOSTNAMES.has(h);
}

export function requireLocalhost(request: NextRequest): NextResponse | null {
  const nextIp = (request as unknown as { ip?: string }).ip;

  // IP / bind layer.
  if (nextIp) {
    if (!LOCALHOST_IPS.has(nextIp)) return DENY_RESPONSE;
  } else if (process.env.NODE_ENV === "development") {
    // dev mode: next dev binds to loopback. Allow.
  } else if (isLoopbackBind()) {
    // prod mode with loopback-only bind: OS guarantees the socket is
    // unreachable from remote IPs. Allow.
  } else {
    // prod mode, no IP, non-loopback bind: deny.
    return DENY_RESPONSE;
  }

  // Origin layer (mutating methods only — the helper internally exempts
  // GET/HEAD/OPTIONS, so this is a no-op on safe reads).
  return validateOriginMatch(request);
}
