"use client";

/**
 * ReadinessBanner — top-of-Fleet deployment-readiness / trust-state summary.
 *
 * Surfaces 5 signals at a glance so operators have ONE obvious place to see
 * whether the environment is demo, protected, or not ready. Plain language,
 * severity-coded dots, action link per row.
 *
 * Signals + sources:
 *   - Authentication       → /api/auth/status                (rbacEnabled, operatorCount)
 *   - Shield               → /api/proxy/block-mode           (blockMode on|off)
 *   - Providers            → /api/openclaw/routing           (routed vs direct counts)
 *   - Trust Audit          → /api/trust-audit (GET, cached)  (meta.last_run)
 *   - Posture Scan         → /api/security/history?limit=1   (scans[0].scannedAt)
 *
 * Any signal we cannot resolve renders with a grey dot + "unknown" rather than
 * faking a pass or fail.
 */

import React, { useCallback, useEffect, useState } from "react";
import { C, F } from "./constants";
import { Dot } from "./shared";
import { formatTimeAgo, isStale } from "./shared";
import type { TabId } from "./types";

// ---------------------------------------------------------------------------
// Signal types
// ---------------------------------------------------------------------------

type Severity = "green" | "amber" | "red" | "unknown";

interface ReadinessRow {
  key: string;
  label: string;
  severity: Severity;
  value: React.ReactNode;
  action?: { label: string; onClick: () => void };
  tooltip?: string;
}

const SEV_COLOR: Record<Severity, string> = {
  green: C.green,
  amber: C.warn,
  red: C.danger,
  unknown: C.txT,
};

// Staleness thresholds — these pick when a signal flips from green to amber.
const TRUST_AUDIT_STALE_MS = 24 * 60 * 60 * 1000; // 24h
const POSTURE_STALE_MS = 24 * 60 * 60 * 1000; // 24h
const REFRESH_INTERVAL_MS = 45_000;

// ---------------------------------------------------------------------------
// Fetchers — each one returns a ReadinessRow (severity "unknown" on failure)
// ---------------------------------------------------------------------------

interface Fetchers {
  onNavigate: (tab: TabId, focus?: string) => void;
}

async function fetchAuthRow(f: Fetchers): Promise<ReadinessRow> {
  const base: ReadinessRow = {
    key: "auth",
    label: "Authentication",
    severity: "unknown",
    value: "unknown",
    action: { label: "Configure", onClick: () => f.onNavigate("accessControl") },
  };
  try {
    const res = await fetch("/api/auth/status");
    if (!res.ok) return base;
    const d = await res.json() as { rbacEnabled?: boolean; operatorCount?: number };
    const rbacOn = Boolean(d.rbacEnabled);
    const ops = Number(d.operatorCount || 0);
    if (rbacOn && ops > 0) {
      return { ...base, severity: "green", value: `RBAC enabled · ${ops} operator${ops === 1 ? "" : "s"}` };
    }
    if (rbacOn && ops === 0) {
      return { ...base, severity: "red", value: "RBAC enabled but no operators yet" };
    }
    // RBAC off: amber — local-dev default, fine for now, but not production-ready.
    return { ...base, severity: "amber", value: "RBAC disabled (localhost-only)" };
  } catch {
    return base;
  }
}

async function fetchShieldRow(f: Fetchers): Promise<ReadinessRow> {
  const base: ReadinessRow = {
    key: "shield",
    label: "Shield",
    severity: "unknown",
    value: "unknown",
    action: { label: "Open Shield", onClick: () => f.onNavigate("shield") },
  };
  try {
    const res = await fetch("/api/proxy/block-mode");
    if (!res.ok) return base;
    const d = await res.json() as { blockMode?: string };
    if (d.blockMode === "on") {
      return { ...base, severity: "green", value: "Block mode (threats blocked inline)" };
    }
    if (d.blockMode === "off") {
      return { ...base, severity: "amber", value: "Observe mode (threats logged, not blocked)" };
    }
    return base;
  } catch {
    return base;
  }
}

