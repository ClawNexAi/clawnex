"use client";

/**
 * Detection Trend (24h) — spec §8.2.
 *
 * Renders an SVG polyline chart of three series (Block / Review / Allow) from
 * the per-hour bucket data returned by /api/shield/stats?bucket=hour.
 *
 * Replaced the v1.0 placeholder (Option B: "Hourly trend pending v1.1") once
 * getShieldStatsHourly() shipped in src/lib/services/prompt-interceptor.ts
 * and the route started accepting ?bucket=hour (Item #1, mission-control-v1
 * backend deferrals commit).
 *
 * Chart spec (§8.2):
 *   - Three polylines: Block (danger), Review (warn), Allow (green).
 *   - X-axis: hour labels, one per bucket (abbreviated HH:00).
 *   - Y-axis: 0 → max(bucket total). If all buckets are zero, chart shows
 *     flat lines at y=0 with a "No detections in window" legend.
 *   - ~80-120 lines of SVG, no external chart library.
 *   - Click anywhere → trafficMonitor tab (spec §8.2 click target).
 *
 * Empty-state: if no bucket data is returned yet (route cold, DB empty), the
 * chart renders the three series as flat lines at zero — honest and visually
 * consistent with "no activity" rather than a spinner or placeholder text.
 *
 * Refresh strategy: poll_5m (spec §8.2) — driven by the parent useShieldActivity
 * hook which already passes ?bucket=hour. Time behavior: time_windowed.
 */

import { C, F } from "../../constants";
import type { TabId } from "../../types";
import type { NavigateOpts } from "../../url-state";
import type { TimeRange } from "./types";
import { useShieldActivity } from "./data-hooks";
import type { ShieldActivityData, ShieldHourBucket } from "./data-hooks";
import { SHIELD_ACTIVITY_DEMO } from "./demo-fixtures";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

interface Props {
  demoMode: boolean;
  range: TimeRange;
  onNavigate: (tab: TabId, focusOrOpts?: NavigateOpts) => void;
}

// ---------------------------------------------------------------------------
// SVG chart constants
// ---------------------------------------------------------------------------

const SVG_W = 440;
const SVG_H = 100;
const PAD_LEFT = 28;  // space for y-axis labels
const PAD_RIGHT = 8;
const PAD_TOP = 8;
const PAD_BOTTOM = 20; // space for x-axis hour labels

const CHART_W = SVG_W - PAD_LEFT - PAD_RIGHT;
const CHART_H = SVG_H - PAD_TOP - PAD_BOTTOM;

