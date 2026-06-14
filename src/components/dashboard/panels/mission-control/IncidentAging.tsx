"use client";

import { useEffect, useRef, useState } from "react";
import { C, F } from "../../constants";
import type { TabId } from "../../types";
import type { NavigateOpts } from "../../url-state";
import { INCIDENT_AGING_DEMO } from "./demo-fixtures";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

interface Bucket {
  label: string;
  ageMin: number;
  ageMax: number;
}

const BUCKETS: Bucket[] = [
  { label: "Current", ageMin: 0, ageMax: HOUR },
  { label: "1–4h", ageMin: HOUR, ageMax: 4 * HOUR },
  { label: "4–24h", ageMin: 4 * HOUR, ageMax: DAY },
  { label: "1–3d", ageMin: DAY, ageMax: 3 * DAY },
  { label: "3d+", ageMin: 3 * DAY, ageMax: Infinity },
];

interface Props {
  demoMode: boolean;
  onNavigate: (tab: TabId, focusOrOpts?: NavigateOpts) => void;
}

interface AgingBucket {
  label: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

interface AgingData {
  buckets: AgingBucket[];
  oldest3dPlusCount: number;
  // TODO(v1.1): wire real ack→resolve median from /api/alerts when the
  // resolved/acknowledged timestamps are queryable.
  ackResolveMedianMs: number | null;
}

/**
 * Incident Aging — 5 age buckets stacked by severity. Each row is clickable
 * to drill into the AlertsIncidentsPanel filtered by age. Footer surfaces
 * the "alert graveyard" check (3d+ bucket count) and ack→resolve median.
 *
 * Severity color mapping aligns with KpiCard (critical=danger, high=warn,
 * medium=cyan, low=purp) for visual consistency across the cockpit.
 *
 * Spec §8.1.
 */
export function IncidentAging({ demoMode, onNavigate }: Props) {
  const [data, setData] = useState<AgingData | null>(null);
  const [errored, setErrored] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    // B4: skip the live fetch when in demo mode; the render path uses
    // INCIDENT_AGING_DEMO directly. Keeping the effect mounted (no early
    // return at hook-call time) preserves Rules of Hooks; only the
    // network call is gated.
    if (demoMode) {
      return () => {
        isMountedRef.current = false;
      };
    }
    const run = async () => {
      try {
        const res = await fetch("/api/alerts?scope=active");
        if (!res.ok) {
          if (isMountedRef.current) setErrored(true);
          return;
        }
        const body = await res.json();
        const allAlerts: Array<{ created_at: string; severity?: string; status?: string }> = body?.alerts ?? [];
        // Spec §5.1 semantics: aging chart should reflect the same population as the
        // Active Incidents KPI — status IN ('open', 'investigating', 'suppressed').
        const alerts = allAlerts.filter((a) =>
          a.status === "open" || a.status === "investigating" || a.status === "suppressed"
        );
        const now = Date.now();
        const buckets: AgingBucket[] = BUCKETS.map((b) => {
          const inBucket = alerts.filter((a) => {
            const age = now - new Date(a.created_at).getTime();
            return age >= b.ageMin && age < b.ageMax;
          });
          // Coerce missing severity to "LOW" so stack-segment widths sum to total.
          // Without this fallback, an alert with undefined severity would count
          // toward total but render 0 across all four segments — making the bar
          // shorter than the count column suggests, which confuses operators.
          const sev = (a: { severity?: string }): string => a.severity ?? "LOW";
          return {
            label: b.label,
            critical: inBucket.filter((a) => sev(a) === "CRITICAL").length,
            high: inBucket.filter((a) => sev(a) === "HIGH").length,
            medium: inBucket.filter((a) => sev(a) === "MEDIUM").length,
            low: inBucket.filter((a) => sev(a) === "LOW").length,
            total: inBucket.length,
          };
        });
        if (!isMountedRef.current) return;
        setData({
          buckets,
          oldest3dPlusCount: buckets[buckets.length - 1].total,
          // Placeholder — TODO(v1.1) wire real metric.
          ackResolveMedianMs: null,
        });
        setErrored(false);
      } catch {
        if (isMountedRef.current) setErrored(true);
      }
    };
    run();
    const i = setInterval(run, 30_000);
    return () => {
      isMountedRef.current = false;
      clearInterval(i);
    };
  }, [demoMode]);

  // B4: demo render — substitute the live aging chart with INCIDENT_AGING_DEMO.
  // Renders identical layout (header + 5 bucket rows + graveyard footer) so
  // the visual matches the live card exactly; only the data source differs.
  if (demoMode) {
    const demoBuckets = INCIDENT_AGING_DEMO;
    const oldest3dPlusCount = demoBuckets[demoBuckets.length - 1].total;
    const max = Math.max(1, ...demoBuckets.map((b) => b.total));
    return (
      <div style={{ background: C.glassChrome, backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 18, boxShadow: C.glassShadow, padding: 16 }}>
        <div style={{ fontSize: 11, color: C.txT, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 12 }}>
          Incident Aging by Severity <span style={{ color: C.purp, fontWeight: 800, marginLeft: 6 }}>· DEMO</span>
        </div>
        {demoBuckets.map((b) => (
          <div
            key={b.label}
            onClick={() => onNavigate("alertsIncidents", { filter: { status: ["open"], age: [b.label] }, fromMissionControl: true })}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onNavigate("alertsIncidents", { filter: { status: ["open"], age: [b.label] }, fromMissionControl: true });
              }
            }}
            style={{
              display: "grid",
              gridTemplateColumns: "70px 1fr 50px",
              gap: 8,
              alignItems: "center",
              marginBottom: 7,
              fontFamily: F.mono,
              fontSize: 11,
              cursor: "pointer",
              padding: "4px 6px",
              background: C.glassSurfTrans,
              border: `1px solid ${C.glassSurfBorder}`,
              borderRadius: 8,
            }}
          >
            <span style={{ color: C.txS, textAlign: "right" }}>{b.label}</span>
            <span style={{ height: 18, display: "flex", background: C.glassTrack, borderRadius: 3, overflow: "hidden" }}>
              <Seg width={(b.critical / max) * 100} color={C.danger} />
              <Seg width={(b.high / max) * 100} color={C.warn} />
              <Seg width={(b.medium / max) * 100} color={C.cyan} />
              <Seg width={(b.low / max) * 100} color={C.purp} />
            </span>
            <span style={{ color: C.txS, fontWeight: 700, textAlign: "right" }}>{b.total}</span>
          </div>
        ))}
        <div style={{
          marginTop: 14,
          paddingTop: 8,
          borderRadius: 12,
          background: oldest3dPlusCount === 0 ? `${C.green}14` : `${C.warn}14`,
          border: oldest3dPlusCount === 0 ? `1px solid ${C.green}55` : `1px solid ${C.warn}55`,
          padding: "8px 10px",
          fontSize: 10,
          color: C.txT,
          fontFamily: F.mono,
        }}>
          {oldest3dPlusCount === 0 ? (
            <><strong style={{ color: C.green }}>⚑ ALERT GRAVEYARD CHECK PASS:</strong> 0 incidents over 3 days old. </>
          ) : (
            <><strong style={{ color: C.warn }}>⚑ ALERT GRAVEYARD WARNING:</strong> {oldest3dPlusCount} incident(s) over 3 days old. </>
          )}
          demo · Ack→Resolve median pending v1.1.
        </div>
      </div>
    );
  }

  if (errored && !data) {
    return (
      <div style={{ background: C.glassChrome, backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 18, boxShadow: C.glassShadow, padding: 16 }}>
        <div style={{ color: C.danger, fontSize: 11, fontFamily: F.mono }}>Aging source unavailable</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div style={{ background: C.glassChrome, backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 18, boxShadow: C.glassShadow, padding: 16 }}>
        <div style={{ color: C.txT, fontSize: 11 }}>Loading aging chart…</div>
      </div>
    );
  }

  const max = Math.max(1, ...data.buckets.map((b) => b.total));

  return (
    <div style={{ background: C.glassChrome, backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 18, boxShadow: C.glassShadow, padding: 16 }}>
      <div style={{ fontSize: 11, color: C.txT, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 12 }}>
        Incident Aging by Severity
      </div>
      {data.buckets.map((b) => (
        <div
          key={b.label}
          // v0.13.0+: passes the bucket label as the `age` filter so the
          // AlertsIncidentsPanel pre-filters to the clicked age range.
          // UrlState.age is now a CSV_KEY (added in v0.13.0).
          onClick={() => onNavigate("alertsIncidents", { filter: { status: ["open"], age: [b.label] }, fromMissionControl: true })}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onNavigate("alertsIncidents", { filter: { status: ["open"], age: [b.label] }, fromMissionControl: true });
            }
          }}
          style={{
            display: "grid",
            gridTemplateColumns: "70px 1fr 50px",
            gap: 8,
            alignItems: "center",
            marginBottom: 7,
            fontFamily: F.mono,
            fontSize: 11,
            cursor: "pointer",
            padding: "4px 6px",
            background: C.glassSurfTrans,
            border: `1px solid ${C.glassSurfBorder}`,
            borderRadius: 8,
          }}
        >
          <span style={{ color: C.txS, textAlign: "right" }}>{b.label}</span>
          <span style={{ height: 18, display: "flex", background: C.glassTrack, borderRadius: 3, overflow: "hidden" }}>
            <Seg width={(b.critical / max) * 100} color={C.danger} />
            <Seg width={(b.high / max) * 100} color={C.warn} />
            <Seg width={(b.medium / max) * 100} color={C.cyan} />
            <Seg width={(b.low / max) * 100} color={C.purp} />
          </span>
          <span style={{ color: C.txS, fontWeight: 700, textAlign: "right" }}>{b.total}</span>
        </div>
      ))}
      <div style={{
        marginTop: 14,
        paddingTop: 8,
        borderRadius: 12,
        background: data.oldest3dPlusCount === 0 ? `${C.green}14` : `${C.warn}14`,
        border: data.oldest3dPlusCount === 0 ? `1px solid ${C.green}55` : `1px solid ${C.warn}55`,
        padding: "8px 10px",
        fontSize: 10,
        color: C.txT,
        fontFamily: F.mono,
      }}>
        {data.oldest3dPlusCount === 0 ? (
          <><strong style={{ color: C.green }}>⚑ ALERT GRAVEYARD CHECK PASS:</strong> 0 incidents over 3 days old. </>
        ) : (
          <><strong style={{ color: C.warn }}>⚑ ALERT GRAVEYARD WARNING:</strong> {data.oldest3dPlusCount} incident(s) over 3 days old. </>
        )}
        {data.ackResolveMedianMs !== null
          ? `Ack→Resolve median: ${Math.round(data.ackResolveMedianMs / 60_000)}m.`
          : "Ack→Resolve median pending v1.1."}
      </div>
    </div>
  );
}

function Seg({ width, color }: { width: number; color: string }) {
  if (width <= 0) return null;
  return <div style={{ width: `${width}%`, background: color }} />;
}
