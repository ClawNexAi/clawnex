// Token matching — compare OpenClaw-declared and Hermes-enforced bot tokens
// per comm surface, classify as single-bot (which runtime enforces), dual-bot,
// or not-applicable.
//
// Raw tokens are NEVER stored or returned; only a prefix (first 20 chars) and
// a SHA-256 hash are kept. Equality checks use the hash; operator display
// uses the prefix.
//
// Spec: docs/superpowers/specs/2026-04-23-blast-radius-permissiveness-design.md §4 + §8

import crypto from "crypto";
import type { BotIdentity, TokenIdentity } from "./types";

const MIN_TOKEN_LEN = 8;
const PREFIX_LEN = 20;

export function hashToken(raw: string | null | undefined): TokenIdentity | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length < MIN_TOKEN_LEN) return null;
  return {
    prefix: trimmed.slice(0, PREFIX_LEN),
    hash: crypto.createHash("sha256").update(trimmed).digest("hex"),
  };
}

export function classifyBotIdentity(opts: {
  openclawToken: string | null | undefined;
  hermesToken: string | null | undefined;
}): BotIdentity {
  const oc = opts.openclawToken ?? null;
  const hm = opts.hermesToken ?? null;
  if (!oc && !hm) return "not_applicable";
  if (!oc && hm) return "no_openclaw_declaration";
  if (oc && !hm) return "single_bot_openclaw_enforces";
  if (oc && hm && oc === hm) return "single_bot_hermes_enforces";
  return "dual_bot";
}