async function fetchProvidersRow(f: Fetchers): Promise<ReadinessRow> {
  const base: ReadinessRow = {
    key: "providers",
    label: "Providers",
    severity: "unknown",
    value: "unknown",
    action: { label: "View Routing", onClick: () => f.onNavigate("configuration", "openclawRouting") },
    tooltip:
      "Routed = traffic goes through LiteLLM and is scanned by the shield before leaving the host. " +
      "Direct = traffic bypasses the shield (OAuth / subscription providers like Claude.ai or Gemini). " +
      "A mix is normal; the Session Watcher still records direct-provider traffic retroactively.",
  };
  try {
    const res = await fetch("/api/openclaw/routing");
    if (!res.ok) return base;
    const d = await res.json() as { found?: boolean; providers?: Array<{ routed: boolean }> };
    if (!d.found) {
      return { ...base, severity: "amber", value: "openclaw.json not found" };
    }
    const provs = d.providers || [];
    if (provs.length === 0) {
      return { ...base, severity: "amber", value: "No providers registered" };
    }
    const routed = provs.filter(p => p.routed).length;
    const direct = provs.length - routed;
    // All routed = green; any direct = amber (not a gap, just a caveat).
    const sev: Severity = direct === 0 ? "green" : "amber";
    const value = direct === 0
      ? `${routed} routed through LiteLLM (shielded)`
      : `${routed} routed · ${direct} direct`;
    return { ...base, severity: sev, value };
  } catch {
    return base;
  }
}

async function fetchTrustAuditRow(f: Fetchers): Promise<ReadinessRow> {
  const base: ReadinessRow = {
    key: "trustAudit",
    label: "Trust Audit",
    severity: "unknown",
    value: "unknown",
    action: { label: "Open Audit", onClick: () => f.onNavigate("trustAudit") },
  };
  try {
    const res = await fetch("/api/trust-audit");
    if (!res.ok) return base;
    const d = await res.json() as { meta?: { last_run?: string | null } };
    const lastRun = d.meta?.last_run;
    if (!lastRun) {
      return { ...base, severity: "red", value: "Never run" };
    }
    const stale = isStale(lastRun, TRUST_AUDIT_STALE_MS);
    return {
      ...base,
      severity: stale ? "amber" : "green",
      value: `Last run ${formatTimeAgo(lastRun)}`,
    };
  } catch {
    return base;
  }
}

async function fetchPostureRow(f: Fetchers): Promise<ReadinessRow> {
  // Phase 3: Posture row sourced from /api/security/history?limit=1, which
  // delegates to the canonical posture-service. The Fleet table, Security
  // Posture panel, and this banner all consume the same scan now, so the
  // numbers match. Action label is always "Open Security Posture" — the
  // previous "Run Now" copy implied direct execution but only navigated.
  const base: ReadinessRow = {
    key: "posture",
    label: "Hardening Scan",
    severity: "unknown",
    value: "unknown",
    action: { label: "Open Posture", onClick: () => f.onNavigate("securityPosture") },
    tooltip:
      "Latest host-security hardening score. Same scan as the Fleet row's " +
      "Hardening column and the Security Posture panel. Distinct from the " +
      "dynamic Threat Pressure score (alerts + shield + infra) — that's a " +
      "different concept and surfaces separately.",
  };
  try {
    const res = await fetch("/api/security/history?limit=1");
    if (!res.ok) return base;
    const d = await res.json() as { scans?: Array<{ scannedAt?: string; overallGrade?: string; overallScore?: number }> };
    const scans = d.scans || [];
    if (scans.length === 0) {
      return {
        ...base,
        severity: "red",
        value: "Never scanned",
      };
    }
    const latest = scans[0];
    const stale = isStale(latest.scannedAt, POSTURE_STALE_MS);
    const scoreBad = typeof latest.overallScore === "number" && latest.overallScore < 60;
    let sev: Severity = "green";
    if (scoreBad) sev = "red";
    else if (stale) sev = "amber";
    const parts: string[] = [];
    if (latest.overallGrade) parts.push(`Grade ${latest.overallGrade}`);
    if (typeof latest.overallScore === "number") parts.push(`${latest.overallScore}%`);
    parts.push(`last scan ${formatTimeAgo(latest.scannedAt)}`);
    return { ...base, severity: sev, value: parts.join(" · ") };
  } catch {
    return base;
  }
}

