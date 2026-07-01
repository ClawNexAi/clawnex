"use client";

import { useState, useEffect, useCallback } from "react";
import { C, F } from '../constants';
import { Badge, Card, CollapsibleCard, EmptyState, Fresh, LoadingSpinner, PaginationFooter, Stat, Table } from '../shared';
import { Tooltip } from '../tooltip';
import { stColor } from '../utils';
import type { TabId, DashboardFilters, AgentData } from '../types';
import { AGENTS_DATA } from '../mock-data';
// v0.8.4+: PanelFilters + URL state. Multi-select for status / model /
// role + freeform search across name + codename + tools. Refresh /
// back-button preserve view; deep-links to a specific agent name (id key)
// pin the list to that single card.
import { PanelFilters } from '../PanelFilters';
import { useHashState } from '../url-state';

// OpenClaw 4.12+ gateway returns several fields as either a plain string or
// a structured object. Coerce defensively to a single string-or-undefined
// for filter/render. Returning undefined when the field isn't usable keeps
// `[object Object]` out of the UI and out of any filter dropdowns.
//
// Used for `role` (which can come back as `{ name, scopes }`) and `model`
// (which can come back as `{ id, ... }` on some gateway code paths).
function coerceToString(raw: unknown, ...keys: string[]): string | undefined {
  if (typeof raw === "string" && raw.trim() !== "") return raw;
  if (raw && typeof raw === "object") {
    for (const k of keys) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === "string" && v.trim() !== "") return v;
    }
  }
  return undefined;
}
const coerceRoleString = (raw: unknown) => coerceToString(raw, "name");
const coerceModelString = (raw: unknown) => coerceToString(raw, "id", "name", "model");

