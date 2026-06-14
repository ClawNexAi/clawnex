/**
 * Origin/Referer match — RBAC-independent CSRF Layer 1.
 *
 * State-changing browser requests carry an Origin header (or a Referer as
 * a fallback for older clients). If that header's host does not match the
 * request's own host, the request was driven from a cross-origin page —
 * which is the precise shape of a CSRF attack. Refuse it.
 *
 * Two consumers share this helper:
 *   - validateCsrf() in src/lib/rbac/guard.ts — the authenticated path
 *   - requireLocalhost() in src/lib/middleware/localhost-guard.ts — the
 *     RBAC-off / admin path that ~68 mutating routes call directly
 *
 * Without the second consumer, the reviewer's 2026-05-13 DAST showed evil.com
 * successfully POSTing to /api/system/purge, /api/break-glass/activate,
 * /api/proxy/block-mode, /api/config/defaults — because requireLocalhost
 * only checked the source IP, not the document origin driving the request.
 * Folding the check into requireLocalhost closes that hole for every
 * caller without per-route edits.
 *
 * Non-browser callers (curl, server-side fetch, MCP) send neither Origin
 * nor Referer; those have their own auth gate (API key etc.) and are
 * allowed through here. Safe methods (GET/HEAD/OPTIONS) are not subject
 * to Origin enforcement — CSRF only applies to state changes.
 *
 * @module auth/origin-match
 */

import { NextRequest, NextResponse } from 'next/server';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Codex 2026-05-17 #2: Host allowlist defeats DNS-rebinding bypass.
 *
 * Without an allowlist, an attacker who points attacker.example at
 * 127.0.0.1 lets a victim's browser send Host: attacker.example +
 * Origin: http://attacker.example. Those MATCH, so the pure Host=Origin
 * check below would pass, and requireLocalhost's bind-layer trust
 * (HOSTNAME=127.0.0.1 means the OS guarantees a loopback socket) accepts
 * the request — every RBAC-off mutation route opens up to attacker.com
 * script running in the victim's browser.
 *
 * Defence: after Host=Origin matches, also assert the Host hostname is
 * on a small explicit allowlist. Production gets the public domain from
 * AUTH_EXPECTED_ORIGIN (set by deploy/install-prod.sh). Multi-domain or
 * Tailscale-only setups can opt in extra hosts via TRUSTED_HOSTS.
 */
const DEFAULT_ALLOWED_HOSTNAMES: ReadonlyArray<string> = [
  'localhost',
  '127.0.0.1',
  '::1',
];

function extractHostname(headerValue: string): string {
  // URL parser handles `host[:port]`, `[ipv6]:port`, and bare IPv6 forms
  // consistently — wrap in a synthetic URL just to leverage .hostname.
  try { return new URL(`http://${headerValue}`).hostname; }
  catch { return headerValue.toLowerCase(); }
}

function getAllowedHostnames(): Set<string> {
  const list = new Set<string>(DEFAULT_ALLOWED_HOSTNAMES);
  const expectedOrigin = process.env.AUTH_EXPECTED_ORIGIN;
  if (expectedOrigin) {
    try { list.add(new URL(expectedOrigin).hostname); } catch { /* malformed env */ }
  }
  const trusted = process.env.TRUSTED_HOSTS;
  if (trusted) {
    for (const raw of trusted.split(',').map(s => s.trim()).filter(Boolean)) {
      try { list.add(new URL(`http://${raw}`).hostname); } catch { /* malformed entry */ }
    }
  }
  return list;
}

/**
 * Verify that a request's Host header is on the explicit allowlist AND
 * (for mutating methods) that its Origin/Referer matches that Host.
 * Returns null on success (allowed), or a 403 NextResponse on failure
 * (refused).
 *
 * Codex 2026-05-17 round 2 #2: the host allowlist now runs for EVERY
 * request, including GET/HEAD/OPTIONS. The round-1 fix exited early on
 * safe methods, leaving RBAC-off read routes (Pattern-B) exposed to
 * DNS-rebinding GETs that read response bodies (browser sees same-origin
 * because Host=attacker.example matches Origin=http://attacker.example,
 * so CORS doesn't block the read). Origin/Referer comparison stays
 * mutation-only — CSRF only applies to state changes — but the Host
 * itself must always be one we trust to be answering for our service.
 */
export function validateOriginMatch(request: NextRequest): NextResponse | null {
  const ownHost = request.headers.get('host');

  // ALWAYS enforce the host allowlist when a Host header is present.
  // This catches DNS-rebinding regardless of method. Non-browser callers
  // (raw socket clients) that send no Host header at all fall through
  // to the safe-method / origin checks below — they have other auth
  // gates (API key, mTLS, etc.) and shouldn't be blocked here.
  if (ownHost) {
    const hostGuard = enforceHostAllowlist(ownHost);
    if (hostGuard) return hostGuard;
  }

  // Safe methods bypass Origin/Referer match (CSRF only applies to
  // state changes). Host allowlist above already gates the surface.
  if (SAFE_METHODS.has(request.method)) return null;

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');

  if (origin && ownHost) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== ownHost) {
        return NextResponse.json({ error: 'CSRF: origin mismatch' }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: 'CSRF: malformed origin' }, { status: 403 });
    }
    return null;
  }

  if (!origin && referer && ownHost) {
    try {
      const refHost = new URL(referer).host;
      if (refHost !== ownHost) {
        return NextResponse.json({ error: 'CSRF: referer mismatch' }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: 'CSRF: malformed referer' }, { status: 403 });
    }
    return null;
  }

  // Neither Origin nor Referer present — non-browser caller. Allow.
  return null;
}

function enforceHostAllowlist(ownHost: string): NextResponse | null {
  const hostname = extractHostname(ownHost);
  const allowed = getAllowedHostnames();
  if (!allowed.has(hostname)) {
    // Don't echo the offending Host in the error body — keeps the response
    // useless as a reconnaissance signal for the attacker.
    return NextResponse.json({ error: 'CSRF: host not on allowlist' }, { status: 403 });
  }
  return null;
}
