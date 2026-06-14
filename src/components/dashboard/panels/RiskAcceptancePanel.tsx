// Risk Acceptance Management Panel — central inventory of every operator-
// accepted risk across all four consuming surfaces. Three sections:
//
//   1. Active acceptances — table of every active risk acceptance with
//      revoke shortcut.
//   2. Expiring soon — banner-style for acceptances expiring within 14d.
//   3. Recently revoked / expired — last 30 days, audit reference.
//
// Filters: source_panel, status, search (matches rule_id + reason).
//
// Spec: docs/superpowers/specs/2026-04-23-risk-acceptance-design.md §8

"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { C, F } from "../constants";
import { Card, EmptyState, Badge, PaginationFooter } from "../shared";
import { Tooltip } from "../tooltip";
import type { TabId } from "../types";
// v0.8.3+: PanelFilters + URL state replaces the hand-rolled panel-filter
// dropdown + search input. URL hash carries multi-select scope (source_panel)
// + q (freeform search). Refresh / back-button preserve the filtered view.
import { PanelFilters } from "../PanelFilters";
import { useHashState } from "../url-state";
import { RISK_ACCEPTANCES_DEMO } from "../mock-data";

interface RiskAcceptance {
  id: string;
  finding_signature: string;
  scope_level: "finding" | "agent_rule" | "rule_global";
  source_panel: "trust_audit" | "blast_radius_combo" | "blast_radius_lint" | "correlations" | "alerts";
  rule_id: string;
  agent_id: string | null;
  surface_id: string | null;
  evidence_snapshot: string;
  accepted_by: string;
  accepted_at: string;
  reason: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
}

const PANEL_LABELS: Record<RiskAcceptance["source_panel"], string> = {
  trust_audit: "Trust Audit",
  blast_radius_combo: "Blast Radius (combo)",
  blast_radius_lint: "Blast Radius (lint)",
  correlations: "Correlations",
  alerts: "Alerts",
};

const PANEL_TAB: Record<RiskAcceptance["source_panel"], TabId> = {
  trust_audit: "trustAudit",
  blast_radius_combo: "blastRadius",
  blast_radius_lint: "blastRadius",
  correlations: "correlations",
  alerts: "alertsIncidents",
};

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function formatDateShort(iso: string): string {
  return iso.slice(0, 10);
}

