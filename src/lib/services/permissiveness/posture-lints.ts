// Posture-lint rules — static checks over the scanned posture for
// obvious misconfigurations that don't require runtime evidence.
//
// Seeded rules:
//  - telegram_channel_in_user_allowlist:  flags chat/group IDs (start with '-')
//                                          appearing in TELEGRAM_ALLOWED_USERS
//  - discord_non_snowflake_in_user_allowlist: flags non-snowflake strings
//                                              in DISCORD_ALLOWED_USERS
//
// Extension point: add new rules to POSTURE_LINT_RULES. Every rule MUST
// provide `applies()` (for cheap pre-filter) and `check()` (returns a finding
// or null). Findings ALWAYS carry a confidence drawn from the source posture.
//
// Spec: docs/superpowers/specs/2026-04-23-blast-radius-permissiveness-design.md §4 (findings) + §2 (seeded rules)

import type {
  PostureLintFinding,
  PostureLintRule,
  Surface,
} from "./types";

// Telegram user IDs are positive integers. Group/channel IDs are negative
// integers (e.g. -1001234567890). A negative ID in a *_ALLOWED_USERS var
// is almost certainly a misconfiguration.
const TELEGRAM_USER_ID_RE = /^[0-9]+$/;

// Discord IDs are 64-bit snowflakes, 17-20 decimal digits.
const DISCORD_SNOWFLAKE_RE = /^[0-9]{17,20}$/;

export const POSTURE_LINT_RULES: PostureLintRule[] = [
  {
    id: "telegram_channel_in_user_allowlist",
    name: "Telegram chat/group ID in user-allowlist env var",
    applies: (s) => s.id === "telegram",
    check: (s) => {
      const layers = s.hermesLayer ?? [];
      for (const layer of layers) {
        const posture = layer.posture.dmAccessGate;
        const ids = posture.value?.allowedUserIds ?? [];
        const suspicious = ids.filter((id) => !TELEGRAM_USER_ID_RE.test(id));
        if (suspicious.length > 0) {
          return {
            ruleId: "telegram_channel_in_user_allowlist",
            surfaceId: s.id,
            field: `hermes.${layer.profileId}.env.TELEGRAM_ALLOWED_USERS`,
            value: suspicious.join(","),
            rationale:
              "TELEGRAM_ALLOWED_USERS contains IDs that do not match the positive-integer user-ID pattern. Telegram chat/group IDs are negative integers; using them in a USER allowlist is almost certainly a misconfiguration. This env var governs approval-button authorization at gateway/platforms/telegram.py:1440-1445 — a channel ID there either grants no one or behaves unexpectedly.",
            severity: "medium",
            confidence: posture.provenance.level,
          };
        }
      }
      return null;
    },
  },
  {
    id: "discord_non_snowflake_in_user_allowlist",
    name: "Discord non-snowflake ID in user-allowlist env var",
    applies: (s) => s.id === "discord",
    check: (s) => {
      const layers = s.hermesLayer ?? [];
      for (const layer of layers) {
        const posture = layer.posture.dmAccessGate;
        const ids = posture.value?.allowedUserIds ?? [];
        const suspicious = ids.filter((id) => !DISCORD_SNOWFLAKE_RE.test(id));
        if (suspicious.length > 0) {
          return {
            ruleId: "discord_non_snowflake_in_user_allowlist",
            surfaceId: s.id,
            field: `hermes.${layer.profileId}.env.DISCORD_ALLOWED_USERS`,
            value: suspicious.join(","),
            rationale:
              "DISCORD_ALLOWED_USERS contains IDs that do not match the Discord snowflake format (17-20 digits). Likely a pasted-in channel/guild ID or a typo.",
            severity: "medium",
            confidence: posture.provenance.level,
          };
        }
      }
      return null;
    },
  },
];

export function evaluateLints(surfaces: Surface[]): PostureLintFinding[] {
  const findings: PostureLintFinding[] = [];
  for (const s of surfaces) {
    for (const rule of POSTURE_LINT_RULES) {
      if (!rule.applies(s)) continue;
      const f = rule.check(s);
      if (f) findings.push(f);
    }
  }
  return findings;
}
