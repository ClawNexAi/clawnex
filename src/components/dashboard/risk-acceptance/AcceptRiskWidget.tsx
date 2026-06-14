// AcceptRiskWidget — shared UI for accepting + revoking risk acceptances.
//
// Used by Trust Audit, Blast Radius (combos + lints), Correlations, and
// Alerts panels to keep the affordance consistent across surfaces.
//
//   <AcceptRiskButton query={...} onAccepted={...} />
//   <SuppressedFindingCard finding={...} acceptance={...} onRevoked={...}>
//     ...optional children for finding-specific labels...
//   </SuppressedFindingCard>
//
// Spec: docs/superpowers/specs/2026-04-23-risk-acceptance-design.md §7

"use client";

import { useState } from "react";
import { C, F } from "../constants";

export type SourcePanel =
  | "trust_audit"
  | "blast_radius_combo"
  | "blast_radius_lint"
  | "correlations"
  | "alerts";

export type ScopeLevel = "finding" | "agent_rule" | "rule_global";

export interface AcceptanceQuery {
  source_panel: SourcePanel;
  rule_id: string;
  agent_id?: string | null;
  surface_id?: string | null;
  evidence?: string[];
}

export interface SuppressionAcceptanceLite {
  id: string;
  scope_level: ScopeLevel;
  accepted_by: string;
  accepted_at: string;
  reason: string;
  expires_at: string;
}

const PANEL_LABELS: Record<SourcePanel, string> = {
  trust_audit: "Accept risk",
  blast_radius_combo: "Accept risk",
  blast_radius_lint: "Accept risk",
  correlations: "Snooze",
  alerts: "Suppress similar",
};

const PANEL_DEFAULT_DAYS: Record<SourcePanel, number> = {
  trust_audit: 90,
  blast_radius_combo: 90,
  blast_radius_lint: 90,
  correlations: 30,
  alerts: 90,
};

function isoDaysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10); // yyyy-mm-dd for <input type="date">
}

function isoFromDateInput(s: string): string | undefined {
  if (!s) return undefined;
  // Treat the date as UTC end-of-day so the acceptance lasts the full day.
  return new Date(`${s}T23:59:59.000Z`).toISOString();
}

const SCOPE_HELP: Record<ScopeLevel, string> = {
  finding: "this exact finding (re-fires on evidence change)",
  agent_rule: "this rule for this agent (any evidence)",
  rule_global: "this rule for any agent (use sparingly)",
};

export interface AcceptRiskButtonProps {
  query: AcceptanceQuery;
  /** Called after a successful accept; parent should refresh data. */
  onAccepted?: () => void;
  /** Optional override for the button label (defaults from PANEL_LABELS). */
  label?: string;
  /** Optional accent color for the button border (defaults to subtle). */
  accent?: string;
}

