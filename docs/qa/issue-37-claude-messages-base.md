# Issue 37: existing Claude Messages endpoint acceptance

Validated on QA on 2026-10-04 UTC. Target branch: `dev`. Operator authorized the temporary connector lifecycle, limited inference probes, dashboard-only deployment, and commit/push. Closure remains subject to operator acceptance.

## Result

An existing Claude global Messages base omits `/v1`, while the configured OpenAI-compatible provider base includes `/v1`. Exact string matching incorrectly rejected the tested model at Review. The shared resolver now accepts equivalent endpoint roots only when explicitly called for Claude's Messages protocol. Model ownership must still resolve uniquely. Other connectors retain their original matching rules.

The reviewed workflow regression failed before the fix with the same missing-readiness prerequisite observed on QA. It passes after the fix. Coverage also proves ambiguous endpoint/model ownership and unrelated endpoints cannot write settings; Codex matching remains unchanged.

## Validation

1. `npx --no-install tsx scripts/verify-native-agent-routing.ts`: passes locally and on Linux, covering Pi, Codex, initial and existing Claude configuration, signed identity, encrypted ownership, conflict-aware Restore and endpoint rejection cases.
2. `npx --no-install tsx scripts/verify-opencode-routing.ts` and `scripts/verify-hermes-routing-recovery.ts`: pass; existing shared lifecycle and recovery behavior remains unchanged.
3. `npx --no-install tsx scripts/verify-provider-readiness.ts`, `scripts/verify-coding-agent-routing-visibility.ts`, and `npx --no-install tsc --noEmit --incremental false`: pass.
4. Staged Linux production build and isolated standalone smoke checks pass: health is OK, login returns 200, unauthenticated provider access returns 401. Dashboard-only activation preserves the environment, service unit, database inode and unrelated service PIDs; the previous build is retained for rollback.
5. Authenticated live QA: temporary Claude connector appears with its routing pane; Review identifies `claude:global`; native Messages preflight and Apply succeed; a fresh Claude Code 2.1.289 CLI session replies `OK`; Verify reports `protected-and-verified` with one event after Apply, 134 input plus 62 output tokens, and the exact instance identity.

## Cleanup and limits

Reviewed Restore returned the original Claude settings bytes and file mode, removed the recovery journal and signed header, and restored the direct endpoint. Fingerprints/presence for OpenClaw, Hermes, Codex and both OpenCode global configuration locations remained unchanged. Deleting only the temporary Claude connector succeeded, and its absence was verified. Owned browser tabs were closed; user tabs were left untouched. No production deployment or security-policy change occurred.

The model readiness probe and native protocol preflight were separate from the attested CLI request. The complete test stayed within the approved four application-level inference requests, including the earlier rejected-credential attempt. The CLI ran for one turn with tools, MCP loading, customizations and session persistence disabled. Its reported cost was $0.00222; ClawNex correctly reported traffic cost unavailable rather than inventing a price.

The browser console retained historical failed requests and inline-style CSP warnings. The fresh fixed lifecycle completed without failed application requests; no claim of an entirely empty browser console is made.

Project, managed, command-line, environment and extension overrides remain outside the native global connector boundary, as documented in `docs/architecture/native-coding-agent-routing.md`.
