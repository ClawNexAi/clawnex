// /api/config/auth-methods
//
// Admin-only endpoint for the AUTHENTICATION METHODS card. Reads the
// effective enable + credential state for each provider (DB-first, env
// fallback), and persists changes to config_defaults.
//
// Security:
//   - GET requires config:read; PUT requires config:write
//   - Client secret is masked on GET (replaced with "••••" if present)
//     so the value never re-leaks once stored
//   - PUT only updates fields actually present in the body (partial
//     update); empty client_secret string is treated as "no change"
//     so the masked round-trip can't accidentally clobber the secret

import { NextRequest, NextResponse } from "next/server";
import { requireSession, requirePermission, isRbacEnabled } from "@/lib/rbac/guard";
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { getSetting, setSetting } from "@/lib/services/config-service";
import { GITHUB_SETTINGS } from "@/lib/services/auth/providers/github";
import {
  MAGIC_LINK_SETTINGS,
  getEffectiveConfig as getMagicLinkEffectiveConfig,
} from "@/lib/services/auth/providers/magic-link";
import { config } from "@/lib/config";
import { logEvent } from "@/lib/services/audit-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MASK = "••••••••";

function readGithub() {
  const enabled = getSetting(GITHUB_SETTINGS.enabled) === "true";
  const clientId = getSetting(GITHUB_SETTINGS.clientId) || config.auth.github.clientId;
  const clientSecretRaw = getSetting(GITHUB_SETTINGS.clientSecret) || config.auth.github.clientSecret;
  const callbackUrl = getSetting(GITHUB_SETTINGS.callbackUrl) || config.auth.github.callbackUrl;
  const clientSecretSource: "db" | "env" | "none" = getSetting(GITHUB_SETTINGS.clientSecret)
    ? "db"
    : config.auth.github.clientSecret
      ? "env"
      : "none";
  return {
    enabled,
    clientId,
    // Mask the secret on read — the UI shows the mask placeholder, and a
    // PUT with an empty string preserves the stored value.
    clientSecret: clientSecretRaw ? MASK : "",
    clientSecretSource,
    callbackUrl,
  };
}

function readMagicLink() {
  // Magic Link is live in v0.9.2. Effective state is the combination of
  // admin toggle (config_defaults.auth_magic_link_enabled) AND a configured
  // mail provider — the AuthMethodsCard uses `available` to decide whether
  // the toggle is a no-op (when mail isn't configured yet).
  return getMagicLinkEffectiveConfig();
}

export async function GET(request: NextRequest) {
  // RBAC on: session + permission. RBAC off: localhost-only — matches the
  // defense-in-depth pattern used by every other mutation-capable config
  // route (see /api/config/mail, /api/system/migrate, etc.). Without this
  // fallback, a network-reachable RBAC-off dashboard exposes GitHub OAuth
  // config anonymously.
  if (isRbacEnabled()) {
    const session = requireSession(request);
    if (session instanceof NextResponse) return session;
    const denied = requirePermission(session.operator, "config:read");
    if (denied) return denied;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  return NextResponse.json({
    passkey: { enabled: true, alwaysOn: true, note: "WebAuthn passkeys are always available." },
    github: readGithub(),
    magicLink: readMagicLink(),
    local: { enabled: true, breakGlass: true, note: "Local password is the break-glass identifier — always enabled." },
  });
}

interface PutBody {
  github?: {
    enabled?: boolean;
    clientId?: string;
    clientSecret?: string;
    callbackUrl?: string;
  };
  magicLink?: {
    enabled?: boolean;
  };
}

export async function PUT(request: NextRequest) {
  // Same dual-gate as GET. Both modes land on the same mutation code below.
  let actorUsername = "admin";
  if (isRbacEnabled()) {
    const session = requireSession(request);
    if (session instanceof NextResponse) return session;
    const denied = requirePermission(session.operator, "config:write");
    if (denied) return denied;
    actorUsername = session.operator.username;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  let body: PutBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const changes: string[] = [];

  if (body.github) {
    const gh = body.github;
    if (typeof gh.enabled === "boolean") {
      setSetting(GITHUB_SETTINGS.enabled, gh.enabled ? "true" : "false");
      changes.push(`github.enabled=${gh.enabled}`);
    }
    if (typeof gh.clientId === "string") {
      setSetting(GITHUB_SETTINGS.clientId, gh.clientId.trim());
      changes.push("github.clientId");
    }
    // Empty string means "leave existing secret alone" so the masked
    // round-trip is non-destructive. Non-empty replaces the stored value.
    if (typeof gh.clientSecret === "string" && gh.clientSecret.length > 0 && gh.clientSecret !== MASK) {
      setSetting(GITHUB_SETTINGS.clientSecret, gh.clientSecret);
      changes.push("github.clientSecret");
    }
    if (typeof gh.callbackUrl === "string") {
      setSetting(GITHUB_SETTINGS.callbackUrl, gh.callbackUrl.trim());
      changes.push("github.callbackUrl");
    }
  }

  if (body.magicLink) {
    const ml = body.magicLink;
    if (typeof ml.enabled === "boolean") {
      setSetting(MAGIC_LINK_SETTINGS.enabled, ml.enabled ? "true" : "false");
      changes.push(`magicLink.enabled=${ml.enabled}`);
    }
  }

  if (changes.length > 0) {
    logEvent(
      actorUsername,
      "auth_methods_updated",
      "config",
      "auth-methods",
      `Updated: ${changes.join(", ")}`,
      "auth",
    );
  }

  return NextResponse.json({ ok: true, changed: changes });
}