// ---------------------------------------------------------------------------
// ReadinessBanner component
// ---------------------------------------------------------------------------

const COLLAPSE_STORAGE_KEY = "clawnex.readinessBannerCollapsed";

/** Top-of-Fleet deployment-readiness banner. */
export function ReadinessBanner({ onNavigate, demoMode, setupComplete = true }: {
  onNavigate: (tab: TabId, focus?: string) => void;
  demoMode: boolean;
  /** When false, the banner auto-collapses (saves above-the-fold space while the
   *  Welcome Wizard is the operator's primary action). Operator can still toggle
   *  manually; that choice wins and persists. */
  setupComplete?: boolean;
}): JSX.Element {
  const [rows, setRows] = useState<ReadinessRow[]>(() => [
    { key: "auth", label: "Authentication", severity: "unknown", value: "loading..." },
    { key: "shield", label: "Shield", severity: "unknown", value: "loading..." },
    { key: "providers", label: "Providers", severity: "unknown", value: "loading..." },
    { key: "trustAudit", label: "Trust Audit", severity: "unknown", value: "loading..." },
    { key: "posture", label: "Posture Scan", severity: "unknown", value: "loading..." },
  ]);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  // null = follow the auto-default (driven by setupComplete). "0"/"1" = operator's
  // manual override, persisted to localStorage so it survives reload but stays
  // per-browser (this is a UI preference, not a deployment setting).
  const [manualCollapse, setManualCollapse] = useState<"0" | "1" | null>(null);

  // Read persisted choice once on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (v === "0" || v === "1") setManualCollapse(v);
    } catch { /* private mode / disabled storage */ }
  }, []);

  // Effective collapsed state: manual override wins; otherwise auto-collapse
  // until setup is complete.
  const collapsed = manualCollapse !== null
    ? manualCollapse === "1"
    : !setupComplete;

  const toggleCollapsed = useCallback(() => {
    const next = !collapsed ? "1" : "0";
    setManualCollapse(next);
    try { window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next); } catch { /* ignore */ }
  }, [collapsed]);

  const refresh = useCallback(async () => {
    const f: Fetchers = { onNavigate };
    const results = await Promise.all([
      fetchAuthRow(f),
      fetchShieldRow(f),
      fetchProvidersRow(f),
      fetchTrustAuditRow(f),
      fetchPostureRow(f),
    ]);
    setRows(results);
    setLastRefresh(new Date());
  }, [onNavigate]);

  useEffect(() => {
    // In demo mode, keep the banner visible but don't hammer the real APIs —
    // they still work, so let them run; this keeps demo vs live parity honest.
    refresh();
    const iv = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [refresh]);

  // Highest-severity signal drives the outer card tone so the banner can't be
  // "all green" if any gap is red.
  const worst: Severity = rows.reduce<Severity>((acc, r) => {
    const rank = { red: 3, amber: 2, unknown: 1, green: 0 } as const;
    return rank[r.severity] > rank[acc] ? r.severity : acc;
  }, "green");
  const borderColor = SEV_COLOR[worst];

  return (
    <div style={{
      position: "relative",
      marginBottom: 12,
      background: `linear-gradient(180deg, ${C.glassPanel}, ${C.glassPanel2})`,
      backdropFilter: "blur(18px)",
      WebkitBackdropFilter: "blur(18px)",
      border: `1px solid ${borderColor}33`,
      borderLeft: `3px solid ${borderColor}`,
      borderRadius: 14,
      boxShadow: C.glassCardShadow,
      overflow: "hidden",
    }}>
      {/* Radial-glow overlay — canonical glass treatment, MC-signature depth. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(circle at 10% 0%, rgba(34,211,238,.10), transparent 36%)",
          pointerEvents: "none",
        }}
      />
      {/* Header — clickable to toggle collapse */}
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand Deployment Readiness" : "Collapse Deployment Readiness"}
        style={{
          all: "unset",
          position: "relative",
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
          padding: "10px 14px",
          borderBottom: collapsed ? "none" : `1px solid ${C.glassBorderSubtle}`,
          background: `${borderColor}10`,
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Caret rotates when expanded — pure CSS, no icon dependency. */}
          <span aria-hidden style={{
            display: "inline-block",
            width: 0, height: 0,
            borderLeft: "5px solid transparent",
            borderRight: "5px solid transparent",
            borderTop: `6px solid ${C.txS}`,
            transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            transition: "transform 120ms ease",
            marginRight: 2,
          }} />
          <Dot color={borderColor} size={8} glow={worst === "green"} pulse={worst === "red"} />
          <span style={{
            fontSize: 11, fontFamily: F.sans, fontWeight: 700,
            letterSpacing: "0.1em", textTransform: "uppercase", color: C.tx,
          }}>Deployment Readiness</span>
          {demoMode && (
            <span style={{
              fontSize: 9, fontFamily: F.mono, fontWeight: 800,
              padding: "1px 6px", borderRadius: 3,
              background: `${C.txT}22`, color: C.txT,
              letterSpacing: "0.08em",
            }}>DEMO</span>
          )}
          {collapsed && (
            // When collapsed, surface the worst-severity dot count so the operator
            // can see at-a-glance whether anything needs attention without expanding.
            // internal reviewer 2026-05-06 contrast: this is decision-bearing summary copy —
            // lift from 10/txT to 12/txS so it's scannable without expanding.
            <span style={{
              fontSize: 12, fontFamily: F.mono, color: C.txS,
              letterSpacing: "0.04em", marginLeft: 4,
            }}>
              {(() => {
                const red = rows.filter(r => r.severity === "red").length;
                const amber = rows.filter(r => r.severity === "amber").length;
                if (red === 0 && amber === 0) return "all green";
                const bits: string[] = [];
                if (red) bits.push(`${red} red`);
                if (amber) bits.push(`${amber} amber`);
                return bits.join(" · ");
              })()}
            </span>
          )}
        </div>
        {/* internal reviewer 2026-05-06 contrast: refresh-label is decision-bearing
            (operator checks freshness before trusting status) — lift
            from 10/txT to 12/txS. */}
        <span style={{
          fontSize: 12, fontFamily: F.mono, color: C.txS,
          textTransform: "uppercase", letterSpacing: "0.08em",
        }}>
          {lastRefresh ? `Refreshed ${formatTimeAgo(lastRefresh)}` : "Refreshing..."}
        </span>
      </button>

      {/* Rows — hidden when collapsed */}
      {!collapsed && (
      <div style={{ position: "relative" }}>
        {rows.map((row, idx) => (
          <div
            key={row.key}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "9px 14px",
              borderTop: idx === 0 ? "none" : `1px solid ${C.glassBorderSubtle}`,
              fontSize: 13,
            }}
            title={row.tooltip || undefined}
          >
            <Dot
              color={SEV_COLOR[row.severity]}
              size={8}
              glow={row.severity === "green"}
              pulse={row.severity === "red"}
            />
            <span style={{
              width: 120, minWidth: 120,
              // internal reviewer 2026-05-06 contrast: row label is decision-bearing — lift 11→12.
              fontSize: 12, fontFamily: F.sans, fontWeight: 700,
              letterSpacing: "0.06em", textTransform: "uppercase",
              color: C.txS,
            }}>{row.label}</span>
            <span style={{ flex: 1, color: C.tx, fontFamily: F.sans, lineHeight: 1.4 }}>
              {row.value}
            </span>
            {row.action && (
              <button
                onClick={row.action.onClick}
                style={{
                  padding: "5px 11px",
                  fontSize: 11, fontFamily: F.sans, fontWeight: 600,
                  background: C.glassSurfTrans,
                  border: `1px solid ${C.cyan}55`,
                  borderRadius: 8,
                  color: C.cyan,
                  cursor: "pointer",
                  letterSpacing: "0.04em",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = `${C.cyan}18`;
                  e.currentTarget.style.borderColor = C.cyan;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = C.glassSurfTrans;
                  e.currentTarget.style.borderColor = `${C.cyan}55`;
                }}
              >{row.action.label} {"→"}</button>
            )}
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
