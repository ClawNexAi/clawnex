"use client";

import { C, F } from "../../constants";
import {
  useActiveIncidents,
  useCollectorHealth,
  useCostRisk,
  useEvidenceConfidence,
  usePolicyCoverage,
} from "./data-hooks";
import {
  scoreCostDiscipline,
  scoreEvidenceQuality,
  scoreIncidentHygiene,
  scoreShieldPolicyCoverage,
  scoreSourceFreshness,
} from "./scoring";
import type { TabId } from "../../types";
import type { NavigateOpts } from "../../url-state";
import type { PostureRow, TimeRange } from "./types";
import { POSTURE_SCORES_DEMO } from "./demo-fixtures";

/**
 * Props mirror the dashboard's onNavigate union exactly
 * (MissionControlPanel.tsx line 16 / index.tsx line 158).
 */
interface Props {
  demoMode: boolean;
  range: TimeRange;
  onNavigate: (tab: TabId, focusOrOpts?: NavigateOpts) => void;
}

const ACTIVE_STATUS_FILTER = ["open", "acknowledged", "investigating"];

// ---------------------------------------------------------------------------
// Static configuration (targets, labels, formulas)
// ---------------------------------------------------------------------------

const TARGETS = {
  shieldPolicyCoverage: 85,
  evidenceQuality: 80,
  incidentHygiene: 75,
  sourceFreshness: 90,
  costDiscipline: 70,
} as const;

const LABELS = {
  shieldPolicyCoverage: "Shield + Policy Coverage",
  evidenceQuality: "Evidence Quality",
  incidentHygiene: "Incident Hygiene",
  sourceFreshness: "Source Freshness",
  costDiscipline: "Cost Discipline",
} as const;

/**
 * Formula strings are load-bearing — surfaced via row tooltip so operators
 * can verify every posture score. "No magic score" rule, spec §6.
 */
