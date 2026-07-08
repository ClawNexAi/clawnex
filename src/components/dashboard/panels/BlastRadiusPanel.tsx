// Blast Radius — top-level operator panel.
//
// Spec: docs/superpowers/specs/2026-04-23-blast-radius-permissiveness-design.md §7
// Plan: docs/superpowers/plans/2026-04-23-blast-radius-permissiveness-plan.md

import { useMemo } from "react";
import { C, F } from "../constants";
import {
  Card,
  PanelStateBar,
  PanelEmptyState,
  PanelErrorState,
  PanelDisconnected,
  Stat,
  Badge,
} from "../shared";
import { ExposureMatrix } from "./blast-radius/ExposureMatrix";
import { FindingsGrid } from "./blast-radius/FindingsGrid";
import { KPI_TOOLTIPS } from "./blast-radius/kpiTooltips";
import { Tooltip } from "../tooltip";
import { ProvenanceLegend } from "./blast-radius/provenanceLegend";
import { RankedAgentsTable } from "./blast-radius/RankedAgentsTable";
import { RankedSurfacesTable } from "./blast-radius/RankedSurfacesTable";
import { useBlastRadiusData } from "./blast-radius/useBlastRadiusData";
import type { TabId } from "../types";
import type { BlastRadiusScore } from "@/lib/services/permissiveness/types";

interface Props {
  onNavigate?: (tab: TabId) => void;
  demoMode?: boolean;
}