export function RiskAcceptancePanel({ onNavigate, demoMode }: { onNavigate: (tab: TabId) => void; demoMode?: boolean }) {
  const [active, setActive] = useState<RiskAcceptance[] | null>(null);
  const [expired, setExpired] = useState<RiskAcceptance[] | null>(null);
  const [revoked, setRevoked] = useState<RiskAcceptance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // v0.8.3+: panel + search filters live in URL hash. scope URL key carries
  // the source_panel selection (multi-select; previously single-select). q
  // is freeform search across rule_id + reason text.
  const [urlState, updateUrl] = useHashState();
  const panelSel = urlState.scope ?? [];
  const search = urlState.q ?? "";

  const fetchAll = useCallback(async () => {
    setError(null);
    if (demoMode) {
      setActive(RISK_ACCEPTANCES_DEMO.active as unknown as RiskAcceptance[]);
      setExpired(RISK_ACCEPTANCES_DEMO.expired as unknown as RiskAcceptance[]);
      setRevoked(RISK_ACCEPTANCES_DEMO.revoked as unknown as RiskAcceptance[]);
      return;
    }
    try {
      const [aRes, eRes, rRes] = await Promise.all([
        fetch("/api/risk-acceptances?status=active"),
        fetch("/api/risk-acceptances?status=expired"),
        fetch("/api/risk-acceptances?status=revoked"),
      ]);
      if (!aRes.ok) throw new Error(`active list HTTP ${aRes.status}`);
      const a = await aRes.json();
      const e = eRes.ok ? await eRes.json() : { acceptances: [] };
      const r = rRes.ok ? await rRes.json() : { acceptances: [] };
      setActive(a.acceptances ?? []);
      setExpired(e.acceptances ?? []);
      setRevoked(r.acceptances ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [demoMode]);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, 30_000);
    return () => clearInterval(t);
  }, [fetchAll]);

  const revoke = useCallback(async (id: string, label: string) => {
    const reason = prompt(`Revoke this acceptance?\n\n"${label}"\n\nEnter a short revoke reason (recorded in audit log):`);
    if (!reason || reason.trim().length === 0) return;
    try {
      const res = await fetch(`/api/risk-acceptances/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchAll();
    } catch (err) {
      alert(`Revoke failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [fetchAll]);

  const filterFn = useCallback((a: RiskAcceptance): boolean => {
    if (panelSel.length > 0 && !panelSel.includes(a.source_panel)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!a.rule_id.toLowerCase().includes(q) && !a.reason.toLowerCase().includes(q)) return false;
    }
    return true;
  }, [panelSel, search]);

  const filteredActive = useMemo(() => (active ?? []).filter(filterFn), [active, filterFn]);
  const expiringSoon = useMemo(() => filteredActive.filter((a) => daysUntil(a.expires_at) <= 14), [filteredActive]);

  // v0.11.5+: pagination state per table — operator directive 2026-05-05.
  // Default 5/page; footer hidden when totalPages<=1. Each table gets its
  // own state so an operator paging through Active doesn't reset Resolved.
  const [activePageSize, setActivePageSize] = useState(5);
  const [activePage, setActivePage] = useState(0);
  const [expiringPageSize, setExpiringPageSize] = useState(5);
  const [expiringPage, setExpiringPage] = useState(0);
  const [resolvedPageSize, setResolvedPageSize] = useState(5);
  const [resolvedPage, setResolvedPage] = useState(0);

  const recentlyResolved = useMemo(
    () => [...(expired ?? []), ...(revoked ?? [])]
      .filter(filterFn)
      .filter((a) => {
        const closedAt = a.revoked_at ?? a.expires_at;
        return Date.now() - new Date(closedAt).getTime() < 30 * 24 * 60 * 60 * 1000;
      })
      .sort((a, b) => (b.revoked_at ?? b.expires_at).localeCompare(a.revoked_at ?? a.expires_at))
      .slice(0, 50),
    [expired, revoked, filterFn],
  );

  // v0.11.5+: derive paged slices + total-page counts. Reset to page 0
  // whenever the underlying data shape changes (filter or page-size flip).
  const activeTotalPages = Math.max(1, Math.ceil(filteredActive.length / activePageSize));
  const pagedActive = filteredActive.slice(activePage * activePageSize, (activePage + 1) * activePageSize);
  const expiringTotalPages = Math.max(1, Math.ceil(expiringSoon.length / expiringPageSize));
  const pagedExpiring = expiringSoon.slice(expiringPage * expiringPageSize, (expiringPage + 1) * expiringPageSize);
  const resolvedTotalPages = Math.max(1, Math.ceil(recentlyResolved.length / resolvedPageSize));
  const pagedResolved = recentlyResolved.slice(resolvedPage * resolvedPageSize, (resolvedPage + 1) * resolvedPageSize);
  useEffect(() => { setActivePage(0); }, [panelSel, search, activePageSize]);
  useEffect(() => { setExpiringPage(0); }, [panelSel, search, expiringPageSize]);
  useEffect(() => { setResolvedPage(0); }, [panelSel, search, resolvedPageSize]);

  if (error) {
    return (
      <div style={{
      position: "relative",
      background: C.glassChrome,
      backdropFilter: "blur(18px)",
      WebkitBackdropFilter: "blur(18px)",
      border: `1px solid ${C.glassBorderSubtle}`,
      borderRadius: 14,
      boxShadow: C.glassShadow,
      padding: 16,
    }}>
        <h2 style={{ color: C.tx, fontSize: 18, marginBottom: 12 }}>Risk Acceptances</h2>
        <Card title="" accent={C.danger}>
          <div style={{ padding: 12, color: C.danger }}>Failed to load acceptances: {error}</div>
        </Card>
      </div>
    );
  }

  if (active === null) {
    return (
      <div>
        <h2 style={{ color: C.tx, fontSize: 18, marginBottom: 12 }}>Risk Acceptances</h2>
        <Card title="" accent={C.brand}>
          <div style={{ padding: 12, color: C.txT }}>Loading…</div>
        </Card>
      </div>
    );
  }

  // Source-panel options for the scope multi-select. PANEL_LABELS maps the
  // canonical id to the human-friendly label that PanelFilters renders in
  // the dropdown options.
  const panelOptions: RiskAcceptance["source_panel"][] = ["trust_audit", "blast_radius_combo", "blast_radius_lint", "correlations", "alerts"];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ color: C.tx, fontSize: 18, margin: 0 }}>Risk Acceptances</h2>
        <div style={{ fontSize: 11, color: C.txT, fontFamily: F.mono }}>
          {(active ?? []).length} active · {expiringSoon.length} expiring ≤14d · {recentlyResolved.length} closed in last 30d
        </div>
      </div>

      <div style={{ fontSize: 12, color: C.txS, marginBottom: 12, lineHeight: 1.5 }}>
        Operator-explicit, time-bound, audit-trailed suppression of findings across Trust Audit, Blast Radius,
        Correlations, and Alerts. Acceptances expire automatically (90d default; 30d for Correlations) and
        write to the <span style={{ fontFamily: F.mono, color: C.cyan }}>audit_log</span> on every create / revoke /
        expire / evidence-change. Revoking an acceptance brings the suppressed finding back into the active aggregate
        immediately.
      </div>

      {/* v0.8.3: shared PanelFilters widget. URL state powers scope (panel
          source — multi-select via the scope URL key) + q (freeform search
          across rule_id and reason). Refresh button kept beside since it's
          a fetch-time action, not a filter dimension. */}
      <PanelFilters
        config={{
          search: { placeholder: "Search rule or reason…" },
          scope: panelOptions,
        }}
        values={urlState}
        onChange={(patch) => updateUrl(patch)}
        resultCount={filteredActive.length}
        totalCount={(active ?? []).length}
      />
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={fetchAll}
          style={{
            fontSize: 11, padding: "3px 10px", background: "transparent", border: `1px solid ${C.cyan}`,
            borderRadius: 3, color: C.cyan, fontFamily: F.sans, cursor: "pointer", fontWeight: 600,
          }}
        >
          Refresh
        </button>
      </div>

      {/* Section 1: Expiring soon (banner-style) */}
      {expiringSoon.length > 0 && (
        <Card title="" accent={C.warn}>
          <div style={{ padding: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.warn, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Expiring within 14 days ({expiringSoon.length})
            </div>
            <div style={{ fontSize: 11, color: C.txS, marginBottom: 10, lineHeight: 1.5 }}>
              These acceptances will auto-expire and the suppressed findings will pop back into the active aggregate. Revoke + re-accept to extend, or let them expire and re-evaluate after the next scan.
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: F.mono }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.glassBorderSubtle}` }}>
                  <th style={{ padding: "5px 8px", textAlign: "left", color: C.txT, fontSize: 11, letterSpacing: "0.04em" }}>Days left</th>
                  <th style={{ padding: "5px 8px", textAlign: "left", color: C.txT, fontSize: 11, letterSpacing: "0.04em" }}>Panel</th>
                  <th style={{ padding: "5px 8px", textAlign: "left", color: C.txT, fontSize: 11, letterSpacing: "0.04em" }}>Rule</th>
                  <th style={{ padding: "5px 8px", textAlign: "left", color: C.txT, fontSize: 11, letterSpacing: "0.04em" }}>Reason</th>
                  <th style={{ padding: "5px 8px", textAlign: "left", color: C.txT, fontSize: 11, letterSpacing: "0.04em" }}></th>
                </tr>
              </thead>
              <tbody>
                {pagedExpiring.map((a) => (
                  <tr key={a.id} style={{ borderBottom: `1px solid ${C.glassBorderSubtle}` }}>
                    <td style={{ padding: "6px 8px", color: C.warn, fontWeight: 700 }}>{daysUntil(a.expires_at)}d</td>
                    <td style={{ padding: "6px 8px", color: C.txS }}>{PANEL_LABELS[a.source_panel]}</td>
                    <td style={{ padding: "6px 8px", color: C.tx }}>{a.rule_id}{a.agent_id ? ` · ${a.agent_id}` : ""}</td>
                    <td style={{ padding: "6px 8px", color: C.txS, fontStyle: "italic" }}>{a.reason}</td>
                    <td style={{ padding: "6px 8px" }}>
                      <Tooltip placement="left" variant="detail" content={<span><strong>End the acceptance now</strong> — the suppressed finding pops back into the active aggregate immediately. Use when you&apos;ve actually fixed the underlying issue, or when you realize the acceptance was a mistake. Always logged to audit.</span>}>
                        <button
                          onClick={() => revoke(a.id, `${a.rule_id}${a.agent_id ? ` · ${a.agent_id}` : ""}`)}
                          style={{ padding: "2px 8px", background: "transparent", border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 3, color: C.warn, fontSize: 10, fontWeight: 700, cursor: "pointer" }}
                        >
                          Revoke
                        </button>
                      </Tooltip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {expiringTotalPages > 1 && (
              <PaginationFooter
                currentPage={expiringPage}
                totalPages={expiringTotalPages}
                pageSize={expiringPageSize}
                totalRows={expiringSoon.length}
                onPageSizeChange={setExpiringPageSize}
                onPageChange={setExpiringPage}
              />
            )}
          </div>
        </Card>
      )}

      {/* Section 2: Active acceptances */}
      <div style={{ marginTop: 14 }}>
        <Card title={`Active acceptances (${filteredActive.length})`} accent={C.brand}>
          {filteredActive.length === 0 ? (
            <EmptyState message="No active acceptances. Findings on consuming panels (Trust Audit / Blast Radius / Correlations / Alerts) get an Accept Risk / Snooze / Suppress button — accepted ones land here." />
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: F.mono }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.glassBorderSubtle}` }}>
                  <th style={{ padding: "6px 8px", textAlign: "left", color: C.txT, fontSize: 11, letterSpacing: "0.04em" }}>Panel</th>
                  <th style={{ padding: "6px 8px", textAlign: "left", color: C.txT, fontSize: 11, letterSpacing: "0.04em" }}>Scope</th>
                  <th style={{ padding: "6px 8px", textAlign: "left", color: C.txT, fontSize: 11, letterSpacing: "0.04em" }}>Rule / Agent / Surface</th>
                  <th style={{ padding: "6px 8px", textAlign: "left", color: C.txT, fontSize: 11, letterSpacing: "0.04em" }}>Reason</th>
                  <th style={{ padding: "6px 8px", textAlign: "left", color: C.txT, fontSize: 11, letterSpacing: "0.04em" }}>Accepted by</th>
                  <th style={{ padding: "6px 8px", textAlign: "left", color: C.txT, fontSize: 11, letterSpacing: "0.04em" }}>Accepted at</th>
                  <th style={{ padding: "6px 8px", textAlign: "left", color: C.txT, fontSize: 11, letterSpacing: "0.04em" }}>Expires</th>
                  <th style={{ padding: "6px 8px", textAlign: "left", color: C.txT, fontSize: 11, letterSpacing: "0.04em" }}></th>
                </tr>
              </thead>
              <tbody>
                {pagedActive.map((a) => {
                  const days = daysUntil(a.expires_at);
                  return (
                    <tr key={a.id} style={{ borderBottom: `1px solid ${C.glassBorderSubtle}` }}>
                      <td style={{ padding: "6px 8px" }}>
                        <button
                          onClick={() => onNavigate(PANEL_TAB[a.source_panel])}
                          title="Jump to source panel"
                          style={{ background: "transparent", border: 0, color: C.cyan, fontSize: 11, fontFamily: F.mono, cursor: "pointer", padding: 0, fontWeight: 600, textDecoration: "underline" }}
                        >
                          {PANEL_LABELS[a.source_panel]}
                        </button>
                      </td>
                      <td style={{ padding: "6px 8px" }}>
                        <Badge label={a.scope_level.replace(/_/g, " ")} color={a.scope_level === "rule_global" ? C.warn : a.scope_level === "agent_rule" ? C.info : C.txS} />
                      </td>
                      <td style={{ padding: "6px 8px", color: C.tx }}>
                        {a.rule_id}
                        {a.agent_id && <span style={{ color: C.txT }}> · {a.agent_id}</span>}
                        {a.surface_id && <span style={{ color: C.txT }}> · {a.surface_id}</span>}
                      </td>
                      <td style={{ padding: "6px 8px", color: C.txS, fontStyle: "italic", maxWidth: 280 }}>{a.reason}</td>
                      <td style={{ padding: "6px 8px", color: C.txT }}>{a.accepted_by}</td>
                      <td style={{ padding: "6px 8px", color: C.txT }}>{formatDateShort(a.accepted_at)}</td>
                      <td style={{ padding: "6px 8px", color: days <= 14 ? C.warn : C.txS }}>
                        {formatDateShort(a.expires_at)} <span style={{ color: C.txT }}>({days}d)</span>
                      </td>
                      <td style={{ padding: "6px 8px" }}>
                        <button
                          onClick={() => revoke(a.id, `${a.rule_id}${a.agent_id ? ` · ${a.agent_id}` : ""}`)}
                          style={{ padding: "2px 8px", background: "transparent", border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 3, color: C.warn, fontSize: 10, fontWeight: 700, cursor: "pointer" }}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {filteredActive.length > 0 && activeTotalPages > 1 && (
            <PaginationFooter
              currentPage={activePage}
              totalPages={activeTotalPages}
              pageSize={activePageSize}
              totalRows={filteredActive.length}
              onPageSizeChange={setActivePageSize}
              onPageChange={setActivePage}
            />
          )}
        </Card>
      </div>

      {/* Section 3: Recently resolved (revoked + expired, last 30d) */}
      {recentlyResolved.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Card title={`Recently revoked / expired (last 30 days, ${recentlyResolved.length})`} accent={C.txT}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: F.mono }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.glassBorderSubtle}` }}>
                  <th style={{ padding: "5px 8px", textAlign: "left", color: C.txT, fontSize: 11, letterSpacing: "0.04em" }}>Closed at</th>
                  <th style={{ padding: "5px 8px", textAlign: "left", color: C.txT, fontSize: 11, letterSpacing: "0.04em" }}>Panel</th>
                  <th style={{ padding: "5px 8px", textAlign: "left", color: C.txT, fontSize: 11, letterSpacing: "0.04em" }}>Rule</th>
                  <th style={{ padding: "5px 8px", textAlign: "left", color: C.txT, fontSize: 11, letterSpacing: "0.04em" }}>Reason</th>
                  <th style={{ padding: "5px 8px", textAlign: "left", color: C.txT, fontSize: 11, letterSpacing: "0.04em" }}>How / by</th>
                </tr>
              </thead>
              <tbody>
                {pagedResolved.map((a) => (
                  <tr key={a.id} style={{ borderBottom: `1px solid ${C.glassBorderSubtle}` }}>
                    <td style={{ padding: "5px 8px", color: C.txT }}>{formatDateShort(a.revoked_at ?? a.expires_at)}</td>
                    <td style={{ padding: "5px 8px", color: C.txT }}>{PANEL_LABELS[a.source_panel]}</td>
                    <td style={{ padding: "5px 8px", color: C.txS }}>{a.rule_id}{a.agent_id ? ` · ${a.agent_id}` : ""}</td>
                    <td style={{ padding: "5px 8px", color: C.txT, fontStyle: "italic", maxWidth: 280 }}>{a.reason}</td>
                    <td style={{ padding: "5px 8px", color: C.txT }}>{a.revoke_reason ?? "expired"}{a.revoked_by && a.revoked_by !== "system" ? ` · ${a.revoked_by}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {resolvedTotalPages > 1 && (
              <PaginationFooter
                currentPage={resolvedPage}
                totalPages={resolvedTotalPages}
                pageSize={resolvedPageSize}
                totalRows={recentlyResolved.length}
                onPageSizeChange={setResolvedPageSize}
                onPageChange={setResolvedPage}
              />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
