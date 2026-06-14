# ClawNex — Adding a New Module

**Audience:** OSS contributors adding net-new functionality to ClawNex.
**Companion docs:** [`CONTRIBUTING.md`](CONTRIBUTING.md) (workflow / DCO / coding style), [`docs/02-high-level-architecture.md`](docs/02-high-level-architecture.md) (HLD), [`docs/18-developer-manual.md`](docs/18-developer-manual.md) (engineering reference), [`docs/14-data-dictionary.md`](docs/14-data-dictionary.md) (schema authoritative source).

This document is the "how do I add a new X?" guide. Six common X's are covered: **a new dashboard panel**, **a new API route**, **a new shield rule**, **a new database table**, **a new MCP tool**, and **a new RBAC permission**.

Each section follows the same shape:

1. **Where it lives** — paths you'll touch
2. **Minimum viable scaffold** — the smallest code change that lights up the feature
3. **Wiring** — what else has to change for the feature to be reachable from the UI / API / scanner
4. **Verification** — commands that confirm the change is correct
5. **Doc updates** — which docs to refresh so the change isn't invisible to other contributors

Read the entire section for your target before opening a PR. Skipping the wiring step is the most common reviewer pushback.

---

## Live counts (verify before you start)

These are the figures other docs cite. They drift between releases. Always re-check:

```bash
# DB tables in the schema
grep -c "CREATE TABLE" src/lib/db/schema.ts

# Built-in shield detections
grep -cE "^\s+id: '[A-Z]" src/lib/shield/rules.ts

# RBAC permissions
grep -oE "'[a-z_]+:[a-z_]+'" src/lib/rbac/types.ts | sort -u | wc -l

# API route handlers
find src/app/api -name "route.ts" | wc -l

# Top-level panel files
ls src/components/dashboard/panels/*.tsx | wc -l
```

---

## 1. Adding a new dashboard panel

A panel is a tab on the SOC dashboard. The panel system is convention-driven: place a `.tsx` file under `src/components/dashboard/panels/`, declare a `TabId`, wire it into the navigation list, and add help metadata.

### 1.1 Where it lives

| File | Role |
|---|---|
| `src/components/dashboard/types.ts` | `TabId` union — add your panel's id |
| `src/components/dashboard/panels/<YourPanel>.tsx` | The panel component itself |
| `src/components/dashboard/index.tsx` | Navigation table (`NAV`) and panel dispatch |
| `src/components/dashboard/constants.ts` | `PANEL_HELP` entry (title, desc, metrics, actions, related) |

### 1.2 Minimum viable scaffold

```tsx
// src/components/dashboard/panels/MyNewPanel.tsx
import { C, Card } from "../shared";

export function MyNewPanel() {
  return (
    <Card title="MY NEW PANEL" accent={C.cyan}>
      <div style={{ fontSize: 13, color: C.txS }}>
        Coming soon — describe the operator workflow this panel surfaces.
      </div>
    </Card>
  );
}
```

### 1.3 Wiring

1. Add the id to the `TabId` union in `src/components/dashboard/types.ts`:

   ```ts
   export type TabId =
     | "missionControl"
     // ...
     | "myNewPanel";    // ← your id
   ```

2. Register the panel in the navigation table in `src/components/dashboard/index.tsx`. Group it under the right section (`MISSION`, `OPS`, `SECURITY`, `GOVERNANCE`, `INFO`):

   ```ts
   const NAV: NavItem[] = [
     // ...
     { id: "myNewPanel", label: "My New Panel", section: "OPS", icon: "..." },
   ];
   ```

3. Add the dispatch case in the same file:

   ```tsx
   {currentTab === "myNewPanel" && <MyNewPanel />}
   ```

4. Add the help entry in `src/components/dashboard/constants.ts`:

   ```ts
   myNewPanel: {
     title: "My New Panel",
     desc: "What the operator sees here. Plain English, no jargon.",
     metrics: ["Top metric — what it counts and how"],
     actions: ["Primary action operators take", "Secondary action"],
     related: ["trafficMonitor", "alertsIncidents"],
   },
   ```

