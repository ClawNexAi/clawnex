/**
 * ClawNex Configuration — reads from environment variables.
 *
 * All defaults are generic (localhost) — no personal IPs or credentials.
 * This module is the single source of truth for external service URLs and
 * feature flags. Values come from .env (loaded by Next.js automatically).
 *
 * Why a central config object: Avoids scattered process.env reads throughout
 * the codebase. Type-safe, with sensible defaults for local development.
 * Production values are set during installation by setup.sh or the installer.
 *
 * @module config
 */

import path from 'node:path';
import os from 'node:os';

export const config = {
  port: parseInt(process.env.PORT || '5001', 10),

  // LiteLLM proxy
  litellm: {
    port: parseInt(process.env.LITELLM_PORT || '4001', 10),
    masterKey: process.env.LITELLM_MASTER_KEY || '',
  },

  // OpenClaw Gateway
  openclaw: {
    url: process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
    token: process.env.OPENCLAW_GATEWAY_TOKEN || '',
  },

  // LM Studio instances — configured via environment or dashboard
  lmstudio: {
    fleet: {
      url: process.env.LMSTUDIO_FLEET_URL || 'http://localhost:1234/v1',
      name: process.env.LMSTUDIO_FLEET_NAME || 'LM Studio',
    },
    main: {
      url: process.env.LMSTUDIO_MAIN_URL || 'http://localhost:1234/v1',
      name: process.env.LMSTUDIO_MAIN_NAME || 'LM Studio',
    },
  },

  // Paperclip — only checked if explicitly configured. apiKey + companyId
  // unlock the enriched data surface (dashboard / agents / activity / costs /
  // approvals) — without them the connector still polls /api/health for
  // online/offline visibility.
  paperclip: {
    url: process.env.PAPERCLIP_URL || 'http://127.0.0.1:3100',
    apiKey: process.env.PAPERCLIP_API_KEY || '',
    companyId: process.env.PAPERCLIP_COMPANY_ID || '',
  },

  // Autensa (Mission Control) — only checked if explicitly configured
  autensa: {
    url: process.env.AUTENSA_URL || 'http://127.0.0.1:4000',
    token: process.env.AUTENSA_TOKEN || '',
  },

  // Claw3D — only checked if explicitly configured
  claw3d: {
    url: process.env.CLAW3D_URL || 'http://localhost:3156',
  },

  // Database — DATABASE_PATH explicit env var wins; otherwise fall back to
  // clawnex.db (post-rebrand default). The real resolver in src/lib/db/index.ts
  // also auto-detects a legacy ./sentinel.db if one exists, so callers reading
  // config.db.path directly are fine on fresh installs.
  db: {
    path: process.env.DATABASE_PATH || './clawnex.db',
  },

  // Clawkeeper
  clawkeeper: {
    scanIntervalMs: parseInt(process.env.CLAWKEEPER_SCAN_INTERVAL_MS || '3600000', 10),
    binary: process.env.CLAWKEEPER_BINARY || path.join(os.homedir(), '.local', 'bin', 'clawkeeper.sh'),
  },

  // Agent Workspace
  workspace: {
    path: process.env.OPENCLAW_WORKSPACE_PATH || path.join(os.homedir(), '.openclaw', 'workspace'),
  },

  // Session Log Watcher — scans all agent session directories
  sessionWatcher: {
    path: process.env.OPENCLAW_SESSIONS_PATH || path.join(os.homedir(), '.openclaw', 'agents', 'main', 'sessions'),
    agentsRoot: path.join(os.homedir(), '.openclaw', 'agents'),
    pollIntervalMs: parseInt(process.env.SESSION_WATCHER_INTERVAL_MS || '10000', 10),
    enabled: process.env.SESSION_WATCHER_ENABLED !== 'false',
  },

  // RBAC — operator identity and role-based access control
  rbac: {
    enabled: process.env.RBAC_ENABLED === 'true',
    sessionTtlHours: parseInt(process.env.SESSION_TTL_HOURS || '24', 10),
    maxSessionsPerOperator: parseInt(process.env.MAX_SESSIONS_PER_OPERATOR || '5', 10),
    loginRateLimitPerMinute: parseInt(process.env.LOGIN_RATE_LIMIT || '5', 10),
    accountLockoutThreshold: parseInt(process.env.ACCOUNT_LOCKOUT_THRESHOLD || '10', 10),
  },

  // Multi-auth providers — Passkeys (WebAuthn) + GitHub OAuth.
  // RP ID must be the registrable domain (or parent) the dashboard is
  // served from; expectedOrigin is the full scheme+host+port the browser
  // will send. GitHub OAuth values are blank by default — admin enables
  // in Settings.
  //
  // expectedOrigin is intentionally EMPTY by default (CX-G4 fix from the
  // 2026-04-26 adversarial review). Earlier the default was
  // `http://localhost:5001`, which made the trust-boundary helpers'
  // "fallback to request.nextUrl.origin" unreachable on public deploys
  // where the env was stale or absent — public hosts ended up issuing
  // session/CSRF cookies without `Secure`. With an empty default,
  // publicOrigin() / isPublicSecure() in src/lib/services/auth/index.ts
  // legitimately fall back to the request's own origin (which on dev
  // resolves to http://localhost:5001 anyway and on prod resolves to the
  // public host — exactly what we want).
  auth: {
    rpID: process.env.AUTH_RP_ID || 'localhost',
    rpName: process.env.AUTH_RP_NAME || 'ClawNex',
    expectedOrigin: process.env.AUTH_EXPECTED_ORIGIN || '',
    github: {
      clientId: process.env.GITHUB_OAUTH_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET || '',
      callbackUrl: process.env.GITHUB_OAUTH_CALLBACK_URL || '',
    },
  },

  // Hermes Agent — local SQLite watcher
  hermes: {
    home: process.env.HERMES_HOME || path.join(os.homedir(), '.hermes'),
    pollIntervalMs: parseInt(process.env.HERMES_WATCHER_INTERVAL_MS || '10000', 10),
    enabled: process.env.HERMES_WATCHER_ENABLED !== 'false',
  },
} as const;
