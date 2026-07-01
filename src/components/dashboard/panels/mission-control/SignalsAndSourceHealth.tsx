"use client";

/**
 * SignalsAndSourceHealth — Combined panel: Cost Signals + Source Health.
 *
 * Spec §8.3: Two mini-cards inside one panel frame, side-by-side (2-col grid).
 * Each mini-card consumes its own data hook and renders independently — if the
 * cost source goes stale while collector health is live, the right card stays
 * green and vice versa.
 *
 * §8.3a Cost Signals (left):
 *   - Per-source rows: thin bar + USD + status dot
 *   - Drain signal chips: loop_risk × N etc. (aggregated by kind)
 *   - Required-copy footer per spec §16.1 (verbatim, do not alter)
 *   - Click → tokenCost tab with source filter
 *
 * §8.3b Source Health (right):
 *   - Per-collector rows: status dot + name + last-seen lag
 *   - Click → infrastructure tab (focus intent — see inline comment)
 */

import type { ReactNode } from "react";
import { C, F } from "../../constants";
import { useCollectorHealth, useCostRisk } from "./data-hooks";
import type { TabId } from "../../types";
import type { NavigateOpts } from "../../url-state";
import type { TimeRange } from "./types";
import { COLLECTOR_HEALTH_FIXTURE_DEMO, COST_RISK_DEMO } from "./demo-fixtures";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

interface Props {
  demoMode: boolean;
  range: TimeRange;
  onNavigate: (tab: TabId, focusOrOpts?: NavigateOpts) => void;
}

// ---------------------------------------------------------------------------
// Root panel
// ---------------------------------------------------------------------------

