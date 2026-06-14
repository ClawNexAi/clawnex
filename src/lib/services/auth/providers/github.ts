// GitHub OAuth auth provider.
//
// Handshake: standard OAuth 2.0 authorization code flow.
//   1. Browser → /api/auth/github/start  → 302 to github.com/login/oauth/authorize
//      with state cookie (CSRF) + redirect_to (post-login destination)
//   2. GitHub → /api/auth/github/callback?code=...&state=...
//   3. Server exchanges code for access token, fetches /user, looks up the
//      operator linked to that github_user_id, creates a session.
//
// We deliberately do NOT auto-create operators on first GitHub login —
// admins must pre-link an operator's GitHub identity (from Auth & Devices
// settings) before that GitHub account can sign in. Otherwise anyone with
// a GitHub account could create a viewer-role operator just by clicking
// "Sign in with GitHub". Spec §3.6.
//
// Effective config:
//   - enabled flag and credentials live in config_defaults (DB) so admins
//     can manage via the Authentication Methods card without restarts
//   - env vars (config.auth.github.*) act as a bootstrap fallback when
//     the DB row is empty — useful for first-boot deploys
//
// Spec: docs/superpowers/specs/2026-04-23-multi-auth-providers-design.md §3.3

import crypto from "node:crypto";
import { config } from "../../../config";
import { getSetting } from "../../config-service";
import { findGithubLinkByUserId, touchGithubLink } from "../credentials-service";
import { getOperatorById } from "../../operator-service";
import type { AuthResult } from "..";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";

// Setting keys — kept in one place so the settings UI + provider use the same names.
export const GITHUB_SETTINGS = {
  enabled: "auth_github_enabled",
  clientId: "auth_github_client_id",
  clientSecret: "auth_github_client_secret",
  callbackUrl: "auth_github_callback_url",
} as const;

/** Returned by buildAuthorizeUrl — the route stores `state` in a cookie
 *  for CSRF check on the callback. */
export interface GithubStart {
  url: string;
  state: string;
}

/** Effective config, DB-first with env fallback. Read on every use so
 *  changes via the settings UI take effect immediately, no restart. */
export interface EffectiveGithubConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

export function getEffectiveConfig(): EffectiveGithubConfig {
  const dbEnabled = getSetting(GITHUB_SETTINGS.enabled);
  const dbClientId = getSetting(GITHUB_SETTINGS.clientId);
  const dbClientSecret = getSetting(GITHUB_SETTINGS.clientSecret);
  const dbCallbackUrl = getSetting(GITHUB_SETTINGS.callbackUrl);

  return {
    // Default OFF — admin must explicitly enable. Env-set credentials
    // alone don't auto-enable; they're a bootstrap convenience only.
    enabled: dbEnabled === "true",
    clientId: dbClientId || config.auth.github.clientId,
    clientSecret: dbClientSecret || config.auth.github.clientSecret,
    callbackUrl: dbCallbackUrl || config.auth.github.callbackUrl,
  };
}

/** Provider has the credentials needed to talk to GitHub. */
export function isConfigured(): boolean {
  const eff = getEffectiveConfig();
  return Boolean(eff.clientId && eff.clientSecret);
}

/** Admin has flipped the "GitHub OAuth enabled" toggle. Sign-in/link
 *  endpoints refuse to operate when this is false even if credentials
 *  are present — keeps the provider dormant until an admin opts in. */
export function isEnabled(): boolean {
  return getEffectiveConfig().enabled;
}

export function buildAuthorizeUrl(): GithubStart {
  const eff = getEffectiveConfig();
  if (!eff.clientId || !eff.clientSecret) {
    throw new Error("GitHub OAuth not configured (missing client_id or client_secret)");
  }
  const state = crypto.randomBytes(16).toString("hex");
  // Note: we deliberately do NOT pass `allow_signup`. That parameter only
  // affects whether GitHub shows the signup link on its own auth page —
  // it does not restrict which GitHub accounts can authorize, and we
  // already enforce the no-auto-create policy at the credential lookup
  // step in completeGithubCallback.
  const params = new URLSearchParams({
    client_id: eff.clientId,
    redirect_uri: eff.callbackUrl,
    scope: "read:user",
    state,
  });
  return { url: `${GITHUB_AUTHORIZE_URL}?${params.toString()}`, state };
}

/** Minimal /user response shape — we only need id + login. */
interface GithubUser {
  id: number;
  login: string;
}

async function exchangeCodeForToken(code: string): Promise<string> {
  const eff = getEffectiveConfig();
  const res = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: eff.clientId,
      client_secret: eff.clientSecret,
      code,
      redirect_uri: eff.callbackUrl,
    }),
  });
  if (!res.ok) {
    throw new Error(`GitHub token exchange failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) {
    throw new Error(`GitHub token exchange returned no token (${data.error || "unknown"})`);
  }
  return data.access_token;
}

async function fetchGithubUser(token: string): Promise<GithubUser> {
  const res = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "ClawNex-Dashboard",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub /user fetch failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { id?: number; login?: string };
  if (typeof data.id !== "number" || typeof data.login !== "string") {
    throw new Error("GitHub /user response missing id/login");
  }
  return { id: data.id, login: data.login };
}

/**
 * Run the GitHub callback half of the handshake — exchange the code,
 * fetch the user, and resolve to an operator. Returns AuthResult so the
 * route can mint a session on success.
 */
export async function completeGithubCallback(code: string): Promise<AuthResult> {
  if (!isEnabled() || !isConfigured()) {
    return {
      ok: false,
      failure: { error: "GitHub sign-in not enabled", code: "internal_error" },
    };
  }
  let user: GithubUser;
  try {
    const token = await exchangeCodeForToken(code);
    user = await fetchGithubUser(token);
  } catch (err) {
    return {
      ok: false,
      failure: { error: (err as Error).message, code: "internal_error" },
    };
  }

  const link = findGithubLinkByUserId(user.id);
  if (!link) {
    // Identity is valid but no operator has linked it — refuse with a
    // distinct code so the route can show a more useful message ("ask an
    // admin to link your GitHub account") without leaking which other
    // GitHub accounts might be linked.
    return {
      ok: false,
      failure: {
        error: "This GitHub account is not linked to a ClawNex operator",
        code: "provider_not_enrolled",
      },
    };
  }

  const operator = getOperatorById(link.operator_id);
  if (!operator || !operator.is_active) {
    return {
      ok: false,
      failure: { error: "Operator not found or disabled", code: "user_disabled" },
    };
  }

  touchGithubLink(user.id);

  return {
    ok: true,
    data: {
      operatorId: operator.id,
      username: operator.username,
      role: operator.role,
      provider: "github",
    },
  };
}

/**
 * Linking flow — called from the authenticated /api/auth/github/link
 * route after the operator OAuths in. Returns the verified GitHub
 * identity so the route can persist the operator_credentials row.
 */
export async function verifyGithubForLinking(code: string): Promise<
  | { ok: true; githubUserId: number; githubUsername: string }
  | { ok: false; error: string }
> {
  if (!isEnabled() || !isConfigured()) {
    return { ok: false, error: "GitHub OAuth not enabled" };
  }
  try {
    const token = await exchangeCodeForToken(code);
    const user = await fetchGithubUser(token);
    return { ok: true, githubUserId: user.id, githubUsername: user.login };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
