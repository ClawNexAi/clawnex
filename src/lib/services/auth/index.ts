// Multi-auth provider system — shared types and provider registry.
//
// Each authentication provider (local password, passkey, GitHub OAuth,
// magic-link) returns the same AuthResult shape so the login route can
// stay provider-agnostic. The route layer remains responsible for
// rate-limiting, lockout, audit logging, and session creation — providers
// only verify "is this credential valid for this operator".
//
// The operators.auth_providers column stores which providers each
// operator has enrolled (CSV, e.g. "local,passkey"). The catalog of
// available providers is enforced via this module.
//
// Spec: docs/superpowers/specs/2026-04-23-multi-auth-providers-design.md

import type { Role } from "../../rbac/types";
import { config } from "../../config";

/**
 * Public-facing origin for redirect URLs in auth flows.
 *
 * Behind a reverse proxy (Caddy → 127.0.0.1:5001), `request.nextUrl.origin`
 * resolves to the upstream URL the proxy connected to, NOT the URL the
 * browser sees. That breaks GitHub OAuth callbacks, magic links in email,
 * and password-reset links — all of which need the public origin.
 *
 * Order of preference:
 *   1. AUTH_EXPECTED_ORIGIN env (canonical public origin, set during
 *      install-prod.sh; also drives WebAuthn rpID checks).
 *   2. request.nextUrl.origin as a last-resort fallback for dev where the
 *      env var may be absent and the browser is hitting localhost directly.
 */
export function publicOrigin(request: { nextUrl: { origin: string } }): string {
  return config.auth.expectedOrigin || request.nextUrl.origin;
}

/**
 * Whether the public-facing origin is HTTPS.
 *
 * `request.nextUrl.protocol` is unreliable behind a reverse proxy — Caddy
 * terminates TLS and proxies plain HTTP to the upstream, so the upstream
 * always sees `http:` even on https://domain.tld. We anchor on the
 * canonical public origin instead, so cookies set under public HTTPS get
 * the Secure flag they require for compliance and HSTS interplay.
 */
export function isPublicSecure(request: { nextUrl: { origin: string } }): boolean {
  return publicOrigin(request).startsWith("https:");
}

/** Names of providers we ship. New providers must be added here so the
 *  operator enrollment column can validate them. */
export type AuthProviderName = "local" | "passkey" | "github" | "magic_link";

/** Providers that can verify credentials in this build. Magic-link joined
 *  in v0.9.2 — admin-gated via auth_magic_link_enabled setting + mail
 *  provider configured. Per-operator enrollment isn't required (any operator
 *  with an email address on file can request a link when the admin enables
 *  the provider globally). */
export const ENABLED_PROVIDERS: readonly AuthProviderName[] = [
  "local",
  "passkey",
  "github",
  "magic_link",
] as const;

/** Successful authentication outcome — the operator's identity that the
 *  route layer should turn into a session. */
export interface AuthSuccess {
  operatorId: string;
  username: string;
  role: Role;
  /** Which provider satisfied the auth — flows into session metadata
   *  and audit logs so we can answer "how did this person get in?" */
  provider: AuthProviderName;
}

/** Failure modes shared across providers. Code is machine-readable so the
 *  route can decide whether to apply lockout penalties (invalid_credentials
 *  yes, provider_not_enrolled no — that's a config issue, not an attack). */
export type AuthFailureCode =
  | "invalid_credentials"
  | "user_disabled"
  | "rate_limited"
  | "account_locked"
  | "provider_not_enrolled"
  | "challenge_expired"
  | "internal_error";

export interface AuthFailure {
  /** User-facing message — must be generic for credential-class failures
   *  (no user enumeration). Provider/config failures can be more specific. */
  error: string;
  code: AuthFailureCode;
}

export type AuthResult =
  | { ok: true; data: AuthSuccess }
  | { ok: false; failure: AuthFailure };

/** Parse the operators.auth_providers CSV column into a deduped list,
 *  filtering out anything not in the catalog. Defensive — ignores empty
 *  strings or whitespace from older rows that predate the column. */
export function parseEnrolledProviders(csv: string | null | undefined): AuthProviderName[] {
  if (!csv) return [];
  const seen = new Set<AuthProviderName>();
  for (const part of csv.split(",")) {
    const trimmed = part.trim() as AuthProviderName;
    if (ENABLED_PROVIDERS.includes(trimmed)) {
      seen.add(trimmed);
    }
  }
  return Array.from(seen);
}

/** Serialize the enrolled-provider list back to the CSV column format. */
export function serializeEnrolledProviders(providers: AuthProviderName[]): string {
  return Array.from(new Set(providers)).join(",");
}
