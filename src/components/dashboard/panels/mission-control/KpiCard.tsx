"use client";

import { C, F } from "../../constants";
import { Spark } from "../../shared";
import type { KpiAccent, KpiData } from "./types";

interface Props {
  data: KpiData;
  /** 24-hour sparkline data (last 24 hourly buckets). Optional — empty array hides the spark. */
  sparkData?: number[];
  onClick: () => void;
}

/**
 * Single Mission Control KPI card.
 *
 * Spec: docs/superpowers/specs/2026-05-05-mission-control-design.md §5
 *
 * Renders:
 *   - Label row with status pill in the corner (spec §13.1)
 *   - Headline value (large, mono)
 *   - Up to 3 breakdown rows
 *   - Stacked composition bar at the bottom (proportional split — spec §13.1)
 *   - Optional sparkline overlay
 *   - Footer line + last-refreshed marker
 *
 * The whole card is the click target. Keyboard-accessible via tab + enter.
 *
 * State variants:
 *   - "live"        normal render
 *   - "loading"     placeholder skeleton
 *   - "stale"       data shown with amber stale ribbon
 *   - "error"       error message + last-known value
 *   - "restricted"  RBAC fail-soft: "Restricted" pill + click leads to 403
 *   - "empty"       value=0 with positive framing where applicable
 */