### 1.4 Verification

```bash
npx tsc --noEmit                           # Type-check
npm run dev -- --webpack                   # Boot local dev server
# Open http://127.0.0.1:5001 and click the new tab
```

### 1.5 Doc updates

- `docs/02-high-level-architecture.md` §7.1 Tab Structure — add your panel's row to the appropriate group.
- `docs/23-help-surfaces-index.md` — bump the panel count or category if applicable.
- `docs/06-basic-user-manual.md` — add a one-line operator-facing description.

---

## 2. Adding a new API route

ClawNex uses Next.js App Router. Each route is a `route.ts` file exporting one or more HTTP verb handlers (`GET`, `POST`, `PATCH`, `DELETE`).

### 2.1 Where it lives

| File | Role |
|---|---|
| `src/app/api/<your-route>/route.ts` | The route handler |
| `src/lib/rbac/types.ts` | Add the required permission (if new) |
| `src/lib/rbac/permissions.ts` | Wire the permission into role sets |
| `src/lib/services/<your-service>.ts` | (Optional) Service-layer logic; routes should be thin |

### 2.2 Minimum viable scaffold

```ts
// src/app/api/widgets/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { listWidgets } from '@/lib/services/widget-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // RBAC-on path: session + permission check.
  // RBAC-off path: localhost guard (Pattern-B same-host trust — see AR-002).
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'widgets:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  const widgets = listWidgets();
  return NextResponse.json({ widgets, total: widgets.length });
}
```

### 2.3 Wiring (mutating routes)

`POST` / `PATCH` / `DELETE` handlers MUST also call `validateCsrf()`:

```ts
import { validateCsrf } from '@/lib/rbac/guard';

export async function POST(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'widgets:write');
    if (perm) return perm;
    const csrf = await validateCsrf(request, auth.sessionId);
    if (csrf) return csrf;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }
  // ... handle the request, write to DB, audit-log
}
```

### 2.4 Verification

```bash
npx tsc --noEmit

# Pattern-B static + live verifier — runs against all routes
bash scripts/verify-pattern-b.sh

# Origin/Referer + CSRF guard verifier
bash scripts/verify-origin-block.sh
bash scripts/verify-csrf-session-binding.sh

# Manual cURL (local dev host, RBAC off)
curl http://127.0.0.1:5001/api/widgets
```

### 2.5 Doc updates

- `docs/10-api-reference.md` — add the route under its section with permission, request/response shape, and audit events.
- `docs/14-data-dictionary.md` — if the route reads or writes a new table, document it there.

---

## 3. Adding a new shield rule

Two flavors: **built-in** (ships in `src/lib/shield/rules.ts`, lives in code, deployed with the dashboard) and **operator-authored** (stored in the SQLite `policies` + `policy_rules` tables, created via the Policies & Rules dashboard panel or `POST /api/policies/:id/rules`).

### 3.1 Built-in rule (most common for OSS contributors)

| File | Role |
|---|---|
| `src/lib/shield/rules.ts` | The rule definition (id, title, severity, category, pattern, description) |
| `scripts/shield-triage.ts` | Release-grade verification harness — add a test fixture if your rule covers a new attack class |

Scaffold:

```ts
// Append to ALL_RULES in src/lib/shield/rules.ts:
{
  id: 'CAT-YOUR-RULE-KEY',
  title: 'Human-readable rule title',
  severity: 'HIGH',                       // CRITICAL / HIGH / MEDIUM / LOW
  category: 'outbound-leak',              // see Type RuleCategory in types.ts
  pattern: /your-bounded-regex-here/gi,   // bounded quantifiers only; safe-regex2 will reject ReDoS-class
  description: 'What this rule catches and why it matters.',
},
```