export function SignalsAndSourceHealth({ demoMode, range, onNavigate }: Props) {
  const cost = useCostRisk(range);
  const collector = useCollectorHealth();

  // B4: when demoMode is on, override both mini-card payloads with deterministic
  // demo fixtures so operators see populated bars + status dots instead of the
  // empty "no cost rows / no collectors" surface that the live route returns on
  // a fresh demo machine. Hooks still fire (Rules of Hooks) — their results
  // are simply replaced before being handed to the mini-card components.
  const noop = () => undefined;
  const costForRender: ReturnType<typeof useCostRisk> = demoMode
    ? { state: "live", data: COST_RISK_DEMO, lastRefreshedAt: Date.now(), refresh: noop }
    : cost;
  const collectorForRender: ReturnType<typeof useCollectorHealth> = demoMode
    ? { state: "live", data: COLLECTOR_HEALTH_FIXTURE_DEMO, lastRefreshedAt: Date.now(), refresh: noop }
    : collector;

  return (
    <div className="mc-panel-surface mc-signals-source-health" style={{
      background: C.glassChrome,
      backdropFilter: "blur(18px)",
      WebkitBackdropFilter: "blur(18px)",
      border: `1px solid ${C.glassBorderSubtle}`,
      borderRadius: 18,
      boxShadow: C.glassShadow,
      padding: 16,
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Left: Cost Signals — §8.3a */}
        <CostSignalsCard cost={costForRender} onNavigate={onNavigate} />
        {/* Right: Source Health — §8.3b */}
        <SourceHealthCard collector={collectorForRender} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cost Signals mini-card (§8.3a)
// ---------------------------------------------------------------------------

function CostSignalsCard({
  cost,
  onNavigate,
}: {
  cost: ReturnType<typeof useCostRisk>;
  onNavigate: Props["onNavigate"];
}) {
  const headerLabel = "Cost Signals";

  if (cost.state === "loading" && !cost.data) {
    return (
      <MiniCard title={headerLabel}>
        <div style={{ color: C.txT, fontSize: 11, fontFamily: F.mono }}>Loading…</div>
      </MiniCard>
    );
  }
  if (cost.state === "error" && !cost.data) {
    return (
      <MiniCard title={headerLabel}>
        <div style={{ color: C.danger, fontSize: 11, fontFamily: F.mono }}>Cost source unavailable</div>
      </MiniCard>
    );
  }

  const d = cost.data!;
  // Normalise the bar widths against the largest single-source USD amount,
  // with a floor of 0.01 so we never divide by zero on an empty window.
  const maxUsd = Math.max(0.01, ...d.perSource.map((s) => s.usd));

  return (
    <MiniCard title={headerLabel} stale={cost.state === "stale"} lastRefreshedAt={cost.lastRefreshedAt}>
      {/* Per-source rows */}
      {d.perSource.length === 0 && (
        <div style={{ color: C.txT, fontSize: 11, fontFamily: F.mono, padding: "6px 0" }}>
          No cost rows in window.
        </div>
      )}

      {d.perSource.map((s) => (
        <div
          key={s.source}
          className="mc-row-clickable"
          onClick={() => onNavigate("tokenCost", { filter: { source: [s.source] }, fromMissionControl: true })}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              // UrlState.source is a string[] CSV field (url-state.ts §CSV_KEYS) —
              // the tokenCost panel reads it to pre-filter the table to this source.
              onNavigate("tokenCost", { filter: { source: [s.source] }, fromMissionControl: true });
            }
          }}
          style={{
            display: "grid",
            gridTemplateColumns: "80px 1fr 60px 16px",
            gap: 8,
            alignItems: "center",
            padding: "5px 6px",
            marginBottom: 3,
            cursor: "pointer",
            fontFamily: F.mono,
            fontSize: 10,
            borderTop: `1px solid ${C.glassBorderSubtle}`,
          }}
        >
          {/* Source label */}
          <span style={{ color: C.txS, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {s.source}
          </span>
          {/* Thin proportional bar */}
          <span style={{ height: 4, background: C.glassTrack, borderRadius: 2, display: "block" }}>
            <span
              style={{
                display: "block",
                width: `${(s.usd / maxUsd) * 100}%`,
                height: "100%",
                background: `linear-gradient(90deg, ${C.cyan}, ${C.glassGreen})`,
                borderRadius: 2,
              }}
            />
          </span>
          {/* USD amount */}
          <span style={{ color: C.cyan, textAlign: "right", fontWeight: 700 }}>
            ${s.usd.toFixed(2)}
          </span>
          {/* Status dot — always green while row is present in live/stale data; glow signature */}
          <span style={{ color: C.green, textAlign: "center", textShadow: `0 0 15px ${C.green}` }}>●</span>
        </div>
      ))}

      {/* Active drain signal chips — aggregated by kind.
          Two sessions both triggering loop_risk render as one chip: loop_risk × 2,
          not two separate loop_risk × 1 chips. */}
      {d.signals.length > 0 && (() => {
        // Aggregate by kind so two `loop_risk` signals render as one chip with × 2.
        const counts = d.signals.reduce<Map<string, number>>((m, s) => {
          m.set(s.kind, (m.get(s.kind) ?? 0) + 1);
          return m;
        }, new Map());
        return (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.glassBorderSubtle}`, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {Array.from(counts.entries()).map(([kind, count]) => (
              <span key={kind} style={{ padding: "2px 8px", borderRadius: 999, background: `${C.warn}22`, border: `1px solid ${C.warn}55`, color: C.warn, fontSize: 9, fontFamily: F.mono, fontWeight: 700 }}>
                {kind} × {count}
              </span>
            ))}
          </div>
        );
      })()}

      {/*
       * Required-copy disclaimer — spec §16.1.
       * Verbatim text is contractual; do NOT paraphrase or abbreviate.
       */}
      <div
        style={{
          marginTop: 10,
          fontSize: 9,
          color: C.txT,
          fontStyle: "italic",
          lineHeight: 1.4,
        }}
      >
        Source totals shown side-by-side to avoid double-counting. Not invoice-reconciled.
      </div>
    </MiniCard>
  );
}

// ---------------------------------------------------------------------------
// Source Health mini-card (§8.3b)
// ---------------------------------------------------------------------------

function SourceHealthCard({
  collector,
  onNavigate,
}: {
  collector: ReturnType<typeof useCollectorHealth>;
  onNavigate: Props["onNavigate"];
}) {
  const headerLabel = "Source Health";

  if (collector.state === "loading" && !collector.data) {
    return (
      <MiniCard title={headerLabel}>
        <div style={{ color: C.txT, fontSize: 11, fontFamily: F.mono }}>Loading…</div>
      </MiniCard>
    );
  }
  if (collector.state === "error" && !collector.data) {
    return (
      <MiniCard title={headerLabel}>
        <div style={{ color: C.danger, fontSize: 11, fontFamily: F.mono }}>Infra source unavailable</div>
      </MiniCard>
    );
  }

  const d = collector.data!;

  return (
    <MiniCard title={headerLabel} stale={collector.state === "stale"} lastRefreshedAt={collector.lastRefreshedAt}>
      {d.collectors.length === 0 && (
        <div style={{ color: C.txT, fontSize: 11, fontFamily: F.mono, padding: "6px 0" }}>
          No collectors registered.
        </div>
      )}

      {d.collectors.map((c) => {
        // A collector is healthy if last_seen_ms_ago is within its threshold,
        // OR if the field is absent (0) and the route reported "online".
        const lagKnown = c.lastSeenMsAgo > 0;
        const isHealthy = lagKnown
          ? c.lastSeenMsAgo <= c.staleThresholdMs
          : c.status === "online";

        // Strip common suffix tokens for display — they make the name cleaner
        // without losing identity in this narrow column.
        const cleanName = c.name.replace(/-watcher|-adapter|-logger/g, "");

        // Spec §8.3b: version + ingestion summary per row. Both fields are now
        // populated by /api/infrastructure ServiceCheck (Item #4). Render them
        // when present; omit gracefully when absent.

        return (
          <div
            key={c.name}
            className="mc-row-clickable"
            onClick={() => onNavigate("infrastructure", { focus: c.name, fromMissionControl: true })}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onNavigate("infrastructure", { focus: c.name, fromMissionControl: true });
              }
            }}
            style={{
              display: "grid",
              // Wider grid: dot | name+sub | lag/status
              gridTemplateColumns: "16px 1fr 60px",
              gap: 8,
              alignItems: "start",
              padding: "5px 6px",
              marginBottom: 3,
              cursor: "pointer",
              fontFamily: F.mono,
              fontSize: 10,
              borderTop: `1px solid ${C.glassBorderSubtle}`,
            }}
          >
            {/* Health dot: green = healthy, warn = lagging/unknown; glow signature */}
            {(() => {
              const dotColor = isHealthy ? C.green : C.warn;
              return <span style={{ color: dotColor, textAlign: "center", paddingTop: 1, textShadow: `0 0 15px ${dotColor}` }}>●</span>;
            })()}
            {/* Name + version + ingestion sub-line (§8.3b) */}
            <span style={{ overflow: "hidden" }}>
              <span style={{ color: C.txS, textTransform: "uppercase", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {cleanName}
                {c.version && (
                  <span style={{ color: C.txT, fontWeight: 400, marginLeft: 4, textTransform: "none" }}>
                    {c.version}
                  </span>
                )}
              </span>
              {c.ingestion_summary && (
                <span style={{ color: C.txT, fontSize: 8, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.8 }}>
                  {c.ingestion_summary}
                </span>
              )}
            </span>
            {/* Lag or "ok" */}
            <span style={{ color: C.txT, fontSize: 9, textAlign: "right", paddingTop: 1 }}>
              {isHealthy ? "ok" : lagKnown ? `lag ${formatLag(c.lastSeenMsAgo)}` : c.status}
            </span>
          </div>
        );
      })}
    </MiniCard>
  );
}

// ---------------------------------------------------------------------------
// Shared MiniCard frame
// ---------------------------------------------------------------------------

/**
 * MiniCard — thin wrapper that provides the section header + stale badge +
 * last-refreshed age marker (spec §10.1: every metric must expose freshness).
 * Each mini-card inside the combined panel uses this to stay visually consistent.
 */
function MiniCard({
  title,
  children,
  stale,
  lastRefreshedAt,
}: {
  title: string;
  children: ReactNode;
  stale?: boolean;
  lastRefreshedAt?: number;
}) {
  return (
    <div style={{ position: "relative", background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderRadius: 14, padding: 13 }}>
      {/* Section header row — title left, age marker right */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: C.txT, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.08em" }}>
          {title}
        </span>
        {lastRefreshedAt !== undefined && lastRefreshedAt > 0 && (
          <span style={{ fontSize: 9, color: C.txT, fontFamily: F.mono }}>
            ↻ {formatAge(lastRefreshedAt)}
          </span>
        )}
      </div>
      {children}
      {/* Stale badge — surfaced when the last fetch failed but prior data is
          still being shown (stale-marker contract per spec §10.1). Positioned
          absolute so it doesn't displace the header row flex layout. */}
      {stale && (
        <div
          style={{
            position: "absolute",
            top: -2,
            right: 0,
            fontSize: 8,
            color: C.warn,
            fontWeight: 800,
            letterSpacing: "0.05em",
          }}
        >
          STALE
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * formatLag — human-readable lag duration for source health rows.
 * Used only when last_seen_ms_ago is known (> 0).
 */
function formatLag(ms: number): string {
  const SECOND = 1_000;
  const MINUTE = 60_000;
  const HOUR = 3_600_000;
  if (ms < MINUTE) return `${Math.round(ms / SECOND)}s`;
  if (ms < HOUR) return `${Math.round(ms / MINUTE)}m`;
  return `${Math.round(ms / HOUR)}h`;
}

/**
 * formatAge — human-readable age since a Unix-ms timestamp.
 * Used by MiniCard to render the ↻ freshness marker (spec §10.1).
 * Same unit breakpoints as formatLag for visual consistency.
 */
function formatAge(lastRefreshedAt: number): string {
  const ageSec = Math.max(0, Math.floor((Date.now() - lastRefreshedAt) / 1000));
  if (ageSec < 60) return `${ageSec}s`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m`;
  return `${Math.floor(ageSec / 3600)}h`;
}