export function AcceptRiskButton({ query, onAccepted, label, accent }: AcceptRiskButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState<ScopeLevel>("finding");
  const [expiresAt, setExpiresAt] = useState<string>(isoDaysFromNow(PANEL_DEFAULT_DAYS[query.source_panel]));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (reason.trim().length < 3) {
      setError("Reason must be at least 3 characters.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/risk-acceptances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_panel: query.source_panel,
          rule_id: query.rule_id,
          agent_id: query.agent_id ?? null,
          surface_id: query.surface_id ?? null,
          evidence: query.evidence ?? [],
          scope_level: scope,
          reason: reason.trim(),
          expires_at: isoFromDateInput(expiresAt),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || body.error || `HTTP ${res.status}`);
      }
      // Success — close form, reset, notify parent.
      setOpen(false);
      setReason("");
      setScope("finding");
      setExpiresAt(isoDaysFromNow(PANEL_DEFAULT_DAYS[query.source_panel]));
      onAccepted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const buttonAccent = accent ?? C.txT;
  const buttonLabel = label ?? PANEL_LABELS[query.source_panel];

  if (!open) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title={`Mark this finding as an accepted risk. Records who/why/until-when in audit log.`}
        style={{
          background: "transparent",
          border: `1px solid ${buttonAccent}55`,
          color: buttonAccent,
          fontSize: 10,
          fontWeight: 700,
          fontFamily: F.sans,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          padding: "3px 8px",
          borderRadius: 3,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {buttonLabel}
      </button>
    );
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: `${C.info}08`,
        border: `1px solid ${C.info}33`,
        borderRadius: 6,
        padding: 12,
        marginTop: 8,
        fontSize: 11,
        color: C.txS,
        fontFamily: F.sans,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: C.info, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {buttonLabel}
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 10, color: C.txT, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Reason (required, becomes audit-log evidence)
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. trusted operator prompts; mitigated via sandbox; legacy provider, will route through proxy in Q3"
          rows={2}
          style={{
            background: C.bg,
            border: `1px solid ${C.brd}`,
            borderRadius: 4,
            color: C.tx,
            fontSize: 12,
            padding: "6px 8px",
            fontFamily: F.sans,
            outline: "none",
            resize: "vertical",
          }}
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 10, color: C.txT, textTransform: "uppercase", letterSpacing: "0.04em" }}>Scope</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {(["finding", "agent_rule", "rule_global"] as ScopeLevel[]).map((s) => (
            <label key={s} style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer" }}>
              <input
                type="radio"
                name={`scope-${query.rule_id}`}
                value={s}
                checked={scope === s}
                onChange={() => setScope(s)}
                style={{ marginTop: 3 }}
              />
              <span>
                <span style={{ color: C.tx, fontWeight: 600 }}>{s.replace(/_/g, " ")}</span>
                <span style={{ color: C.txT, marginLeft: 6 }}>{SCOPE_HELP[s]}</span>
              </span>
            </label>
          ))}
        </div>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 10, color: C.txT, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Expires (default: {PANEL_DEFAULT_DAYS[query.source_panel]} days — risk acceptance is reviewed periodically)
        </span>
        <input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          style={{
            background: C.bg,
            border: `1px solid ${C.brd}`,
            borderRadius: 4,
            color: C.tx,
            fontSize: 12,
            padding: "6px 8px",
            fontFamily: F.mono,
            outline: "none",
            width: 160,
          }}
        />
      </label>

      {error && (
        <div style={{
          fontSize: 11,
          color: C.danger,
          background: `${C.danger}10`,
          border: `1px solid ${C.danger}33`,
          borderRadius: 4,
          padding: "6px 8px",
        }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
          disabled={submitting}
          style={{
            background: "transparent",
            border: `1px solid ${C.brd}`,
            color: C.txT,
            fontSize: 11,
            fontWeight: 600,
            padding: "5px 12px",
            borderRadius: 3,
            cursor: submitting ? "not-allowed" : "pointer",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || reason.trim().length < 3}
          style={{
            background: submitting ? C.brd : C.info,
            border: `1px solid ${C.info}`,
            color: "#fff",
            fontSize: 11,
            fontWeight: 700,
            padding: "5px 12px",
            borderRadius: 3,
            cursor: submitting || reason.trim().length < 3 ? "not-allowed" : "pointer",
            opacity: reason.trim().length < 3 ? 0.6 : 1,
          }}
        >
          {submitting ? "Saving…" : buttonLabel}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SuppressedFindingCard — greyed-out card rendered in the Accepted Risks
// section at the bottom of each panel. Renders the same finding label as
// the active card but with reason / expiry / accepted_by metadata + a
// Revoke button.
// ---------------------------------------------------------------------------

export interface SuppressedFindingCardProps {
  title: string;                    // human label of the finding
  acceptance: SuppressionAcceptanceLite;
  onRevoked?: () => void;
  /** Optional secondary line of metadata about the finding itself. */
  meta?: string;
}

export function SuppressedFindingCard({ title, acceptance, onRevoked, meta }: SuppressedFindingCardProps) {
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expiresAt = new Date(acceptance.expires_at);
  const acceptedAt = new Date(acceptance.accepted_at);
  const now = new Date();
  const daysUntilExpiry = Math.ceil((expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  const expiringSoon = daysUntilExpiry <= 14;

  const revoke = async () => {
    const confirmReason = prompt(`Revoke this acceptance?\n\n"${title}"\n\nEnter a short revoke reason (will be recorded in the audit log):`);
    if (!confirmReason || confirmReason.trim().length === 0) return;
    setRevoking(true);
    setError(null);
    try {
      const res = await fetch(`/api/risk-acceptances/${acceptance.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: confirmReason.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || body.error || `HTTP ${res.status}`);
      }
      onRevoked?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div
      style={{
        background: `${C.bg}`,
        border: `1px solid ${C.brd}`,
        borderLeft: `3px solid ${C.txT}`,
        borderRadius: 6,
        padding: "10px 12px",
        marginBottom: 8,
        opacity: 0.78,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.06em",
            padding: "2px 6px",
            borderRadius: 3,
            background: `${C.txT}18`,
            color: C.txT,
            border: `1px solid ${C.txT}44`,
            textTransform: "uppercase",
          }}
        >
          ACCEPTED · {acceptance.scope_level.replace(/_/g, " ")}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.txS, flex: 1, textDecoration: "line-through" }}>
          {title}
        </span>
        <button
          type="button"
          onClick={revoke}
          disabled={revoking}
          title="Revoke the acceptance and bring this finding back to active"
          style={{
            background: "transparent",
            border: `1px solid ${C.brd}`,
            color: C.warn,
            fontSize: 10,
            fontWeight: 700,
            fontFamily: F.sans,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            padding: "3px 8px",
            borderRadius: 3,
            cursor: revoking ? "wait" : "pointer",
          }}
        >
          {revoking ? "…" : "Revoke"}
        </button>
      </div>
      {meta && <div style={{ fontSize: 11, color: C.txT, marginTop: 4, fontFamily: F.mono }}>{meta}</div>}
      <div style={{ fontSize: 11, color: C.txT, marginTop: 6, lineHeight: 1.5 }}>
        Accepted by <span style={{ color: C.tx, fontFamily: F.mono }}>{acceptance.accepted_by}</span>
        {" "}on{" "}
        <span style={{ color: C.tx, fontFamily: F.mono }}>{acceptedAt.toISOString().slice(0, 10)}</span>
        {" · "}
        Expires{" "}
        <span style={{ color: expiringSoon ? C.warn : C.tx, fontFamily: F.mono }}>
          {expiresAt.toISOString().slice(0, 10)}
        </span>
        {expiringSoon && <span style={{ color: C.warn, marginLeft: 6 }}>({daysUntilExpiry}d left)</span>}
      </div>
      <div style={{ fontSize: 11, color: C.txS, marginTop: 4, fontStyle: "italic" }}>
        &ldquo;{acceptance.reason}&rdquo;
      </div>
      {error && (
        <div style={{
          fontSize: 11,
          color: C.danger,
          background: `${C.danger}10`,
          border: `1px solid ${C.danger}33`,
          borderRadius: 4,
          padding: "6px 8px",
          marginTop: 6,
        }}>
          Revoke failed: {error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AcceptedRisksSection — collapsible wrapper that renders a list of
// SuppressedFindingCards. Used by every panel.
// ---------------------------------------------------------------------------

export interface AcceptedRisksSectionProps {
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function AcceptedRisksSection({ count, children, defaultOpen = false }: AcceptedRisksSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      style={{
        margin: "16px 0 0",
        background: `${C.txT}0a`,
        border: `1px solid ${C.brd}`,
        borderLeft: `3px solid ${C.txT}`,
        borderRadius: 6,
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          padding: "10px 14px",
          fontSize: 11,
          fontWeight: 700,
          color: C.txT,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          listStyle: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>▶</span>
        Accepted risks ({count})
        <span style={{ fontSize: 10, color: C.txT, fontWeight: 500, textTransform: "none", letterSpacing: 0, marginLeft: "auto" }}>
          excluded from active aggregate · click to inspect or revoke
        </span>
      </summary>
      <div style={{ padding: "8px 14px 14px" }}>{children}</div>
    </details>
  );
}
