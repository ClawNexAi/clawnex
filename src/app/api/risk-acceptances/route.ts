// GET /api/risk-acceptances     — list with filters
// POST /api/risk-acceptances    — create new acceptance
//
// GET requires shield:read (any operator can see). POST requires risk:accept
// (only admin + security_manager). Localhost-only fallback when RBAC off.
//
// Spec: docs/superpowers/specs/2026-04-23-risk-acceptance-design.md §5

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from "@/lib/rbac/guard";
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import {
  accept,
  listAcceptances,
  type AcceptanceFilters,
  type AcceptanceQuery,
  type ScopeLevel,
  type SourcePanel,
} from "@/lib/services/risk-acceptance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_PANELS: SourcePanel[] = [
  "trust_audit",
  "blast_radius_combo",
  "blast_radius_lint",
  "correlations",
  "alerts",
];
const VALID_SCOPES: ScopeLevel[] = ["finding", "agent_rule", "rule_global"];
const VALID_STATUS = ["active", "expired", "revoked", "all"] as const;

function authReadOrFail(req: NextRequest): NextResponse | { actor: string } {
  if (isRbacEnabled()) {
    const auth = requireSession(req);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, "shield:read");
    if (perm) return perm;
    return { actor: auth.operator.id };
  }
  const guard = requireLocalhost(req);
  if (guard) return guard;
  return { actor: "localhost" };
}

function authWriteOrFail(req: NextRequest): NextResponse | { actor: string } {
  if (isRbacEnabled()) {
    const auth = requireSession(req);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, "risk:accept");
    if (perm) return perm;
    return { actor: auth.operator.id };
  }
  const guard = requireLocalhost(req);
  if (guard) return guard;
  return { actor: "localhost" };
}

export async function GET(req: NextRequest) {
  const auth = authReadOrFail(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const filters: AcceptanceFilters = {};

  const status = searchParams.get("status");
  if (status && (VALID_STATUS as readonly string[]).includes(status)) {
    filters.status = status as AcceptanceFilters["status"];
  }
  const panel = searchParams.get("source_panel");
  if (panel && (VALID_PANELS as string[]).includes(panel)) {
    filters.source_panel = panel as SourcePanel;
  }
  const expiringStr = searchParams.get("expiring_within_days");
  if (expiringStr) {
    const n = parseInt(expiringStr, 10);
    if (Number.isFinite(n) && n > 0) filters.expiring_within_days = n;
  }

  try {
    const acceptances = listAcceptances(filters);
    return NextResponse.json({
      acceptances,
      meta: {
        total: acceptances.length,
        generated_at: new Date().toISOString(),
        filters,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { error: "list-failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = authWriteOrFail(req);
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const source_panel = body.source_panel;
  const rule_id = body.rule_id;
  const scope_level = body.scope_level;
  const reason = body.reason;
  const evidence = body.evidence;
  const agent_id = body.agent_id ?? null;
  const surface_id = body.surface_id ?? null;
  const expires_at = body.expires_at;

  if (typeof source_panel !== "string" || !(VALID_PANELS as string[]).includes(source_panel)) {
    return NextResponse.json({ error: "invalid-source_panel", detail: `must be one of ${VALID_PANELS.join(", ")}` }, { status: 400 });
  }
  if (typeof rule_id !== "string" || rule_id.length === 0) {
    return NextResponse.json({ error: "invalid-rule_id" }, { status: 400 });
  }
  if (typeof scope_level !== "string" || !(VALID_SCOPES as string[]).includes(scope_level)) {
    return NextResponse.json({ error: "invalid-scope_level", detail: `must be one of ${VALID_SCOPES.join(", ")}` }, { status: 400 });
  }
  if (typeof reason !== "string" || reason.trim().length < 3) {
    return NextResponse.json({ error: "invalid-reason", detail: "reason must be ≥3 characters" }, { status: 400 });
  }
  if (evidence !== undefined && (!Array.isArray(evidence) || !evidence.every((e) => typeof e === "string"))) {
    return NextResponse.json({ error: "invalid-evidence", detail: "evidence must be string[]" }, { status: 400 });
  }
  if (agent_id !== null && typeof agent_id !== "string") {
    return NextResponse.json({ error: "invalid-agent_id" }, { status: 400 });
  }
  if (surface_id !== null && typeof surface_id !== "string") {
    return NextResponse.json({ error: "invalid-surface_id" }, { status: 400 });
  }
  if (expires_at !== undefined && typeof expires_at !== "string") {
    return NextResponse.json({ error: "invalid-expires_at" }, { status: 400 });
  }

  const query: AcceptanceQuery = {
    source_panel: source_panel as SourcePanel,
    rule_id,
    agent_id: agent_id as string | null,
    surface_id: surface_id as string | null,
    evidence: evidence as string[] | undefined,
  };

  try {
    const record = accept(query, {
      scope_level: scope_level as ScopeLevel,
      reason,
      accepted_by: auth.actor,
      expires_at: expires_at as string | undefined,
    });
    return NextResponse.json({ acceptance: record }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: "accept-failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
