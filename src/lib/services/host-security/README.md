# ClawNex Host Security

ClawNex host-security posture currently runs through the pinned scanner in
`third_party/clawkeeper/clawkeeper.sh`. The runtime path is local-first:

1. `CLAWKEEPER_BINARY`, for operator override and emergency testing.
2. `third_party/clawkeeper/clawkeeper.sh`, the bundled default.
3. `~/.local/bin/clawkeeper.sh`, legacy fallback for upgraded installs.

The public API and database still use the `clawkeeper` scanner key for
compatibility with existing scans, dashboards, and audit history. Product copy
should call this "Host Security Scanner" or "ClawNex Host Security".

## Native Port Plan

Port checks incrementally into TypeScript modules while preserving
`/api/security/scan`, `security_scans`, and `security_findings` response shapes.

1. Keep the bundled shell scanner as the compatibility fallback.
2. Port read-only checks first: OS detection, firewall status, disk encryption,
   SSH settings, listening ports, Docker/container posture, env-file permissions,
   credential exposure, and OpenClaw/LiteLLM config hygiene.
3. Emit the same `PASS` / `FAIL` / `WARN` / `SKIP` statuses and hardening
   categories that `clawkeeper-mapper.ts` already understands.
4. Gate any auto-remediation separately. Native scanning should be safe to run
   from the dashboard without mutating the host.
5. Once native parity is high enough, flip the runner order to native first,
   bundled shell fallback second, and keep legacy fallback last.

This lets ClawNex stop relying on upstream availability or branding without
breaking existing customer data or dashboards during the migration.
