"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
// v0.8.4+: filter the configured-models table by provider / type with
// freeform search across model id + name. Same PanelFilters + URL state
// pattern as v0.8.2/0.8.3 panels.
import { PanelFilters } from "../PanelFilters";
import { useHashState } from "../url-state";
import { C, F } from '../constants';
import { Badge, Card, CollapsibleCard, EmptyState, Fresh, LoadingSpinner, Table } from '../shared';
import type { ModelData, DashboardFilters } from '../types';
import { MODELS } from '../mock-data';

// Pagination footer — styled identically to CostBySessionCard.
// Hidden when totalPages <= 1 so small cards (e.g. AGENT-MAIN with 1 model)
// don't show useless pagination chrome. See operator UX directive 2026-05-04.
function PaginationFooter({
  pageSize,
  setPageSize,
  currentPage,
  setCurrentPage,
  totalPages,
}: {
  pageSize: number;
  setPageSize: (n: number) => void;
  currentPage: number;
  setCurrentPage: (updater: (p: number) => number) => void;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.glassBorderSubtle}` }}>
      <span style={{ fontSize: 11, color: C.txT, fontFamily: F.mono }}>
        Page {currentPage + 1} of {totalPages}
      </span>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <button onClick={() => setCurrentPage(p => Math.max(0, p - 1))} disabled={currentPage === 0} style={{ padding: "3px 8px", borderRadius: 3, border: `1px solid ${C.glassBorderSubtle}`, background: "transparent", color: currentPage === 0 ? C.txG : C.txS, fontSize: 11, fontFamily: F.mono, cursor: currentPage === 0 ? "not-allowed" : "pointer" }}>{"‹"}</button>
        <button onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))} disabled={currentPage >= totalPages - 1} style={{ padding: "3px 8px", borderRadius: 3, border: `1px solid ${C.glassBorderSubtle}`, background: "transparent", color: currentPage >= totalPages - 1 ? C.txG : C.txS, fontSize: 11, fontFamily: F.mono, cursor: currentPage >= totalPages - 1 ? "not-allowed" : "pointer" }}>{"›"}</button>
        <select value={String(pageSize)} onChange={e => setPageSize(parseInt(e.target.value))} style={{ fontSize: 11, padding: "2px 6px", background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderRadius: 3, color: C.txS, fontFamily: F.mono, cursor: "pointer", outline: "none" }}>
          <option value="5">5</option>
          <option value="10">10</option>
          <option value="15">15</option>
          <option value="25">25</option>
          <option value="50">50</option>
        </select>
      </div>
    </div>
  );
}

// Per-provider sub-card — extracted so each provider gets independent
// pagination state. operator observed LM STUDIO FLEET (52) overflowing on
// 2026-05-04; pagination matches the Cost by Session + Recent Events pattern.
function ProviderModelsCard({ provider, models }: { provider: string; models: ModelData[] }) {
  const [pageSize, setPageSize] = useState(5);
  const [currentPage, setCurrentPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(models.length / pageSize));
  const pagedModels = models.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  // Reset to page 0 when pageSize changes so the user doesn't land off-page.
  useEffect(() => { setCurrentPage(0); }, [pageSize]);

  return (
    <CollapsibleCard title={provider} accent={C.cyan} count={models.length} defaultOpen={false}>
      <Table
        headers={["Model", "Source", "Routing", "Context", "Reasoning"]}
        rows={pagedModels.map(m => [
          <span key="n" style={{ fontSize: 10 }}>{m.name}</span>,
          <Badge key="src" label={m.source} color={C.purp} />,
          <Badge key="r" label={m.routing} color={m.routing === "Local" ? C.green : C.cyan} />,
          m.contextWindow ? `${(m.contextWindow / 1000).toFixed(0)}K` : "--",
          m.reasoning ? <Badge key="reason" label="Yes" color={C.brand} /> : <span key="no" style={{ color: C.txT }}>--</span>,
        ])}
      />
      <PaginationFooter
        pageSize={pageSize}
        setPageSize={setPageSize}
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        totalPages={totalPages}
      />
    </CollapsibleCard>
  );
}

export function ModelsCostPanel({ demoMode, filters }: { demoMode: boolean; filters: DashboardFilters }) {
  const [apiModels, setApiModels] = useState<ModelData[] | null>(null);
  const [configModels, setConfigModels] = useState<Array<{ model_id: string; name: string; provider_name: string; provider_type: string; context_window: number; supports_reasoning: number }>>([]);
  // v0.8.4: filter state from URL hash. actor URL key carries provider name,
  // source URL key carries provider type (lmstudio/openai-compatible/etc).
  const [urlState, updateUrl] = useHashState();
  const providerSel = urlState.actor ?? [];
  const typeSel = urlState.source ?? [];
  const qFilter = (urlState.q ?? "").toLowerCase();

  // Pagination state — Configured Models card (top-level, kept defaultOpen=true).
  const [configPageSize, setConfigPageSize] = useState(5);
  const [configCurrentPage, setConfigCurrentPage] = useState(0);

  // Pagination state — Demo: Model Performance & Cost card.
  const [demoPageSize, setDemoPageSize] = useState(5);
  const [demoCurrentPage, setDemoCurrentPage] = useState(0);

  // Reset Configured Models page when its size changes.
  useEffect(() => { setConfigCurrentPage(0); }, [configPageSize]);
  // Reset Demo page when its size changes.
  useEffect(() => { setDemoCurrentPage(0); }, [demoPageSize]);

  const fetchModels = useCallback(async () => {
    try {
      const [apiRes, cfgRes] = await Promise.allSettled([
        fetch("/api/models"),
        fetch("/api/config/models"),
      ]);
      if (apiRes.status === "fulfilled" && apiRes.value.ok) { const data = await apiRes.value.json(); setApiModels(data.models || []); }
      if (cfgRes.status === "fulfilled" && cfgRes.value.ok) { const data = await cfgRes.value.json(); setConfigModels(data.models || []); }
    } catch {}
  }, []);

  useEffect(() => {
    fetchModels();
    const interval = setInterval(fetchModels, 60000);
    return () => clearInterval(interval);
  }, [fetchModels]);

  // Group API models by provider
  const groupedModels = useMemo(() => {
    const groups: Record<string, ModelData[]> = {};
    for (const m of (apiModels || [])) {
      const key = m.provider || "unknown";
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    }
    return groups;
  }, [apiModels]);

  if (filters.selectedInstance === "hermes-local") {
    // Hermes-branch Configured Models pagination — independent state from the
    // generic-branch counterpart so they don't share pagination across views.
    const hermesTotalPages = Math.max(1, Math.ceil(configModels.length / configPageSize));
    const hermesPagedModels = configModels.slice(configCurrentPage * configPageSize, (configCurrentPage + 1) * configPageSize);
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
        <Card title="Hermes Model Configuration" accent={C.brand}>
          <p style={{ fontSize: 12, color: C.txT, margin: "0 0 12px", lineHeight: 1.6 }}>
            Hermes routes through OpenRouter directly — not through the LiteLLM proxy. Model and provider settings are managed via <code style={{ fontFamily: F.mono, fontSize: 11, color: C.cyan }}>~/.hermes/config.yaml</code>.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
            <div style={{ padding: "10px 12px", background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderRadius: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.txT, fontFamily: F.mono, letterSpacing: "0.05em" }}>DEFAULT MODEL</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.brand, fontFamily: F.mono, marginTop: 4 }}>openai/gpt-5.4</div>
            </div>
            <div style={{ padding: "10px 12px", background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderRadius: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.txT, fontFamily: F.mono, letterSpacing: "0.05em" }}>PROVIDER</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.cyan, fontFamily: F.mono, marginTop: 4 }}>OpenRouter</div>
              <div style={{ fontSize: 11, color: C.txT, marginTop: 2 }}>openrouter.ai/api/v1</div>
            </div>
            <div style={{ padding: "10px 12px", background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderRadius: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.txT, fontFamily: F.mono, letterSpacing: "0.05em" }}>API MODE</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.purp, fontFamily: F.mono, marginTop: 4 }}>chat_completions</div>
            </div>
          </div>
        </Card>

        {configModels.length > 0 && (
        <CollapsibleCard title="Configured Models" accent={C.info} count={configModels.length} defaultOpen={true}>
          {hermesPagedModels.map(m => (
            <div key={m.model_id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", marginBottom: 4, background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderRadius: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: C.tx, flex: 1 }}>{m.model_id}</span>
              <span style={{ fontSize: 11, color: C.txT }}>{m.provider_name}</span>
              <Badge label={m.provider_type} color={C.purp} />
            </div>
          ))}
          <PaginationFooter
            pageSize={configPageSize}
            setPageSize={setConfigPageSize}
            currentPage={configCurrentPage}
            setCurrentPage={setConfigCurrentPage}
            totalPages={hermesTotalPages}
          />
        </CollapsibleCard>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Configured models — top position. v0.8.4: filter row above the table. */}
      {configModels.length > 0 && (() => {
        const uniqueProviders = Array.from(new Set(configModels.map(m => m.provider_name).filter(Boolean))).sort();
        const uniqueTypes = Array.from(new Set(configModels.map(m => m.provider_type).filter(Boolean))).sort();
        const filtered = configModels.filter(m => {
          if (providerSel.length > 0 && !providerSel.includes(m.provider_name)) return false;
          if (typeSel.length > 0 && !typeSel.includes(m.provider_type)) return false;
          if (qFilter) {
            const haystack = `${m.model_id} ${m.name ?? ""} ${m.provider_name} ${m.provider_type}`.toLowerCase();
            if (!haystack.includes(qFilter)) return false;
          }
          return true;
        });
        // Configured Models pagination — kept defaultOpen=true (operator directive:
        // first card stays expanded; subsequent provider cards collapse).
        const configTotalPages = Math.max(1, Math.ceil(filtered.length / configPageSize));
        const configPagedRows = filtered.slice(configCurrentPage * configPageSize, (configCurrentPage + 1) * configPageSize);
        return (
        <CollapsibleCard title="Configured Models" accent={C.brand} count={filtered.length} actions={<Fresh />}>
          <PanelFilters
            config={{
              search: { placeholder: "Search model id, name, provider…" },
              actor: uniqueProviders,   // re-using actor URL key for provider name
              source: uniqueTypes,      // re-using source URL key for provider type (lmstudio/openai-compatible/openclaw)
            }}
            values={urlState}
            onChange={(patch) => updateUrl(patch)}
            resultCount={filtered.length}
            totalCount={configModels.length}
          />
          <Table
            headers={["Model ID", "Name", "Provider", "Type", "Context", "Reasoning"]}
            rows={configPagedRows.map(m => [
              <span key="mid" style={{ fontSize: 10 }}>{m.model_id}</span>,
              m.name || "--",
              m.provider_name,
              <Badge key="t" label={m.provider_type} color={C.purp} />,
              m.context_window ? `${(m.context_window / 1000).toFixed(0)}K` : "--",
              m.supports_reasoning ? <Badge key="r" label="Yes" color={C.brand} /> : <span key="no" style={{ color: C.txT }}>--</span>,
            ])}
          />
          <PaginationFooter
            pageSize={configPageSize}
            setPageSize={setConfigPageSize}
            currentPage={configCurrentPage}
            setCurrentPage={setConfigCurrentPage}
            totalPages={configTotalPages}
          />
        </CollapsibleCard>
        );
      })()}

      {/* Live API models by provider */}
      {apiModels === null && !demoMode && <LoadingSpinner />}
      {apiModels && apiModels.length > 0 && (
        <>
          {Object.entries(groupedModels).map(([provider, models]) => (
            <ProviderModelsCard key={provider} provider={provider} models={models} />
          ))}
        </>
      )}

      {apiModels !== null && apiModels.length === 0 && configModels.length === 0 && !demoMode && (
        <EmptyState message="No models found. Connect OpenClaw or LM Studio, or add providers in Configuration." />
      )}

      {/* Demo data */}
      {demoMode && (() => {
        const demoTotalPages = Math.max(1, Math.ceil(MODELS.length / demoPageSize));
        const demoPagedModels = MODELS.slice(demoCurrentPage * demoPageSize, (demoCurrentPage + 1) * demoPageSize);
        return (
          <CollapsibleCard title="Demo: Model Performance & Cost" accent={C.txT} actions={<Badge label="DEMO" color={C.txT} />}>
            <Table
              headers={["Model", "Provider", "Routing", "Latency", "Cost/mo", "Context", "P95", "Tok/sec"]}
              rows={demoPagedModels.map(m => [
                <span key="n" style={{ fontWeight: 600 }}>{m.name}</span>,
                <span key="p" style={{ color: C.txS }}>{m.provider}</span>,
                <Badge key="r" label={m.routing} color={m.routing === "Local" ? C.green : C.cyan} />,
                m.latency,
                <span key="c" style={{ color: m.cost === "$0" ? C.green : C.warn }}>{m.cost}</span>,
                m.ctxWindow,
                <span key="p95" style={{ color: C.txS }}>{m.p95}ms</span>,
                m.tokPerSec,
              ])}
            />
            <PaginationFooter
              pageSize={demoPageSize}
              setPageSize={setDemoPageSize}
              currentPage={demoCurrentPage}
              setCurrentPage={setDemoCurrentPage}
              totalPages={demoTotalPages}
            />
          </CollapsibleCard>
        );
      })()}
    </div>
  );
}