export function AgentsSessionsPanel({ filters, demoMode, onNavigate }: { filters: DashboardFilters; demoMode: boolean; onNavigate: (tab: TabId) => void }) {
  const [apiAgents, setApiAgents] = useState<AgentData[] | null>(null);
  const [source, setSource] = useState("loading");
  // v0.11.5+: rule-of-5 pagination on the Agents card grid.
  const [agentsPageSize, setAgentsPageSize] = useState(5);
  const [agentsPage, setAgentsPage] = useState(0);
  const [urlState, updateUrl] = useHashState();
  const statusSel = urlState.status ?? [];
  const modelSel = urlState.scope ?? [];   // re-using scope URL key for model
  const roleSel = urlState.actor ?? [];    // re-using actor URL key for role (the agent's "actor" function)
  const qFilter = (urlState.q ?? "").toLowerCase();
  const deepLinkId = urlState.id;
  useEffect(() => { setAgentsPage(0); }, [statusSel, modelSel, roleSel, qFilter, deepLinkId, agentsPageSize]);

  const fetchAgents = useCallback(async () => {
    try {
      const instanceParam = filters.selectedInstance !== "all" ? `?instance=${encodeURIComponent(filters.selectedInstance)}` : "";
      const res = await fetch(`/api/agents${instanceParam}`);
      if (res.ok) { const data = await res.json(); setApiAgents(data.agents || []); setSource(data.source || "unknown"); }
      else { setApiAgents([]); setSource("error"); }
    } catch { setApiAgents([]); setSource("error"); }
  }, [filters.selectedInstance]);

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 30000);
    return () => clearInterval(interval);
  }, [fetchAgents]);

  return (
    // internal reviewer 2026-05-06 chrome cleanup: drop whole-page glassChrome slab; child
    // cards carry chrome. Mission Control is the baseline.
    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Tooltip as="div" placement="bottom" variant="detail" content={
          <span>
            Agents the registry currently knows about. Pulled live every 30s from whichever backend <em>API Source</em> names on the right &mdash; OpenClaw when the gateway is connected, local filesystem when it isn&apos;t.
          </span>
        }>
          <Stat label="API Agents" value={apiAgents?.length ?? 0} color={C.brand} small />
        </Tooltip>
        <Tooltip as="div" placement="bottom" variant="detail" content={
          <span>
            Where the agent list is coming from right now:
            <ul style={{ margin: "4px 0 0 0", paddingLeft: 18 }}>
              <li><strong>openclaw</strong> — live fetch from the ClawNex gateway (preferred).</li>
              <li><strong>local-filesystem</strong> — fallback scan of agent session logs on disk.</li>
              <li><strong>error</strong> — both paths failed; check Infrastructure logs for the cause.</li>
            </ul>
          </span>
        }>
          <Stat label="API Source" value={source} color={source === "openclaw" ? C.green : C.txT} small />
        </Tooltip>
      </div>

      {/* Live API agents */}
      {apiAgents === null && !demoMode && <LoadingSpinner />}
      {(() => {
        if (!apiAgents || apiAgents.length === 0) return null;
        // v0.8.4: derive option lists + apply URL-state filters client-side.
        const uniqueStatuses = Array.from(new Set(apiAgents.map(a => a.status).filter(Boolean) as string[])).sort();
        const uniqueModels = Array.from(new Set(apiAgents.map(a => coerceModelString(a.model) || "").filter(Boolean))).sort();
        const uniqueRoles = Array.from(new Set(apiAgents.map(a => coerceRoleString((a as Record<string, unknown>).role)).filter(Boolean) as string[])).sort();
        const filteredAgents = apiAgents.filter(a => {
          if (deepLinkId && a.id !== deepLinkId && a.name !== deepLinkId) return false;
          if (statusSel.length > 0 && (!a.status || !statusSel.includes(a.status))) return false;
          const modelStr = coerceModelString(a.model);
          if (modelSel.length > 0 && (!modelStr || !modelSel.includes(modelStr))) return false;
          const role = coerceRoleString((a as Record<string, unknown>).role);
          if (roleSel.length > 0 && (!role || !roleSel.includes(role))) return false;
          if (qFilter) {
            const codename = (a as Record<string, unknown>).codename as string | undefined;
            const tools = (a as Record<string, unknown>).tools as string[] | undefined;
            const haystack = `${a.name ?? ""} ${a.id} ${codename ?? ""} ${role ?? ""} ${(tools ?? []).join(" ")}`.toLowerCase();
            if (!haystack.includes(qFilter)) return false;
          }
          return true;
        });
        const agentsTotalPages = Math.max(1, Math.ceil(filteredAgents.length / agentsPageSize));
        const pagedAgents = filteredAgents.slice(agentsPage * agentsPageSize, (agentsPage + 1) * agentsPageSize);
        return (
        <CollapsibleCard title="Agents" count={filteredAgents.length} accent={C.brand} actions={<><Badge label={source} color={source === "local-filesystem" ? C.cyan : source === "openclaw" ? C.green : C.txT} /><Fresh /></>}>
          <PanelFilters
            config={{
              search: { placeholder: "Search agent name, codename, role, tools…" },
              status: uniqueStatuses,
              scope: uniqueModels,
              actor: uniqueRoles,
            }}
            values={urlState}
            onChange={(patch) => updateUrl(patch)}
            resultCount={filteredAgents.length}
            totalCount={apiAgents.length}
            showIdBadge
          />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
            {pagedAgents.map(a => {
              const emoji = (a as Record<string, unknown>).emoji as string | undefined;
              const role = coerceRoleString((a as Record<string, unknown>).role);
              const codename = (a as Record<string, unknown>).codename as string | undefined;
              const tools = (a as Record<string, unknown>).tools as string[] | undefined;
              return (
                <div key={a.id} style={{ background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, borderRadius: 8, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>
                      {emoji ? `${emoji} ` : ""}{a.name || a.id}
                      {codename ? <span style={{ fontSize: 11, color: C.txT, fontWeight: 400 }}> ({codename})</span> : ""}
                    </span>
                    {a.status && <Badge label={a.status} color={stColor(a.status)} />}
                  </div>
                  {role && <div style={{ fontSize: 12, color: C.brand, marginBottom: 4 }}>{role}</div>}
                  {coerceModelString(a.model) && <div style={{ fontSize: 11, color: C.txS, fontFamily: F.mono, marginBottom: 4 }}>{coerceModelString(a.model)}</div>}
                  {tools && tools.length > 0 && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                      {tools.map(t => <span key={t} style={{ fontSize: 10, padding: "1px 6px", background: `${C.purp}14`, border: `1px solid ${C.purp}28`, borderRadius: 3, color: C.purp, fontFamily: F.mono }}>{t}</span>)}
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                    <button onClick={() => onNavigate("workspace")} style={{ background: "none", border: "none", color: C.info, fontSize: 11, fontWeight: 600, fontFamily: F.sans, cursor: "pointer", padding: 0 }}>Workspace {"\u2192"}</button>
                  </div>
                </div>
              );
            })}
          </div>
          {agentsTotalPages > 1 && (
            <PaginationFooter
              currentPage={agentsPage}
              totalPages={agentsTotalPages}
              pageSize={agentsPageSize}
              totalRows={filteredAgents.length}
              onPageSizeChange={setAgentsPageSize}
              onPageChange={setAgentsPage}
            />
          )}
        </CollapsibleCard>
        );
      })()}
      {apiAgents !== null && apiAgents.length === 0 && !demoMode && (
        <EmptyState message="No agents found. OpenClaw gateway may be offline." />
      )}

      {/* Demo data only when demoMode is on */}
      {demoMode && (
        <Card title="Demo Agent Registry" accent={C.txT} actions={<Badge label="DEMO" color={C.txT} />}>
          <Table
            headers={["Agent", "Model", "Status", "Sessions", "Tokens Used", "Tools", "Risk"]}
            rows={AGENTS_DATA.map(a => [
              <span key="n" style={{ fontWeight: 600 }}>{a.name}</span>,
              <span key="m" style={{ fontSize: 14, color: C.txS }}>{a.model}</span>,
              <Badge key="s" label={a.status} color={stColor(a.status)} />,
              a.sessions,
              <span key="t" style={{ color: a.tokensUsed > 800000 ? C.warn : C.txS }}>{(a.tokensUsed / 1000).toFixed(0)}K</span>,
              <span key="tl" style={{ fontSize: 10 }}>{a.toolPerms.join(", ")}</span>,
              <Badge key="r" label={a.toolPerms.includes("bash") ? "HIGH" : "MEDIUM"} color={a.toolPerms.includes("bash") ? C.orange : C.warn} />,
            ])}
          />
        </Card>
      )}
    </div>
  );
}