export function BlastRadiusPanel({ onNavigate, demoMode }: Props) {
  const { data, state, lastUpdated, error, refresh, forceRefresh } = useBlastRadiusData({ demoMode });

  // KPI derivations (all honest re: zero vs unknown).
  const kpis = useMemo(() => {
    if (!data) return null;
    const shippedSurfaces = data.surfaces.filter((s) => s.integrationStatus === "shipped").length;
    const notIntegratedSurfaces = data.surfaces.filter((s) => s.integrationStatus === "not_integrated").length;
    const uniqueAgents = new Set<string>();
    for (const s of data.surfaces) {
      for (const r of s.reachability) uniqueAgents.add(r.agentId);
    }
    const evaluableCombos = data.dangerousCombos.filter((c) => c.evaluable).length;
    const skippedCombos = data.dangerousCombos.length - evaluableCombos;
    const lintCount = data.postureLints.length;
    const zero: BlastRadiusScore = {
      numeric: 0,
      band: "minimal",
      drivers: [],
      confidence: "unknown",
      rawFactors: {},
    };
    const worstSurface = data.surfaces.reduce<BlastRadiusScore>(
      (max, s) => (s.effectiveBlastRadius.numeric > max.numeric ? s.effectiveBlastRadius : max),
      zero,
    );
    return {
      surfacesTotal: data.surfaces.length,
      shippedSurfaces,
      notIntegratedSurfaces,
      uniqueAgents: uniqueAgents.size,
      evaluableCombos,
      skippedCombos,
      lintCount,
      maxNumeric: worstSurface.numeric,
      maxBand: worstSurface.band,
      maxConfidence: worstSurface.confidence,
    };
  }, [data]);

  if (state === "disconnected") {
    return <PanelDisconnected onRetry={refresh} />;
  }
  if (state === "error") {
    return (
      <PanelErrorState
        title="Permissiveness scan failed"
        error={error ?? "unknown error"}
        onRetry={refresh}
      />
    );
  }
  if ((state === "loading" || state === "idle") && !data) {
    return (
      <PanelEmptyState
        title="Scanning…"
        description="Reading ~/.openclaw/openclaw.json and ~/.hermes/profiles for live permission posture."
      />
    );
  }
  if (!data || !kpis) {
    return (
      <PanelEmptyState
        title="No permissiveness data"
        description="Scanner returned no posture data. Check /api/permissiveness health."
      />
    );
  }

  const maxDisplay =
    kpis.maxConfidence === "unknown" ? (
      <span style={{ color: C.txG, fontStyle: "italic" }}>—</span>
    ) : (
      `${kpis.maxBand.toUpperCase()} · ${kpis.maxNumeric}`
    );

  return (
    // internal reviewer 2026-05-06 chrome cleanup: drop whole-page glassChrome slab; child
    // cards carry chrome. Mission Control is the baseline.
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Panel-wide state + refresh */}
      <PanelStateBar
        state={state}
        lastUpdated={lastUpdated}
        onRefresh={async () => {
          await forceRefresh();
        }}
      />

      {/* Active profile + panel-wide confidence banner */}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          padding: "8px 10px",
          background: C.glassSurfTrans,
          border: `1px solid ${C.glassSurfBorder}`,
          borderRadius: 12,
          marginBottom: 12,
          fontSize: 11,
        }}
      >
        <span style={{ color: C.txS }}>Active profile:</span>
        {data.profiles.filter((p) => p.active).map((p) => (
          <Badge key={p.id} label={p.id} color={C.info} />
        ))}
        {data.profiles.filter((p) => !p.active).length > 0 && (
          <span style={{ color: C.txT, fontSize: 10 }}>
            +{data.profiles.filter((p) => !p.active).length} dormant profile(s)
          </span>
        )}
        <span style={{ marginLeft: "auto", color: C.txS }}>
          Panel-wide confidence:{" "}
          <span
            style={{
              color:
                data.meta.panelWideConfidence === "unknown"
                  ? C.txT
                  : data.meta.panelWideConfidence === "heuristic_inference"
                    ? C.warn
                    : C.green,
              fontFamily: F.mono,
              fontWeight: 700,
            }}
            title={KPI_TOOLTIPS.panelWideConfidence.body}
          >
            {data.meta.panelWideConfidence}
          </span>
        </span>
      </div>

      {/* Top strip KPIs */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Tooltip as="div" placement="bottom" variant="detail" content={<span>{KPI_TOOLTIPS.surfaces.body}</span>}>
          <Stat
            label={KPI_TOOLTIPS.surfaces.title}
            value={`${kpis.surfacesTotal} (${kpis.shippedSurfaces}✓ ${kpis.notIntegratedSurfaces}·)`}
            color={C.brand}
            small
          />
        </Tooltip>
        <Tooltip as="div" placement="bottom" variant="detail" content={<span>{KPI_TOOLTIPS.reachableAgents.body}</span>}>
          <Stat
            label={KPI_TOOLTIPS.reachableAgents.title}
            value={kpis.uniqueAgents}
            color={C.cyan}
            small
          />
        </Tooltip>
        <Tooltip as="div" placement="bottom" variant="detail" content={<span>{KPI_TOOLTIPS.dangerousCombos.body}</span>}>
          <Stat
            label={KPI_TOOLTIPS.dangerousCombos.title}
            value={`${kpis.evaluableCombos} eval · ${kpis.skippedCombos} skip`}
            color={kpis.evaluableCombos > 0 ? C.orange : C.txS}
            small
          />
        </Tooltip>
        <Tooltip as="div" placement="bottom" variant="detail" content={<span>{KPI_TOOLTIPS.postureLints.body}</span>}>
          <Stat
            label={KPI_TOOLTIPS.postureLints.title}
            value={kpis.lintCount}
            color={kpis.lintCount > 0 ? C.warn : C.green}
            small
          />
        </Tooltip>
        <Tooltip as="div" placement="bottom" variant="detail" content={<span>{KPI_TOOLTIPS.maxBlastRadius.body}</span>}>
          <Stat
            label={KPI_TOOLTIPS.maxBlastRadius.title}
            value={maxDisplay as unknown as string}
            color={
              kpis.maxConfidence === "unknown"
                ? C.txG
                : kpis.maxBand === "critical"
                  ? C.danger
                  : kpis.maxBand === "high"
                    ? C.orange
                    : kpis.maxBand === "medium"
                      ? C.warn
                      : C.green
            }
            small
          />
        </Tooltip>
      </div>

      {/* Heads-up banner when panel-wide confidence is unknown */}
      {data.meta.panelWideConfidence === "unknown" && (
        <Card title="" accent={C.warn}>
          <div style={{ padding: 10, fontSize: 12, color: C.txS, lineHeight: 1.5 }}>
            <strong style={{ color: C.warn }}>Some sources could not be verified.</strong> Panel-wide
            confidence collapsed to <code style={{ fontFamily: F.mono, color: C.txT }}>unknown</code> because
            at least one surface has unknown-confidence inputs. Check per-row Confidence column before
            acting on the numbers.
          </div>
        </Card>
      )}

      {/* Block B — Exposure Matrix */}
      <ExposureMatrix surfaces={data.surfaces} onDrillTo={onNavigate as ((id: string) => void) | undefined} />

      {/* Block C — Most Permissive Agents */}
      <div style={{ marginTop: 14 }}>
        <RankedAgentsTable agents={data.rankings.mostPermissiveAgents} />
      </div>

      {/* Block D — Most Exposed Surfaces */}
      <div style={{ marginTop: 14 }}>
        <RankedSurfacesTable
          surfaces={data.rankings.mostExposedSurfaces}
          onDrillTo={onNavigate as ((id: string) => void) | undefined}
        />
      </div>

      {data.hardeningRecommendations && data.hardeningRecommendations.length > 0 && (
        <Card title="Draft Hardening Actions" accent={C.orange}>
          <div style={{ display: "grid", gap: 8 }}>
            {data.hardeningRecommendations.slice(0, 6).map((rec) => (
              <div key={rec.id} style={{
                display: "grid",
                gridTemplateColumns: "1fr max-content",
                gap: 10,
                alignItems: "center",
                padding: "9px 10px",
                background: C.glassSurfTrans,
                border: `1px solid ${C.glassSurfBorder}`,
                borderRadius: 6,
              }}>
                <div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3 }}>
                    <Badge label={rec.severity} color={rec.severity === "critical" ? C.danger : rec.severity === "high" ? C.orange : C.warn} />
                    <span style={{ color: C.tx, fontSize: 13, fontWeight: 800 }}>{rec.summary}</span>
                  </div>
                  <div style={{ color: C.txS, fontSize: 12, lineHeight: 1.45 }}>{rec.rationale}</div>
                  <div style={{ color: C.txT, fontSize: 10, fontFamily: F.mono, marginTop: 3 }}>confidence {rec.confidence} · {rec.agentId}</div>
                </div>
                <button onClick={() => onNavigate?.(rec.draftAction.tabId as TabId)} style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: `1px solid ${C.cyan}55`,
                  background: `${C.cyan}16`,
                  color: C.cyan,
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: "pointer",
                }}>{rec.draftAction.label}</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Block E — Findings grid */}
      <div style={{ marginTop: 14 }}>
        <FindingsGrid
          combos={data.dangerousCombos}
          lints={data.postureLints}
          combosSuppressed={data.dangerousCombosSuppressed ?? []}
          lintsSuppressed={data.postureLintsSuppressed ?? []}
          onChange={() => forceRefresh?.()}
        />
      </div>

      {/* Footer provenance legend */}
      <ProvenanceLegend />
    </div>
  );
}
