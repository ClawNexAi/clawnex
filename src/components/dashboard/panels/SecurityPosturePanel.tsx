"use client";

import { useState, useEffect, useCallback } from "react";
import type { TabId, FleetInstance, DashboardFilters } from '../types';
import { C, F } from '../constants';
import {
  Dot, Badge, Bar, Gauge, Card, CollapsibleCard, Stat, Table, LoadingSpinner, EmptyState,
  PanelStateBar, PanelEmptyState, PanelErrorState, PanelDisconnected,
  PaginationFooter,
  isStale, formatTimeAgo,
  type PanelDataState,
} from '../shared';
import { sevColor, stColor, timeAgo } from '../utils';
import { reconcilePosture } from '@/lib/dashboard/metric-semantics';
import { Tooltip } from '../tooltip';
import { INST, POSTURE_DEMO } from '../mock-data';
import { CveCard } from './CveCard';
import { MissionControlBreadcrumb } from './mission-control/MissionControlBreadcrumb';

// Posture scans older than 24h surface a staleness warning on the state bar.
const POSTURE_STALE_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Panel-specific types
// ---------------------------------------------------------------------------

interface CkCheck { checkId: string; name: string; status: string; severity: string; category: string; detail: string; remediation: string }
interface CkScanData {
  scan: { id: string; overallGrade: string; overallScore: number; totalChecks: number; passedChecks: number; failedChecks: number; warnedChecks?: number; skippedChecks?: number; checks: CkCheck[]; scannedAt: string } | null;
  hardening: { grade: string; score: number; categories: Array<{ name: string; items: Array<{ checkId: string; name: string; status: string; severity: string; tier: string; remediation: string }>; passCount: number; failCount: number; warnCount: number; score: number }>; tiers: { basic: unknown[]; standard: unknown[]; advanced: unknown[] } } | null;
  remediations?: Array<{ checkId: string; name: string; severity: string; category: string; suggestion: string }>;
  scanning?: boolean;
}

// ---------------------------------------------------------------------------
// SecurityPosturePanel
// ---------------------------------------------------------------------------