**Rule key format:** `^[A-Z][A-Z0-9_-]*$`. Convention: `<CATEGORY>-<SPECIFIC-NAME>` (e.g., `OUT-PII-EMAIL`, `JAIL-DAN-V11`, `SEC-AWS-KEY`).

### 3.2 Operator-authored rule (custom policy)

Operators add these through the dashboard. Wiring (which you don't write — it already exists):

- `POST /api/policies` to create a custom policy
- `POST /api/policies/:id/rules` to add a rule to it
- The route layer runs `assertRegexSafety` (ReDoS gate) + `normalizeRegexFlags` — accept list is **only `g`/`i`/`m`/`s`/`u`** (no duplicates). The sticky flag `y` and the indices flag `d` are deliberately **rejected**: `y` breaks the evaluator's `regex.exec` iteration model (sticky-mode anchors at `lastIndex` and would miss subsequent matches in the same payload), and `d` adds no detection value while bloating match output. Live source: `src/lib/shield/regex-flags.ts:18-42` (`SUPPORTED_FLAGS` + `CANONICAL_ORDER`).
- Vendor-shipped policies (`source ∈ {curated, system}`) reject mutation with 403 — clone-then-customize is the path

### 3.3 Verification

```bash
# Release-grade triage — your rule must not regress existing fixtures
npx tsx scripts/shield-triage.ts

# Policy framework invariants (if your work touches policy_rules)
npx tsx scripts/policy-evaluator-invariants.ts

# End-to-end policy framework check
npx tsx scripts/verify-policy-framework.ts
```

### 3.4 Doc updates

- Bump the live count in `src/components/dashboard/constants.ts` if you're adding a built-in rule (use the grep above to get the new count).
- `docs/05-reconstruction-playbook.md` — if you're adding a category, mention it in Step 8.

---

## 4. Adding a new database table

Schema is in one file. There is no separate migration framework yet (per [[reconstruction-playbook]] §3 Step 7) — schema is idempotent via `CREATE TABLE IF NOT EXISTS` and column additions go through ad-hoc `ALTER TABLE IF NOT EXISTS` blocks in `src/lib/db/index.ts::runMigrations`.

### 4.1 Where it lives

| File | Role |
|---|---|
| `src/lib/db/schema.ts` | The `CREATE TABLE` DDL and indexes |
| `src/lib/db/index.ts` | If you need a one-time data migration on first boot |
| `src/lib/db/<your-store>.ts` | CRUD wrappers (one store file per logical table or table-group) |
| `src/lib/services/<your-service>.ts` | Service-layer logic (don't bake business rules into stores) |

### 4.2 Minimum viable scaffold

Append to `src/lib/db/schema.ts`:

```sql
CREATE TABLE IF NOT EXISTS widgets (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(name)
);

CREATE INDEX IF NOT EXISTS idx_widgets_enabled ON widgets(enabled);
```

CRUD wrapper at `src/lib/db/widget-store.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { getDb } from './index';

export interface Widget {
  id: string;
  name: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export function createWidget(input: { name: string }): Widget {
  const db = getDb();
  const id = randomUUID();
  db.prepare('INSERT INTO widgets (id, name) VALUES (?, ?)').run(id, input.name);
  return db.prepare('SELECT * FROM widgets WHERE id = ?').get(id) as Widget;
}

export function listWidgets(): Widget[] {
  return getDb().prepare('SELECT * FROM widgets ORDER BY created_at DESC').all() as Widget[];
}
```

### 4.3 Verification

```bash
# Schema compiles (CREATE TABLE is idempotent — runs at first request)
npx tsx scripts/verify-db-perms.sh        # Ensures DB triple is 600 (DAST H2 guard)

# Manual smoke test
DATABASE_PATH=:memory: npx tsx -e "
  import { createWidget, listWidgets } from './src/lib/db/widget-store';
  createWidget({ name: 'test' });
  console.log(listWidgets());
"
```

### 4.4 Doc updates

- `docs/14-data-dictionary.md` §3 — add a table definition (purpose, columns, constraints, indexes, sensitivity, retention) following the §3.100a/b template.
- `docs/01-infrastructure-design.md` §8.2 — add to the appropriate group (Traffic, Alerting, Audit, Config, Operations, Auth, Policy Framework, etc.). Bump the §8.2 table count.

---

## 5. Adding a new MCP tool

MCP tools let Claude Code (and any MCP-compatible client) call into ClawNex. Tools are defined in the MCP server entry; each tool is a function + JSON schema.

### 5.1 Where it lives

| File | Role |
|---|---|
| `src/lib/mcp/server.ts` | Tool registration |
| `src/lib/mcp/tools/<your-tool>.ts` | The tool implementation + Zod schema |
| `src/lib/services/<your-service>.ts` | Reuse the service layer the API routes use |

### 5.2 Minimum viable scaffold

```ts
// src/lib/mcp/tools/list-widgets.ts
import { z } from 'zod';
import { listWidgets } from '@/lib/db/widget-store';
import { auditedInvoke } from '@/lib/mcp/audit';

export const listWidgetsTool = {
  name: 'list_widgets',
  description: 'Returns all widgets currently registered in ClawNex.',
  scope: 'widgets:read',                  // RBAC permission
  inputSchema: z.object({}),
  outputSchema: z.object({
    widgets: z.array(z.any()),
    total: z.number(),
  }),
  handler: auditedInvoke('list_widgets', async () => {
    const widgets = listWidgets();
    return { widgets, total: widgets.length };
  }),
};
```

Register in `src/lib/mcp/server.ts`:

```ts
import { listWidgetsTool } from './tools/list-widgets';

const TOOLS = [
  // ... existing tools
  listWidgetsTool,
];
```

### 5.3 Verification

```bash
npx tsc --noEmit

# Smoke test via local MCP HTTP server (port from MCP_HTTP_PORT env)
curl -X POST http://127.0.0.1:5050/mcp/list_widgets \
  -H 'Authorization: Bearer <MCP_HTTP_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

### 5.4 Doc updates

- `docs/18-developer-manual.md` — MCP Tools table, bump the count (currently 10).
- `docs/02-high-level-architecture.md` §7.2 MCP Tools.
- `docs/06-basic-user-manual.md` — operator-facing description if the tool is something operators would prompt Claude Code about.

---

## 6. Adding a new RBAC permission

Permissions are a closed enum. Adding one requires updating the type union and the role definitions.

### 6.1 Where it lives

| File | Role |
|---|---|
| `src/lib/rbac/types.ts` | `PermissionId` type union |
| `src/lib/rbac/permissions.ts` | `ROLE_PERMISSIONS` map (which roles get the new permission) |

### 6.2 Minimum viable scaffold

```ts
// src/lib/rbac/types.ts — append to the PermissionId union:
export type PermissionId =
  | 'dashboard:view'
  // ... existing
  | 'widgets:read' | 'widgets:write';      // your new ones
```

```ts
// src/lib/rbac/permissions.ts — add to each role's Set:
const ROLE_PERMISSIONS: Record<Role, Set<Permission>> = {
  admin: new Set<Permission>([
    // ... existing
    'widgets:read', 'widgets:write',
  ]),
  security_manager: new Set<Permission>([
    // ... existing
    'widgets:read', 'widgets:write',         // SecMgr can both
  ]),
  operator: new Set<Permission>([
    // ... existing
    'widgets:read',                          // Operator read-only
  ]),
  viewer: new Set<Permission>([
    // ... existing
    'widgets:read',                          // Viewer read-only
  ]),
  auditor: new Set<Permission>([
    // ... existing — no widgets perms unless your route is audit-class
  ]),
};
```

### 6.3 Verification

```bash
npx tsc --noEmit

# Permission count should reflect your addition
grep -oE "'[a-z_]+:[a-z_]+'" src/lib/rbac/types.ts | sort -u | wc -l

# RBAC matrix verifier — run after route + permission are both in place
bash scripts/verify-pattern-b.sh
```

### 6.4 Doc updates

- `docs/07-advanced-user-manual.md` §6.5 Permission Reference matrix — add the row.
- `docs/04-product-requirements.md` REQ-020 Access Control — if the permission unlocks a new product capability, add to the REQ.

---

## Universal review checklist (before opening a PR)

- [ ] `npx tsc --noEmit -p tsconfig.json` is clean
- [ ] Relevant verifier scripts in `scripts/verify-*.sh` pass
- [ ] Live counts in `src/components/dashboard/constants.ts` and operator docs are bumped if you added a panel / rule / permission
- [ ] Audit events fire on every mutation (`audit()` from `src/lib/services/audit-logger.ts` — match action enum from `docs/14-data-dictionary.md` §3.7)
- [ ] If your code path is reachable from RBAC-off mode, the route's `else` branch calls `requireLocalhost(request)` — see [[pattern-b-defense]] for the convention
- [ ] If your code path is a mutating method, the route layer calls `validateCsrf()` against the session id (HMAC binding via `src/lib/auth/csrf-hmac.ts`)
- [ ] Inline documentation per [[inline-documentation]] — module header explains WHY the file exists, decision points explain non-obvious invariants, no comments restating what well-named identifiers already say
- [ ] DCO signoff on every commit (`git commit -s`)

---

## Where things are

```
src/
  app/
    api/                          # Next.js App Router route handlers
      <feature>/route.ts          #   Each file = one route + verb handlers
      v1/                         #   Public API surface (versioned)
  components/
    dashboard/
      index.tsx                   # Orchestrator — NAV table + dispatch
      constants.ts                # PANEL_HELP + glossary + design tokens
      shared.tsx                  # Reusable primitives (Card, Stat, Badge)
      types.ts                    # TabId, NavItem, theme types
      panels/                     # One file per panel
  lib/
    auth/                         # CSRF HMAC, origin-match, build-origin
    db/                           # schema.ts + per-table store files
    middleware/                   # localhost-guard
    rbac/                         # types.ts (PermissionId) + permissions.ts (roles) + guard.ts (route helpers)
    services/                     # Business logic — routes are thin wrappers around services
      auth/                       #   Provider abstraction (local, passkey, github, magic-link)
      audit-logger.ts             #   audit() — the only entry point for audit_log writes
    shield/                       # Scanner engine (built-in rules + policy framework integration)
      rules.ts                    #   ALL_RULES — 163 built-in detections
      scanner.ts                  #   shieldScan orchestrator
      policy-evaluator.ts         #   evaluatePolicies — runs DB-stored policy_rules
      safe-regex.ts               #   ReDoS gate
      redaction.ts                #   applySpans — cleaned-output rewriter
  middleware.ts                   # Edge: CSP nonce, TRACE refusal, dual-window rate limit, RBAC redirect
scripts/
  verify-*.sh / verify-*.ts       # Regression guards — run before opening a PR
docs/
  01-infrastructure-design.md     # LLD — runtime, services, schema, network
  02-high-level-architecture.md   # HLD — components, data flows, security, design decisions
  04-product-requirements.md      # PRD — REQ list
  10-api-reference.md             # API contract
  14-data-dictionary.md           # Schema authoritative source
  18-developer-manual.md          # Engineering reference
  qa/accepted-residuals.md        # AR-001 (CSP style-src-attr) + AR-002 (Pattern-B same-host trust)
  registers/risk-register.md      # Open + closed risks
```

---

## Asking for help

If your change doesn't fit cleanly into one of the six recipes above, open a `discussion` issue first describing the surface area you want to add and tag the maintainer. The most common reason a contributor goes off-pattern is that the change actually spans multiple categories (e.g., new panel + new route + new table) — which is fine, just call it out so reviewers know to walk all the wiring steps in parallel.