const SERIES = [
  { key: "blocked"  as const, label: "Block",  color: C.danger },
  { key: "reviewed" as const, label: "Review", color: C.warn   },
  { key: "allowed"  as const, label: "Allow",  color: C.green  },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a bucket value to an SVG y-coordinate (inverted: 0 = top). */
function toY(value: number, maxVal: number): number {
  if (maxVal === 0) return PAD_TOP + CHART_H; // flat line at bottom
  return PAD_TOP + CHART_H - (value / maxVal) * CHART_H;
}

/** Map a bucket index to an SVG x-coordinate. */
function toX(i: number, total: number): number {
  if (total <= 1) return PAD_LEFT + CHART_W / 2;
  return PAD_LEFT + (i / (total - 1)) * CHART_W;
}

/** Abbreviate ISO hour string to "HH:00" local display. */
function hourLabel(iso: string): string {
  try {
    const d = new Date(iso);
    return `${String(d.getUTCHours()).padStart(2, "0")}:00`;
  } catch {
    return iso.slice(11, 16);
  }
}

/**
 * Build a polyline points string from a series of (x, y) pairs.
 * Returns "0,0" (degenerate point) for empty input so SVG never errors.
 */
function polylinePoints(
  buckets: ShieldHourBucket[],
  key: "blocked" | "reviewed" | "allowed",
  maxVal: number,
): string {
  if (buckets.length === 0) return `${PAD_LEFT},${PAD_TOP + CHART_H}`;
  return buckets
    .map((b, i) => `${toX(i, buckets.length).toFixed(1)},${toY(b[key], maxVal).toFixed(1)}`)
    .join(" ");
}

// ---------------------------------------------------------------------------
// Synthesize placeholder buckets when the API hasn't returned data yet.
// Ensures the chart always renders (spec §8.2: no spinner in the trend area).
// ---------------------------------------------------------------------------

function placeholderBuckets(count = 24): ShieldHourBucket[] {
  const now = Date.now();
  const HOUR = 3_600_000;
  return Array.from({ length: count }, (_, i) => {
    const h = new Date(now - (count - 1 - i) * HOUR);
    const iso = `${h.getUTCFullYear()}-${String(h.getUTCMonth() + 1).padStart(2, "0")}-${String(h.getUTCDate()).padStart(2, "0")}T${String(h.getUTCHours()).padStart(2, "0")}:00:00Z`;
    return { hour: iso, total: 0, allowed: 0, reviewed: 0, blocked: 0 };
  });
}

// ---------------------------------------------------------------------------
// ChartSVG — the actual SVG polyline chart
// ---------------------------------------------------------------------------

function ChartSVG({ data }: { data: ShieldActivityData }) {
  const buckets: ShieldHourBucket[] =
    data.hourlyBuckets && data.hourlyBuckets.length > 0
      ? data.hourlyBuckets
      : placeholderBuckets();

  // Max of any single-series value across all buckets — used for y-axis scaling.
  // Using per-series max (not total) avoids ALLOW dwarfing the danger/warn lines.
  const maxVal = Math.max(
    1, // floor of 1 avoids division-by-zero; all-zero → flat lines
    ...buckets.flatMap((b) => [b.blocked, b.reviewed, b.allowed]),
  );

  // X-axis label stride: show every Nth label to avoid overlap.
  // For 24 buckets show every 6 (0h, 6h, 12h, 18h). For fewer show all.
  const labelStride = buckets.length > 12 ? Math.ceil(buckets.length / 6) : 1;

  // Y-axis: 3 horizontal grid lines at 0%, 50%, 100% of maxVal.
  // Dedupe via Set: when maxVal === 1 (the floor for all-zero windows),
  // the naive [0, round(0.5), 1] produces [0, 1, 1] → duplicate React keys
  // on the grid-line <g key={val}> below. Set-dedupe keeps the chart from
  // rendering two grid lines at the same y-coord and silences the warning.
  const yGridVals = Array.from(new Set([0, Math.round(maxVal / 2), maxVal])).sort((a, b) => a - b);

  const allZero = data.hourlyBuckets && data.hourlyBuckets.every((b) => b.total === 0);

  return (
    <svg
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      aria-label="Detection trend chart — Block, Review, Allow series over 24h"
    >
      {/* Y-axis grid lines + labels */}
      {yGridVals.map((val) => {
        const y = toY(val, maxVal);
        return (
          <g key={val}>
            <line
              x1={PAD_LEFT}
              y1={y}
              x2={SVG_W - PAD_RIGHT}
              y2={y}
              stroke={C.glassBorderSubtle}
              strokeWidth={0.5}
            />
            <text
              x={PAD_LEFT - 3}
              y={y + 3}
              textAnchor="end"
              fontSize={7}
              fill={C.txT}
              fontFamily={F.mono}
              opacity={0.7}
            >
              {val}
            </text>
          </g>
        );
      })}

      {/* X-axis hour labels */}
      {buckets.map((b, i) => {
        if (i % labelStride !== 0) return null;
        const x = toX(i, buckets.length);
        return (
          <text
            // Use index as key: empty/placeholder windows can produce duplicate
            // b.hour values; position is positionally stable (slot i always
            // represents the i-th hour offset), so index is correct here.
            key={i}
            x={x}
            y={SVG_H - 4}
            textAnchor="middle"
            fontSize={7}
            fill={C.txT}
            fontFamily={F.mono}
            opacity={0.7}
          >
            {hourLabel(b.hour)}
          </text>
        );
      })}

      {/* Polylines — rendered back-to-front: Allow → Review → Block
          so Block (most urgent) sits on top for readability. */}
      {[...SERIES].reverse().map(({ key, color }) => (
        <polyline
          key={key}
          points={polylinePoints(buckets, key, maxVal)}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.85}
        />
      ))}

      {/* "No activity" label when all buckets are zero and we have real data */}
      {allZero && (
        <text
          x={PAD_LEFT + CHART_W / 2}
          y={PAD_TOP + CHART_H / 2 + 4}
          textAnchor="middle"
          fontSize={9}
          fill={C.txT}
          fontFamily={F.mono}
          fontStyle="italic"
          opacity={0.7}
        >
          No detections in window
        </text>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/**
 * DetectionTrend — SVG line chart rendering the real hourly-bucketed series.
 *
 * Consumes useShieldActivity(range) which now requests ?bucket=hour, so
 * data.hourlyBuckets is populated whenever the route responds. Falls back to
 * flat-zero placeholder buckets while loading or when the window has no data.
 */
export function DetectionTrend({ demoMode, range, onNavigate }: Props) {
  const shield = useShieldActivity(range);

  // B4: when demoMode is on, substitute the live shield activity payload
  // with SHIELD_ACTIVITY_DEMO. The hook still fires (Rules of Hooks)
  // but its result is ignored. Wasted fetch is acceptable in demo —
  // operators don't run heavy traffic against demo machines.
  const chartData: ShieldActivityData | null = demoMode ? SHIELD_ACTIVITY_DEMO : shield.data;
  const chartLastRefreshedAt = demoMode ? Date.now() : shield.lastRefreshedAt;

  return (
    <div
      className="mc-panel-surface mc-detection-trend"
      onClick={() => onNavigate("trafficMonitor", { fromMissionControl: true })}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNavigate("trafficMonitor", { fromMissionControl: true });
        }
      }}
      style={{
        background: C.glassChrome,
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        border: `1px solid ${C.glassBorderSubtle}`,
        borderRadius: 18,
        boxShadow: C.glassShadow,
        padding: 16,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Panel header */}
      <div
        style={{
          fontSize: 10,
          color: C.txT,
          textTransform: "uppercase",
          fontWeight: 700,
          letterSpacing: "0.08em",
          marginBottom: 8,
        }}
      >
        Detection Trend (24h)
      </div>

      {/* Legend pills — Block / Review / Allow */}
      <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
        {SERIES.map(({ label, color }) => (
          <span
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 9,
              fontFamily: F.mono,
              color: C.txT,
            }}
          >
            <span style={{ width: 8, height: 2, background: color, borderRadius: 1, display: "inline-block" }} />
            {label}
          </span>
        ))}
        {/* Freshness marker */}
        {chartLastRefreshedAt > 0 && (
          <span style={{ marginLeft: "auto", fontSize: 9, color: C.txT, fontFamily: F.mono, opacity: 0.7 }}>
            {demoMode ? "demo" : `↻ ${Math.max(0, Math.floor((Date.now() - chartLastRefreshedAt) / 1000))}s`}
          </span>
        )}
      </div>

      {/* SVG chart — fills remaining vertical space */}
      <div style={{ flex: 1, minHeight: 90 }}>
        {chartData ? (
          <ChartSVG data={chartData} />
        ) : (
          // Loading state: flat-zero placeholders give visual continuity
          <ChartSVG data={{ total: 0, allow: 0, review: 0, block: 0, hourlyBuckets: placeholderBuckets() }} />
        )}
      </div>

      {/* Footer callout */}
      <div
        style={{
          marginTop: 8,
          fontSize: 9,
          color: C.txT,
          fontStyle: "italic",
          lineHeight: 1.4,
          opacity: 0.8,
        }}
      >
        Click to open Traffic Monitor for the live event stream.
      </div>
    </div>
  );
}