export function SecurityPosturePanel({ fleetApi, demoMode, onNavigate, filters, incomingFromMissionControl, onMissionControlBackConsumed }: { fleetApi: FleetInstance[] | null; demoMode: boolean; onNavigate: (tab: TabId) => void; filters: DashboardFilters; incomingFromMissionControl?: boolean; onMissionControlBackConsumed?: () => void }) {
  const [scanData, setScanData] = useState<CkScanData | null>(null);
  // v0.11.5+: rule-of-5 pagination — Hardening checks default 10/page, Remediations 5/page, Instances 5/page.
  const [checksPageSize, setChecksPageSize] = useState(10);
  const [checksPage, setChecksPage] = useState(0);
  const [remPageSize, setRemPageSize] = useState(5);
  const [remPage, setRemPage] = useState(0);
  const [instPageSize, setInstPageSize] = useState(5);
  const [instPage, setInstPage] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [showChecks, setShowChecks] = useState(false);
  // Lifecycle tracking for the state bar and the top-level state buckets.
  const [fetchState, setFetchState] = useState<PanelDataState>("loading");
  const [fetchError, setFetchError] = useState<Error | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);

  const fetchScan = useCallback(async () => {
    if (demoMode) {
      // Demo: substitute the seeded Clawkeeper scan (B+ / 87, 145 checks
      // with 12 failed) plus hardening category breakdown. Cross-refs the
      // posture narrative — fleet-level posture (61% Pinnacle AI) and
      // host-level hardening (B+) are intentionally distinct concepts
      // per Phase 3 posture-service taxonomy.
      setScanData(POSTURE_DEMO as unknown as CkScanData);
      setFetchError(null);
      setLastFetchedAt(new Date());
      setFetchState("ready");
      return;
    }
    setFetchState(prev => (prev === "ready" || prev === "stale" || prev === "refreshing" ? "refreshing" : "loading"));
    try {
      const res = await fetch("/api/security/scan");
      if (!res.ok) {
        setFetchError(new Error(`Scan endpoint returned ${res.status}`));
        setFetchState("error");
        return;
      }
      const data = await res.json();
      setScanData(data);
      setFetchError(null);
      setLastFetchedAt(new Date());
      // "ready" even when scan is null — that's the explicit "never scanned" case,
      // which is rendered as an empty-state bucket below, not as a loading/error.
      setFetchState("ready");
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setFetchError(e);
      // TypeError from fetch() = network failure / backend unreachable.
      setFetchState(e instanceof TypeError ? "disconnected" : "error");
    }
  }, [demoMode]);

  useEffect(() => { fetchScan(); const iv = setInterval(fetchScan, 30000); return () => clearInterval(iv); }, [fetchScan]);

  const triggerScan = useCallback(async () => {
    setScanning(true); setScanError(null);
    try {
      const res = await fetch("/api/security/scan", { method: "POST" });
      if (res.ok) { const data = await res.json(); setScanData(data); setLastFetchedAt(new Date()); setFetchState("ready"); setFetchError(null); }
      else if (res.status === 409) { setScanError("A scan is already running"); }
      else { const d = await res.json().catch(() => ({})); setScanError(d.detail || "Scan failed"); }
    } catch (err) { setScanError(err instanceof Error ? err.message : "Scan failed"); }
    finally { setScanning(false); }
  }, []);

  // Demo data fallback — preserve posture nullability so the panel can render
  // "—" for unscanned instances instead of inventing a fake score.
  type InstanceRow = { id: string; client: string; status: string; posture: number | null };
  const instances: InstanceRow[] = demoMode
    ? INST.map(i => ({ id: i.id, client: i.client, status: i.status, posture: i.posture }))
    : (fleetApi || []).map(f => ({ id: f.id, client: f.client, status: f.status, posture: f.posture == null ? null : f.posture }));

  const hasScan = scanData?.scan != null;
  const scan = scanData?.scan;
  const hardening = scanData?.hardening;
  // Real vs. placeholder posture. On a fresh install with no Clawkeeper scan AND
  // no real fleet posture data, we previously fell back to averaging the fleet
  // placeholder value (`posture: 100` from the threat-score null case) which made
  // the gauge read "100" while the category bullets showed hardcoded demo numbers
  // (88/72/65/91/80) — two unrelated fake signals that didn't tally. Ship bug 2026-04-11.
  //
  // Now: if there's no scan data AND no real hardening categories, we treat the
  // grade as "unscanned" and tell the operator to click Run Scan. No fake numbers.
  const hasRealHardening = Boolean(hardening && hardening.categories && hardening.categories.length > 0);
  // Average only over instances that actually have a posture score (not null).
  // If every fleet row is unscanned AND there's no hardening data, we show "unscanned".
  const scoredInstances = instances.filter(i => typeof i.posture === 'number') as Array<InstanceRow & { posture: number }>;
  const hasFleetScores = scoredInstances.length > 0;
  // Single shared reconciliation (metric-semantics.reconcilePosture) — the same
  // precedence the Fleet column + Readiness Banner observe, so the gauge can't
  // silently diverge. clawkeeper > fleet-estimate > unscanned.
  const reconciled = reconcilePosture({
    scanScore: scan ? scan.overallScore : null,
    hardeningScore: hasRealHardening ? (hardening!.score ?? null) : null,
    fleetPostures: scoredInstances.map(i => i.posture),
  });
  const noScanData = reconciled.source === 'unscanned';
  const overallScore = reconciled.score ?? 0;
  const overallGrade = scan ? scan.overallGrade : hasRealHardening ? (hardening!.grade || "N/A") : "N/A";

  // Staleness: if the most recent scan is >24h old, flip the state bar to "stale".
  const scanTimestamp = scan?.scannedAt || null;
  const stale = scanTimestamp ? isStale(scanTimestamp, POSTURE_STALE_MS) : false;
  const barState: PanelDataState = fetchState === "ready" && stale ? "stale" : fetchState;
  // Top-level state bucket rendered above the scan body. Suppress the global
  // empty/error/disconnected banners when demo mode is on — demo data is
  // explicit mock and shouldn't be masked by a "never scanned" card.
  const showEmptyBucket = !demoMode && noScanData && fetchState === "ready";
  const showErrorBucket = !demoMode && fetchState === "error";
  const showDisconnectedBucket = !demoMode && fetchState === "disconnected";
  const showLoadingBucket = !demoMode && fetchState === "loading" && !scanData;

  if (showDisconnectedBucket) {
    return (
      <div>
        <div style={{ marginBottom: 10 }}>
          <PanelStateBar state="disconnected" onRefresh={fetchScan} />
        </div>
        <PanelDisconnected onRetry={fetchScan} lastSeen={lastFetchedAt} />
      </div>
    );
  }

  if (showErrorBucket) {
    return (
      <div>
        <div style={{ marginBottom: 10 }}>
          <PanelStateBar state="error" onRefresh={fetchScan} errorMessage={fetchError?.message} />
        </div>
        <PanelErrorState
          title="Posture Scan Error"
          error={fetchError || "Security scan request failed"}
          onRetry={fetchScan}
          hint="The Clawkeeper scanner may not be installed yet. Open Configuration → Updates to install it."
        />
      </div>
    );
  }

  if (showEmptyBucket) {
    return (
      <div>
        <div style={{ marginBottom: 10 }}>
          <PanelStateBar state="empty" onRefresh={fetchScan} customLabel="No posture scan yet" />
        </div>
        <PanelEmptyState
          title="No posture scan yet"
          description="Clawkeeper checks file permissions, firewall rules, package versions, and vulnerable dependencies on this host. Run a scan to grade your security posture — nothing is assessed until you do."
          actionLabel={scanning ? "Running…" : "Run Posture Scan"}
          onAction={() => { if (!scanning) triggerScan(); }}
        />
        {/* Keep CVE card visible — it's independent and useful even pre-scan. */}
        <div style={{ marginTop: 16 }}>
          <CveCard onNavigate={onNavigate} demoMode={demoMode} />
        </div>
      </div>
    );
  }

  if (showLoadingBucket) {
    return (
      <div>
        <div style={{ marginBottom: 10 }}>
          <PanelStateBar state="loading" customLabel="Loading posture data..." />
        </div>
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div>
      {/* v0.12.0+: Mission Control return breadcrumb. */}
      <MissionControlBreadcrumb
        visible={!!incomingFromMissionControl}
        onClick={() => onMissionControlBackConsumed?.()}
      />
      {/* State bar — always at the top so operators see freshness + retry. */}
      <div style={{
        display: "flex", justifyContent: "flex-end", alignItems: "center",
        marginBottom: 10, gap: 10,
      }}>
        <PanelStateBar
          state={barState}
          lastUpdated={scanTimestamp || lastFetchedAt}
          onRefresh={fetchScan}
        />
      </div>
      {stale && scanTimestamp && (
        <div style={{
          marginBottom: 10, padding: "8px 12px",
          background: `${C.warn}38`, border: `1px solid ${C.warn}8c`, borderRadius: 6,
          fontSize: 12, color: C.txS,
        }}>
          <strong style={{ color: C.warn }}>Scan is {formatTimeAgo(scanTimestamp)}</strong> — posture data may be out of date. Run a fresh scan to recheck the host.
        </div>
      )}
      {filters.selectedInstance !== "all" && (
        <div style={{ fontSize: 12, color: C.txS, padding: "8px 12px", background: `${C.info}38`, border: `1px solid ${C.info}8c`, borderRadius: 6, marginBottom: 12 }}>
          <strong style={{ color: C.info }}>&#x2139;</strong> Security posture is assessed at the host level — Clawkeeper scans apply to the entire machine, not individual agent instances.
        </div>
      )}
      {/* Top stats bar */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Stat
          label="Grade"
          value={noScanData ? "—" : overallGrade}
          color={noScanData ? C.txT : overallScore > 80 ? C.green : overallScore > 60 ? C.warn : C.danger}
          small
        />
        <Stat
          label="Score"
          value={noScanData ? "—" : `${overallScore}%`}
          color={noScanData ? C.txT : overallScore > 80 ? C.green : overallScore > 60 ? C.warn : C.danger}
          small
        />
        {scan && <Stat label="Passed" value={scan.passedChecks} color={C.green} small />}
        {scan && <Stat label="Failed" value={scan.failedChecks} color={scan.failedChecks > 0 ? C.danger : C.green} small />}
        {scan && scan.warnedChecks != null && <Stat label="Warned" value={scan.warnedChecks} color={scan.warnedChecks > 0 ? C.warn : C.green} small />}
        {scan && <Stat label="Total Checks" value={scan.totalChecks} color={C.info} small />}
        {scan && <Stat label="Last Scan" value={timeAgo(scan.scannedAt)} color={C.txS} small />}
        <Stat label="Source" value={reconciled.source === 'clawkeeper' ? "Clawkeeper" : reconciled.source === 'unscanned' ? "Unscanned" : `Fleet est. (${reconciled.instanceCount})`} color={C.purp} small />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16 }}>
        {/* Left: Gauge + categories */}
        <div>
          <Card title="Security Grade" accent={C.brand}>
            <div style={{ display: "flex", justifyContent: "center", padding: "10px 0" }}>
              {noScanData ? (
                // No real posture data yet — show a neutral "unscanned" gauge with
                // a dash instead of a fake perfect score. Prevents the demo bug where
                // the gauge read 100 while the categories below showed amber.
                <Gauge value={0} label="Unscanned" color={C.txT} />
              ) : (
                <Gauge
                  value={overallScore}
                  label={overallGrade !== "N/A" ? `Grade: ${overallGrade}` : "AI Risk"}
                  color={overallScore > 80 ? C.green : overallScore > 60 ? C.warn : C.danger}
                />
              )}
            </div>

            {/* Category breakdown from hardening */}
            {hasRealHardening ? (
              <div style={{ marginTop: 10 }}>
                {hardening!.categories.map(cat => (
                  <div key={cat.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
                    <Dot color={cat.score > 80 ? C.green : cat.score > 50 ? C.warn : C.danger} glow />
                    <span style={{ fontSize: 13, color: C.txS, flex: 1 }}>{cat.name}</span>
                    <span style={{ fontSize: 11, fontFamily: F.mono, color: C.txT }}>{cat.passCount}P/{cat.failCount}F/{cat.warnCount}W</span>
                    <span style={{ fontSize: 13, fontFamily: F.mono, color: C.tx }}>{cat.score}%</span>
                  </div>
                ))}
              </div>
            ) : (
              // Empty state: honest "no scan yet" message instead of hardcoded demo values.
              // Clicking Run Scan (below) populates real Clawkeeper categories.
              <div style={{
                marginTop: 12, padding: "14px 12px",
                background: C.glassSurfTrans, border: `1px dashed ${C.glassBorderCyan}`, borderRadius: 6,
                textAlign: "center",
              }}>
                <div style={{ fontSize: 12, color: C.txS, lineHeight: 1.6 }}>
                  No security scan yet on this instance.
                </div>
                <div style={{ fontSize: 11, color: C.txT, marginTop: 4, lineHeight: 1.5 }}>
                  Click <strong>Run Scan</strong> below to grade this host across prompt safety,
                  agent control, network security, data protection, and compliance via Clawkeeper.
                </div>
              </div>
            )}

            {/* Run Scan button */}
            <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
              <Tooltip placement="top" variant="detail" content={<span>Run a fresh <strong>Clawkeeper</strong> security audit against this host. Grades you A&ndash;F across prerequisites, installation, host hardening, network, and security audit categories. Typical run: ~30s. Result is persisted and feeds the Fleet Command grade tile too.</span>}>
                <button onClick={triggerScan} disabled={scanning} style={{
                  padding: "8px 16px", borderRadius: 6, fontSize: 13, fontFamily: F.mono, cursor: scanning ? "wait" : "pointer",
                  background: scanning ? C.glassSurfTrans : `linear-gradient(135deg, ${C.cyan} 0%, ${C.green} 100%)`,
                  border: `1px solid ${scanning ? C.glassBorderSubtle : "transparent"}`,
                  color: scanning ? C.txT : "#04070e", fontWeight: 700, opacity: scanning ? 0.6 : 1,
                }}>
                  {scanning ? "Scanning..." : "Run Scan"}
                </button>
              </Tooltip>
              {scanError && <span style={{ fontSize: 12, color: C.danger, alignSelf: "center" }}>{scanError}</span>}
            </div>
          </Card>
        </div>

        {/* Right: Checks table + hardening tiers */}
        <div>
          {/* Scan checks detail */}
          {hasScan && scan && scan.checks.length > 0 && (
            <Card title={`Clawkeeper Checks (${scan.checks.length})`} accent={C.cyan} actions={
              <Tooltip placement="left" variant="compact" content="Toggle the per-check breakdown table. Collapsed shows just pass/fail/warn counts.">
                <button onClick={() => setShowChecks(p => !p)} style={{ background: "none", border: "none", color: C.brand, cursor: "pointer", fontSize: 12, fontFamily: F.mono }}>
                  {showChecks ? "Collapse" : "Expand"}
                </button>
              </Tooltip>
            }>
              {showChecks ? (() => {
                const checksTotalPages = Math.max(1, Math.ceil(scan.checks.length / checksPageSize));
                const safe = Math.min(checksPage, checksTotalPages - 1);
                const pagedChecks = scan.checks.slice(safe * checksPageSize, (safe + 1) * checksPageSize);
                return (<>
                  <Table
                    headers={["ID", "Check", "Status", "Severity", "Category"]}
                    rows={pagedChecks.map((c, i) => [
                      <span key={`id-${i}`} style={{ fontFamily: F.mono, fontSize: 11, whiteSpace: "nowrap" }}>{c.checkId}</span>,
                      <span key={`n-${i}`} style={{ fontSize: 12, minWidth: 180 }}>{c.name}</span>,
                      <Badge key={`s-${i}`} label={c.status} color={stColor(c.status)} />,
                      <span key={`sv-${i}`} style={{ whiteSpace: "nowrap" }}><Badge label={c.severity} color={sevColor(c.severity)} /></span>,
                      <span key={`c-${i}`} style={{ fontSize: 11, color: C.txS, whiteSpace: "nowrap" }}>{c.category}</span>,
                    ])}
                  />
                  {checksTotalPages > 1 && (
                    <PaginationFooter
                      currentPage={safe}
                      totalPages={checksTotalPages}
                      pageSize={checksPageSize}
                      totalRows={scan.checks.length}
                      onPageSizeChange={(n) => { setChecksPageSize(n); setChecksPage(0); }}
                      onPageChange={setChecksPage}
                    />
                  )}
                </>);
              })() : (
                <div style={{ display: "flex", gap: 12, padding: "8px 0" }}>
                  <span style={{ fontSize: 13, color: C.green }}>{scan.passedChecks} PASS</span>
                  <span style={{ fontSize: 13, color: C.danger }}>{scan.failedChecks} FAIL</span>
                  {scan.warnedChecks != null && <span style={{ fontSize: 13, color: C.warn }}>{scan.warnedChecks} WARN</span>}
                  <span style={{ fontSize: 12, color: C.txT, marginLeft: "auto" }}>Click Expand to see all checks</span>
                </div>
              )}
            </Card>
          )}

          {/* Hardening tiers */}
          {hardening && (
            <CollapsibleCard title="Hardening Report" accent={C.purp} defaultOpen={false}>
              {(["basic", "standard", "advanced"] as const).map(tier => {
                const tierItems = hardening.tiers[tier] as Array<{ checkId: string; name: string; status: string; severity: string; remediation: string }>;
                if (!tierItems || tierItems.length === 0) return null;
                const passed = tierItems.filter(i => i.status === "PASS").length;
                return (
                  <div key={tier} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <Badge label={tier.toUpperCase()} color={tier === "basic" ? C.danger : tier === "standard" ? C.warn : C.info} />
                      <span style={{ fontSize: 12, color: C.txT }}>{passed}/{tierItems.length} passed</span>
                      <div style={{ flex: 1 }}><Bar value={passed} max={tierItems.length} color={passed === tierItems.length ? C.green : C.warn} /></div>
                    </div>
                    {tierItems.filter(i => i.status !== "PASS").slice(0, 5).map((item, j) => (
                      <div key={j} style={{ fontSize: 12, color: C.txS, padding: "3px 0 3px 16px", borderLeft: `2px solid ${sevColor(item.severity)}44` }}>
                        <span style={{ fontFamily: F.mono, color: C.txT }}>{item.checkId}</span> {item.name}
                        {item.remediation && <span style={{ color: C.txT, fontSize: 11 }}> - {item.remediation}</span>}
                      </div>
                    ))}
                  </div>
                );
              })}
            </CollapsibleCard>
          )}

          {/* Remediation suggestions */}
          {scanData?.remediations && scanData.remediations.length > 0 && (() => {
            const rems = scanData.remediations;
            const totalPages = Math.max(1, Math.ceil(rems.length / remPageSize));
            const safe = Math.min(remPage, totalPages - 1);
            const paged = rems.slice(safe * remPageSize, (safe + 1) * remPageSize);
            return (
              <CollapsibleCard title="Remediation Suggestions" accent={C.orange} count={rems.length} defaultOpen={false}>
                {paged.map((r, i) => (
                  <div key={i} style={{ padding: "6px 0", borderBottom: `1px solid ${C.glassBorderSubtle}`, display: "flex", gap: 8, alignItems: "baseline" }}>
                    <Badge label={r.severity} color={sevColor(r.severity)} />
                    <span style={{ fontSize: 12, fontFamily: F.mono, color: C.txT }}>{r.checkId}</span>
                    <span style={{ fontSize: 12, color: C.txS, flex: 1 }}>{r.suggestion}</span>
                  </div>
                ))}
                {totalPages > 1 && (
                  <PaginationFooter
                    currentPage={safe}
                    totalPages={totalPages}
                    pageSize={remPageSize}
                    totalRows={rems.length}
                    onPageSizeChange={(n) => { setRemPageSize(n); setRemPage(0); }}
                    onPageChange={setRemPage}
                  />
                )}
              </CollapsibleCard>
            );
          })()}

          {/* Fleet posture fallback */}
          {!hasScan && instances.length > 0 && (() => {
            const totalPages = Math.max(1, Math.ceil(instances.length / instPageSize));
            const safe = Math.min(instPage, totalPages - 1);
            const pagedInstances = instances.slice(safe * instPageSize, (safe + 1) * instPageSize);
            return (
              <Card title="Posture by Instance" accent={C.cyan}>
                <Table
                  headers={["Instance", "Posture", "Status", "Bar"]}
                  rows={pagedInstances.map(f => {
                    const hasScore = typeof f.posture === 'number';
                    const score = hasScore ? (f.posture as number) : 0;
                    const color = !hasScore ? C.txT : score > 90 ? C.green : score > 75 ? C.warn : C.danger;
                    return [
                      <span key="c" style={{ fontWeight: 600 }}>{f.client}</span>,
                      <span key="p" style={{ color, fontWeight: 700 }}>{hasScore ? `${score}%` : "—"}</span>,
                      <Badge key="s" label={f.status} color={stColor(f.status)} />,
                      <div key="b" style={{ width: 120 }}>
                        {hasScore
                          ? <Bar value={score} max={100} color={color} />
                          : <span style={{ fontSize: 10, color: C.txT, fontFamily: F.mono }}>unscanned</span>}
                      </div>,
                    ];
                  })}
                />
                {totalPages > 1 && (
                  <PaginationFooter
                    currentPage={safe}
                    totalPages={totalPages}
                    pageSize={instPageSize}
                    totalRows={instances.length}
                    onPageSizeChange={(n) => { setInstPageSize(n); setInstPage(0); }}
                    onPageChange={setInstPage}
                  />
                )}
              </Card>
            );
          })()}

          {!hasScan && instances.length === 0 && (
            <EmptyState message="No scan data available. Click 'Run Scan' to perform a Clawkeeper security scan." />
          )}
        </div>
      </div>

      {/* CVE Database */}
      <CveCard onNavigate={onNavigate} demoMode={demoMode} />
    </div>
  );
}
