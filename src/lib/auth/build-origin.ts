/**
 * Build-time AUTH_EXPECTED_ORIGIN for Edge middleware.
 *
 * Edge Runtime cannot read .env.local at runtime, so webpack inlines this
 * at build time — same pattern as RBAC_BUILD_ENABLED. Used by middleware.ts
 * to issue the unauthenticated → /login redirect on the public origin
 * instead of leaking the upstream http://127.0.0.1:5001 to the browser.
 *
 * Empty string in dev (no AUTH_EXPECTED_ORIGIN set) → middleware falls back
 * to request.url, which is correct for dev where there is no proxy.
 */
export const PUBLIC_ORIGIN_BUILD = process.env.AUTH_EXPECTED_ORIGIN || '';