const FORMULAS = {
  shieldPolicyCoverage:
    "70% core-rule coverage + 20% egress-starter coverage + 10% absence-of-unsafe-regex.",
  evidenceQuality:
    "70% forward correlation + 20% snippet presence + 10% outside-window-fetchable.",
  incidentHygiene:
    "Penalize from 100 by open count, severity, age (>1h/>24h/>3d tiers), and ack-stale.",
  sourceFreshness:
    "min(per-collector freshness scores) — weakest link dominates.",
  costDiscipline:
    "Penalize from 100 by drain signals (×15 each), unknown/token-only ratio, and stale source.",
} as const;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function accentToCol(a: "green" | "warn" | "danger"): string {
  return a === "green" ? C.green : a === "warn" ? C.warn : C.danger;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Operational Posture — the 5-row score-list panel (spec §6).
 *
 * Replaces what would have been a radar polygon (per operator + internal reviewer + implementation agent
 * design-negotiation outcome). Each row renders:
 *   - Label (left)
 *   - Current score (large, accent-coloured) + 7d compare + target threshold
 *   - Paired micro-bar visualizing current vs target (clamped 0-100)
 *   - Whole-row click target → source-of-truth tab with live navigate opts
 *   - Row-level tooltip with the formula (no magic score)
 *   - Keyboard accessible: Enter / Space, role=button, tabIndex=0,
 *     e.preventDefault on Space to suppress page scroll
 *
 * Staleness note: posture rows reuse the upstream KPI data hooks. When a
 * hook is stale the score is computed from last-known data — the upstream
 * KpiCard surfaces the STALE ribbon, so operators see staleness via the KPI
 * row above. Per-row stale visual treatment is deferred to a polish pass
 * (Task 11/13). lastRefreshedAt is wired through PostureRow so that future
 * pass can render per-row stale indicators without new API work.
 *
 * v1.1 deferred wires (see TODO comments below):
 *   - weekAvg values are placeholder constants until metric_snapshots wires.
 *   - oldestAgeMs / ackButNotResolvedCount = 0 until /api/alerts exposes them.
 *   - unknownOrTokenOnlyCount / totalCostRows static until /api/tokens splits
 *     data-quality from headline.
 *
 * Spec §6, §13 visual hierarchy.
 */
export function OperationalPosture({ demoMode, range, onNavigate }: Props) {
  const incidents = useActiveIncidents();
  const evidence = useEvidenceConfidence();
  const cost = useCostRisk(range);
  const collector = useCollectorHealth();
  const policy = usePolicyCoverage();

  // B4: when demoMode is on, build the rows from POSTURE_SCORES_DEMO instead
  // of running the score formulas over (probably-empty) live hook data.
  // Demo accents are pre-computed in the fixture so the visual matches
  // the live-data path's accent-derivation rules; verifier asserts the
  // fixture contains at least one non-green row to keep demo informative.
  const demoRows: PostureRow[] = demoMode
    ? POSTURE_SCORES_DEMO.map((p) => ({
        id: p.id,
        label: p.label,
        current: p.current,
        weekAvg: p.weekAvg,
        target: p.target,
        accent: p.accent,
        clickTarget:
          p.id === "shieldPolicyCoverage"
            ? { tab: "configuration" as TabId, opts: { focus: "policiesAndRules" } }
            : p.id === "evidenceQuality"
              ? { tab: "auditEvidence" as TabId }
              : p.id === "incidentHygiene"
                ? { tab: "alertsIncidents" as TabId }
                : p.id === "sourceFreshness"
                  ? { tab: "infrastructure" as TabId }
                  : { tab: "tokenCost" as TabId },
        formula: FORMULAS[p.id],
        lastRefreshedAt: Date.now(),
      }))
    : [];

  // Build rows then derive accent from computed score vs target.
  const rows: PostureRow[] = demoMode ? demoRows : (
    [
      {
        id: "shieldPolicyCoverage" as const,
        label: LABELS.shieldPolicyCoverage,
        current: policy.data
          ? scoreShieldPolicyCoverage({
              activeCoreRules: policy.data.coreRules,
              totalCoreRules: 163,
              activeEgressStarter: policy.data.activeEgressStarter,
              totalEgressStarter: 12,
              unsafeRegexCount: policy.data.unsafeRegexCount,
              totalPolicyRules:
                policy.data.coreRules +
                policy.data.activeEgressStarter +
                policy.data.labHeldDrafts,
            })
          : 0,
        weekAvg: 84, // TODO(v1.1): wire from metric_snapshots
        target: TARGETS.shieldPolicyCoverage,
        accent: "green" as const, // recomputed after .map below
        clickTarget: { tab: "configuration" as TabId, opts: { focus: "policiesAndRules" } },
        formula: FORMULAS.shieldPolicyCoverage,
        lastRefreshedAt: policy.lastRefreshedAt,
      },
      {
        id: "evidenceQuality" as const,
        label: LABELS.evidenceQuality,
        current: evidence.data
          ? scoreEvidenceQuality({
              forwardCount: evidence.data.exact,
              snippetPresentCount: evidence.data.total - evidence.data.missingSnippet,
              // Item #5: wire real outside-window-fetchable count from
              // /api/alerts/[id]/evidence.outside_window_fetchable (Boolean per
              // evidence response, aggregated in useEvidenceConfidence).
              outsideWindowFetchableCount: evidence.data.outsideWindowFetchable,
              totalResolvable: evidence.data.total,
            })
          : 0,
        weekAvg: 79, // TODO(v1.1)
        target: TARGETS.evidenceQuality,
        accent: "green" as const,
        clickTarget: { tab: "auditEvidence" as TabId },
        formula: FORMULAS.evidenceQuality,
        lastRefreshedAt: evidence.lastRefreshedAt,
      },
      {
        id: "incidentHygiene" as const,
        label: LABELS.incidentHygiene,
        current: incidents.data
          ? scoreIncidentHygiene({
              openCount: incidents.data.open,
              criticalCount: incidents.data.critical,
              highCount: incidents.data.high,
              // Item #3: wire real values from /api/alerts aggregate fields.
              oldestAgeMs: incidents.data.oldestOpenAgeMs,
              ackButNotResolvedCount: incidents.data.ackButNotResolvedCount,
            })
          : 0,
        weekAvg: 65, // TODO(v1.1)
        target: TARGETS.incidentHygiene,
        accent: "warn" as const,
        // opts intentionally omitted here — click handler translates to filter shape below
        clickTarget: { tab: "alertsIncidents" as TabId },
        formula: FORMULAS.incidentHygiene,
        lastRefreshedAt: incidents.lastRefreshedAt,
      },
      {
        id: "sourceFreshness" as const,
        label: LABELS.sourceFreshness,
        current: collector.data
          ? scoreSourceFreshness(collector.data.collectors)
          : 0,
        weekAvg: 90, // TODO(v1.1)
        target: TARGETS.sourceFreshness,
        accent: "green" as const,
        clickTarget: { tab: "infrastructure" as TabId },
        formula: FORMULAS.sourceFreshness,
        lastRefreshedAt: collector.lastRefreshedAt,
      },
      {
        id: "costDiscipline" as const,
        label: LABELS.costDiscipline,
        current: cost.data
          ? scoreCostDiscipline({
              activeSignalCount: cost.data.signals.length,
              unknownOrTokenOnlyCount: 0, // TODO(v1.1)
              totalCostRows: 100, // TODO(v1.1)
              anyStaleSource: cost.data.unavailableSources.length > 0,
            })
          : 0,
        weekAvg: 58, // TODO(v1.1)
        target: TARGETS.costDiscipline,
        accent: "warn" as const,
        clickTarget: { tab: "tokenCost" as TabId },
        formula: FORMULAS.costDiscipline,
        lastRefreshedAt: cost.lastRefreshedAt,
      },
    ] satisfies PostureRow[]
  ).map((r) => ({
    ...r,
    // Derive accent from score vs target.
    // green  → at or above target
    // warn   → within 30% below target  (i.e. score ≥ target × 0.7)
    // danger → more than 30% below target
    accent: (
      r.current >= r.target
        ? "green"
        : r.current >= r.target * 0.7
        ? "warn"
        : "danger"
    ) as "green" | "warn" | "danger",
  }));

  // ---------------------------------------------------------------------------
  // Click / keyboard handler factory
  // ---------------------------------------------------------------------------

  /**
   * Translate a PostureRow's simple NavTarget shape into the navigate-union
   * opts that the live onNavigate function expects:
   *
   *  - incidentHygiene → status filter (flat NavTarget has no filter shape)
   *  - shieldPolicyCoverage → focus param from NavTarget.opts.focus
   *  - all others → no opts (tab navigation only)
   */
  function handleRowClick(r: PostureRow) {
    if (r.id === "incidentHygiene") {
      // Navigate to alertsIncidents with the same canonical active population
      // used by Mission Control's Active Incidents KPI.
      onNavigate(r.clickTarget.tab, { filter: { status: ACTIVE_STATUS_FILTER, productionOnly: "true" }, fromMissionControl: true });
      return;
    }
    if (r.clickTarget.opts?.focus) {
      onNavigate(r.clickTarget.tab, { focus: r.clickTarget.opts.focus, fromMissionControl: true });
      return;
    }
    onNavigate(r.clickTarget.tab, { fromMissionControl: true });
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      className="mc-panel-surface mc-operational-posture"
      style={{
        background: C.glassChrome,
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        border: `1px solid ${C.glassBorderSubtle}`,
        borderRadius: 18,
        boxShadow: C.glassShadow,
        padding: 16,
      }}
    >
      {/* Panel header */}
      <div
        style={{
          fontSize: 11,
          color: C.txT,
          textTransform: "uppercase",
          fontWeight: 700,
          letterSpacing: "0.08em",
          marginBottom: 12,
        }}
      >
        Operational Posture
        {demoMode && (
          <span style={{ color: C.purp, fontWeight: 800, marginLeft: 6 }}>· DEMO</span>
        )}
      </div>

      {/* Score rows */}
      {rows.map((r) => (
        <div
          key={r.id}
          onClick={() => handleRowClick(r)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              // Prevent Space from scrolling the page.
              e.preventDefault();
              handleRowClick(r);
            }
          }}
          role="button"
          tabIndex={0}
          title={r.formula}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 60px 80px 80px",
            gap: 8,
            alignItems: "center",
            padding: "9px 10px",
            border: `1px solid ${C.glassSurfBorder}`,
            borderRadius: 12,
            background: C.glassSurfTrans,
            marginBottom: 6,
            cursor: "pointer",
            fontFamily: F.mono,
            fontSize: 12,
          }}
        >
          {/* Col 1: label */}
          <span style={{ color: C.txS }}>{r.label}</span>

          {/* Col 2: current score */}
          <span
            style={{
              fontWeight: 700,
              color: accentToCol(r.accent),
              textAlign: "right",
            }}
          >
            {r.current}
          </span>

          {/* Col 3: mini-bar (score vs 100, accent-colored fill) */}
          <span style={{ display: "flex", alignItems: "center" }}>
            <span
              style={{
                flex: 1,
                height: 4,
                background: C.glassTrack,
                borderRadius: 2,
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  display: "block",
                  // Clamp explicitly so any out-of-range score never breaks layout.
                  width: `${Math.min(100, Math.max(0, r.current))}%`,
                  height: "100%",
                  // Gradient signals "good" semantic only; warn/danger keep solid accent
                  background: r.accent === "green"
                    ? `linear-gradient(90deg, ${C.cyan}, ${C.glassGreen})`
                    : accentToCol(r.accent),
                  borderRadius: 2,
                }}
              />
            </span>
          </span>

          {/* Col 4: 7d avg + target threshold */}
          <span style={{ fontSize: 10, color: C.txT, textAlign: "right" }}>
            7d {r.weekAvg} · ≥{r.target}
          </span>
        </div>
      ))}

      {/* Footer footnote */}
      <div
        style={{
          marginTop: 12,
          fontSize: 10,
          color: C.txT,
          fontStyle: "italic",
        }}
      >
        Click any row to drill into its source. No magic score — every formula is documented.
      </div>
    </div>
  );
}