export function KpiCard({ data, sparkData, onClick }: Props) {
  const accentColor = accentToColor(data.pillAccent ?? "brand");
  // Fix I1: stale state shows last-known data with amber ribbon — operators
  // must be able to drill in to investigate, so treat it as clickable.
  const isClickable = data.state === "live" || data.state === "empty" || data.state === "stale";

  return (
    // Fix I4: mc-kpi-card className is the :focus-visible hook (rule lives in globals.css).
    <div
      className="mc-kpi-card"
      onClick={isClickable ? onClick : undefined}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : -1}
      onKeyDown={(e) => {
        if (!isClickable) return;
        if (e.key === "Enter" || e.key === " ") {
          // Fix I2: suppress browser page-scroll on Space key.
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        position: "relative",
        background: `linear-gradient(180deg, ${C.glassPanel}, ${C.glassPanel2})`,
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        border: `1px solid ${C.glassBorderCyan}`,
        borderRadius: 18,
        boxShadow: C.glassCardShadow,
        padding: 14,
        // Fix M1: not-allowed only for restricted (RBAC block); loading/error use default.
        cursor: isClickable
          ? "pointer"
          : data.state === "restricted"
            ? "not-allowed"
            : "default",
        opacity: data.state === "restricted" ? 0.6 : 1,
        minHeight: 146,
        overflow: "hidden",
      }}
    >
      {/* ::before glow overlay — implemented as an inline absolutely-positioned
          div since CSS pseudo-elements are not available in inline styles. */}
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 10% 0%, rgba(34,211,238,.10), transparent 36%)", pointerEvents: "none" }} />
      <div style={{ position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: C.txT, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 6, gap: 6 }}>
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{labelFor(data.id)}</span>
        {data.pill && (
          <span style={{
            padding: "1px 5px",
            borderRadius: 2,
            // Semi-transparent pill: rgba 8% background + accent border + accent text
            background: `${accentColor}22`,
            border: `1px solid ${accentColor}55`,
            // Fix I3: use fixed-per-accent lookup so contrast survives light-mode theme flip.
            color: pillTextColor(data.pillAccent ?? "brand"),
            fontSize: 8,
            fontWeight: 800,
            // operator 2026-05-07: "ALL CLEAR" was wrapping to 2 lines while OK /
            // DEGRADED / WARN stayed single-line. Pill must always be one line.
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}>
            {data.pill}
          </span>
        )}
      </div>

      {data.state === "loading" ? (
        <div style={{ height: 32, background: `${C.brd}40`, borderRadius: 4, marginBottom: 8 }} />
      ) : data.state === "error" ? (
        <div style={{ fontSize: 11, color: C.danger, fontFamily: F.mono, padding: "10px 0" }}>
          Source unavailable
        </div>
      ) : (
        <>
          {/* operator 2026-05-07: "2/3" rendered as value + unit at different font
              sizes was sitting at slightly different baselines on narrow tiles.
              Wrapping in flex baseline-aligns the two glyph runs cleanly and
              guarantees single-line rendering even when the tile is narrow. */}
          <div style={{ display: "flex", alignItems: "baseline", flexWrap: "nowrap", fontSize: 28, fontWeight: 800, fontFamily: F.mono, color: accentColor, lineHeight: 1, marginBottom: 8, letterSpacing: "-0.04em", whiteSpace: "nowrap" }}>
            <span>{data.value}</span>
            {data.unit && <span style={{ fontSize: 14, color: C.txS, marginLeft: 1 }}>{data.unit}</span>}
          </div>
          <div style={{ fontSize: 10, color: C.txS, fontFamily: F.mono, lineHeight: 1.5 }}>
            {data.breakdown.map((r, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "baseline" }}>
                {/* operator 2026-05-07: long breakdown labels (e.g. "OpenClaw Gateway
                    (WebSocket)") were wrapping inside narrow tiles. Force single
                    line + ellipsis so labels and values stay aligned. */}
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{r.label}</span>
                <span style={r.accent ? { color: accentToColor(r.accent) } : undefined}>{r.value}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {data.stack && data.stack.length > 0 && (
        <div style={{ height: 8, borderRadius: 999, overflow: "hidden", background: C.glassTrack, display: "flex", marginTop: 13 }}>
          {data.stack.map((seg, i) => (
            <div key={i} style={{ height: "100%", width: `${seg.ratio * 100}%`, background: accentToColor(seg.accent) }} />
          ))}
        </div>
      )}

      {sparkData && sparkData.length > 1 && (
        <div style={{ position: "absolute", right: 8, bottom: 8, opacity: 0.5 }}>
          <Spark data={sparkData} color={accentColor} w={64} h={20} />
        </div>
      )}

      {(data.footer || data.lastRefreshedAt > 0) && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.glassBorderSubtle}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 9, color: C.txT, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          <span>{data.footer ?? ""}</span>
          {data.lastRefreshedAt > 0 && (
            <span style={{ fontFamily: F.mono, textTransform: "none", letterSpacing: "0.04em" }}>
              ↻ {formatAge(data.lastRefreshedAt)}
            </span>
          )}
        </div>
      )}

      </div>{/* end position:relative content wrapper */}

      {data.state === "stale" && (
        <div style={{ position: "absolute", top: 0, right: 0, background: C.warn, color: C.bg, fontSize: 8, padding: "2px 6px", borderBottomLeftRadius: 4, fontWeight: 800 }}>STALE</div>
      )}
    </div>
  );
}

// Fix M5: exported so Tasks 10-11 (OperationalPosture, IncidentAging) can reuse without duplication.
export function accentToColor(a: KpiAccent): string {
  return { danger: C.danger, warn: C.warn, cyan: C.cyan, green: C.green, purp: C.purp, brand: C.brand }[a];
}

// Fix M5: exported for canonical KPI display labels shared across panels.
export function labelFor(id: KpiData["id"]): string {
  return {
    activeIncidents: "Active Incidents",
    evidenceConfidence: "Evidence Confidence",
    shieldActivity: "Shield Activity 24h",
    costRisk: "Cost Risk",
    collectorHealth: "Collector Health",
    policyCoverage: "Policy Coverage",
  }[id];
}

/**
 * Pill text color — matches the accent color for high contrast against the
 * translucent rgba 13% pill background.
 *
 * History: an earlier version returned fixed dark/light text values, which
 * worked when the pill bg was the SOLID accent (saturated bright surface +
 * dark text = legible). When the pill bg moved to ${accent}22 (13% opacity
 * translucent over dark glass), the dark text became invisible against the
 * resulting dark-tinted surface. operator-flagged 2026-05-06: "I cannot read
 * anything in the boxes." Now returns the accent color itself so the pill
 * text reads as a slightly brighter accent on a slightly darker accent —
 * consistent with the rest of the dashboard's translucent-pill pattern.
 */
function pillTextColor(a: KpiAccent): string {
  return {
    danger: C.danger,
    warn:   C.warn,
    cyan:   C.cyan,
    green:  C.green,
    purp:   C.purp,
    brand:  C.brand,
  }[a] ?? C.brand;
}

/**
 * Renders the freshness age relative to now: "3s", "47s", "2m", "14m", "1h", "1d".
 *
 * Spec §10.1 stale-marker contract: every metric must expose its last-refreshed
 * timestamp inline so operators can spot drift without inspecting state values.
 * KpiCard is the enforcement point — every consumer benefits without per-mapper
 * footer-stuffing drift risk.
 */
function formatAge(lastRefreshedAt: number): string {
  const ageSec = Math.max(0, Math.floor((Date.now() - lastRefreshedAt) / 1000));
  if (ageSec < 60) return `${ageSec}s`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m`;
  if (ageSec < 86400) return `${Math.floor(ageSec / 3600)}h`;
  return `${Math.floor(ageSec / 86400)}d`;
}
