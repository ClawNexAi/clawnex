"use client";

import type { TabId } from "../types";
import type { NavigateOpts } from "../url-state";
import { MissionControlHeader } from "./mission-control/MissionControlHeader";
import { MissionControlSetupBanner } from "./mission-control/MissionControlSetupBanner";
import { KpiRow } from "./mission-control/KpiRow";
import { OperationalPosture } from "./mission-control/OperationalPosture";
import { IncidentAging } from "./mission-control/IncidentAging";
import { ActionQueue, type Operator } from "./mission-control/ActionQueue";
import { SignalsAndSourceHealth } from "./mission-control/SignalsAndSourceHealth";
import { DetectionTrend } from "./mission-control/DetectionTrend";
import type { TimeRange } from "./mission-control/types";
import { useSetupComplete } from "../useSetupComplete";

interface Props {
  demoMode: boolean;
  // Aligned with the dashboard's navigate() signature (index.tsx).
  // NavigateOpts is the single source of truth for the focusOrOpts union.
  onNavigate: (tab: TabId, focusOrOpts?: NavigateOpts) => void;
  /** Operator identity from the dashboard RBAC context. Optional: when absent
   *  (RBAC off / not yet loaded) ActionQueue defaults to unrestricted (default-allow). */
  operator?: Operator;
  /** Global time range from the dashboard's context bar (1h/6h/24h/7d/30d).
   *  v0.13.0+: MC consumes this directly instead of maintaining its own
   *  duplicate range picker — see operator directive 2026-05-06. */
  range: TimeRange;
}

/**
 * ClawNex Mission Control — operator cockpit.
 *
 * Spec: docs/superpowers/specs/2026-05-05-mission-control-design.md
 *
 * Composition (spec §3.2):
 *   - MissionControlHeader   — three FinOps disclosure pills (§16.1 required-copy)
 *   - KpiRow                 — 6 KPI cards (Task 7-9)
 *   - PostureRow             — OperationalPosture | IncidentAging (Task 10-11)
 *   - ActionQueue            — full-width prioritized table (Task 12)
 *   - ContextRow             — SignalsAndSourceHealth | DetectionTrend (Task 13)
 *
 * 2026-05-06: operator-driven cleanup
 *  - Outer iframe-style glass shell removed (commit 9545b4d).
 *  - Page-level radial-gradient stage removed — was creating a second
 *    iframe-edge against the dashboard background (commit 81f1db3).
 *  - Local "▸ COMMAND Mission Control ↻ Ns" prefix removed (duplicated
 *    the dashboard's panel-header bar).
 *  - Local 1h/24h/7d/30d range picker removed (duplicated the dashboard
 *    context bar's 1h/6h/24h/7d/30d picker, which all other tabs use).
 *  - MC now consumes the dashboard's global timeRange via the `range` prop.
 *
 * Each child component carries its own glass chrome via the shared layer
 * (G.card, glass tokens, ::before glow overlays). MC's outer wrapper is
 * a bare <div> so children sit flush on the dashboard background.
 */
export function MissionControlPanel({ demoMode, onNavigate, operator, range }: Props) {
  // operator 2026-05-07: empty cockpit pre-setup reads as "all clear" because every
  // tile shows 0. Banner makes the difference explicit so operators don't
  // mistake "no data observed yet" for "no incidents".
  const setupComplete = useSetupComplete(demoMode);

  return (
    <div>
      <MissionControlSetupBanner setupComplete={setupComplete} onNavigate={onNavigate} />

      <MissionControlHeader demoMode={demoMode} />

      <KpiRow range={range} demoMode={demoMode} onNavigate={onNavigate} />

      <div className="mc-middle-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <OperationalPosture demoMode={demoMode} range={range} onNavigate={onNavigate} />
        <IncidentAging demoMode={demoMode} onNavigate={onNavigate} />
      </div>

      {/* Action Queue — full-width prioritized table (Task 12) */}
      <ActionQueue demoMode={demoMode} range={range} onNavigate={onNavigate} operator={operator} />

      {/* Bottom context row — SignalsAndSourceHealth + DetectionTrend (Task 13) */}
      <div className="mc-bottom-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <SignalsAndSourceHealth demoMode={demoMode} range={range} onNavigate={onNavigate} />
        <DetectionTrend demoMode={demoMode} range={range} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
