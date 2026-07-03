"use client";

import { useState, useMemo, useEffect } from "react";
import { C, F } from '../constants';
import { Badge, BadgeLegend, Card, CollapsibleCard, Stat, Table, PaginationFooter, PanelStateBar, PanelEmptyState, PanelErrorState, PanelDisconnected, useDataState } from '../shared';
import { Tooltip } from '../tooltip';
import { sevColor, stColor } from '../utils';
import { TOOL_INVENTORY } from '../mock-data';
import { SkillsPluginsSection } from './SkillsPluginsSection';
import type { DashboardFilters } from '../types';
// v0.8.4+: PanelFilters for the tool inventory table. Multi-select for risk
// + type + status (status = enabled/disabled), freeform search across name +
// agentNames. Per-Agent Tool Permissions table re-uses the same URL filters
// so an operator searching "bash" sees both lists narrow simultaneously.
import { PanelFilters } from '../PanelFilters';
import { useHashState } from '../url-state';

interface ToolsApiResponse {
  globalConfig?: { profile: string; webSearchEnabled: boolean; webFetchEnabled: boolean; agentToAgentEnabled: boolean };
  toolInventory?: Array<{ name: string; type: string; risk: string; agents: number; agentNames: string[]; status: string }>;
  agentTools?: Array<{ agentId: string; agentName: string; model: string; tools: string[]; emoji?: string; role?: string }>;
  deniedTools?: string[];
  deniedToolsDetail?: Array<{ tool: string; agentName: string; agentId: string }>;
  totalTools?: number;
  totalAgents?: number;
  source?: string;
}

async function fetchToolsData(): Promise<ToolsApiResponse> {
  const res = await fetch("/api/tools");
  if (!res.ok) {
    throw new Error(`tools fetch failed: HTTP ${res.status}`);
  }
  return res.json() as Promise<ToolsApiResponse>;
}

export function ToolsAccessPanel({ demoMode, filters }: { demoMode: boolean; filters: DashboardFilters }) {
  const toolsQuery = useDataState<ToolsApiResponse>({
    fetcher: fetchToolsData,
    refreshIntervalMs: 30_000,
    staleAfterMs: 5 * 60_000,
  });
  const { data: toolData, state: toolsState, lastUpdated, error: toolsError, refresh: refreshTools } = toolsQuery;

  const hasRealData = useMemo(
    () => Boolean(toolData && toolData.toolInventory && toolData.toolInventory.length > 0),
    [toolData],
  );

  // v0.8.4: filter state from URL hash. Multi-select for risk / type / status,
  // freeform search across name + agentNames.
  const [urlState, updateUrl] = useHashState();
  const riskSel = urlState.severity ?? [];
  const typeSel = urlState.source ?? [];   // re-using source URL key for tool type
  const statusSel = urlState.status ?? [];
  const qFilter = (urlState.q ?? "").toLowerCase();
  // v0.11.5+: rule-of-5 pagination on Tool Inventory + Per-Agent tables.
  const [invPageSize, setInvPageSize] = useState(5);
  const [invPage, setInvPage] = useState(0);
  const [agentToolsPageSize, setAgentToolsPageSize] = useState(5);
  const [agentToolsPage, setAgentToolsPage] = useState(0);
  useEffect(() => { setInvPage(0); }, [riskSel, typeSel, statusSel, qFilter, invPageSize]);
  useEffect(() => { setAgentToolsPage(0); }, [agentToolsPageSize]);

  if (filters.selectedInstance === "hermes-local") {
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
        <div style={{ fontSize: 12, color: C.txS, padding: "14px 16px", background: `${C.info}08`, border: `1px solid ${C.info}22`, borderRadius: 8, marginBottom: 16, lineHeight: 1.6 }}>
          <strong style={{ color: C.info }}>&#x2139;</strong>{" "}
          Hermes tools and skills are managed via the Hermes CLI (<code style={{ fontFamily: F.mono, fontSize: 11 }}>hermes skills list</code>).
          ClawNex monitors Hermes sessions for security but does not manage Hermes skills directly.
          See <code style={{ fontFamily: F.mono, fontSize: 11 }}>~/.hermes/skills/</code> for installed skills.
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Real data from OpenClaw config */}
      {hasRealData && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            <Tooltip as="div" placement="bottom" variant="detail" content={<span>Total tools registered across all agents in OpenClaw. Includes built-in tools (file system, shell, web fetch) and custom skills/plugins. Per-agent restrictions are listed in the table below.</span>}>
              <Stat label="Tools" value={toolData!.totalTools ?? 0} color={C.brand} small />
            </Tooltip>
            <Tooltip as="div" placement="bottom" variant="compact" content="Agents with tool inventory in OpenClaw config.">
              <Stat label="Agents" value={toolData!.totalAgents ?? 0} color={C.cyan} small />
            </Tooltip>
            <Tooltip as="div" placement="bottom" variant="detail" content={<span>OpenClaw&apos;s global tool profile — controls the default tool set every agent inherits unless overridden. Common values: <strong>standard</strong>, <strong>full</strong>, <strong>restricted</strong>.</span>}>
              <Stat label="Profile" value={toolData!.globalConfig?.profile ?? "unknown"} color={C.purp} small />
            </Tooltip>
            <Tooltip as="div" placement="bottom" variant="detail" content={<span>Whether agents can issue web search queries via the built-in tool. Disable for fully air-gapped or sensitive deployments where outbound web traffic is forbidden.</span>}>
              <Stat label="Web Search" value={toolData!.globalConfig?.webSearchEnabled ? "Enabled" : "Disabled"} color={toolData!.globalConfig?.webSearchEnabled ? C.green : C.txT} small />
            </Tooltip>
            <Tooltip as="div" placement="bottom" variant="detail" content={<span>Whether agents can call other agents directly. <strong>Disabled</strong> = strict isolation (agents only talk to humans). <strong>Enabled</strong> = orchestration possible (agent A can hand off to agent B). Affects blast radius — agent-to-agent paths show up in the trust audit.</span>}>
              <Stat label="Agent-to-Agent" value={toolData!.globalConfig?.agentToAgentEnabled ? "Enabled" : "Disabled"} color={toolData!.globalConfig?.agentToAgentEnabled ? C.green : C.txT} small />
            </Tooltip>
          </div>

          {(() => {
            // v0.8.4: filter inventory client-side from URL state.
            // severity URL key → risk; source → type; status → tool status; q → search.
            const inventory = toolData!.toolInventory!;
            const uniqueRisks = Array.from(new Set(inventory.map(t => t.risk).filter(Boolean))).sort();
            const uniqueTypes = Array.from(new Set(inventory.map(t => t.type).filter(Boolean))).sort();
            const uniqueStatuses = Array.from(new Set(inventory.map(t => t.status).filter(Boolean))).sort();
            const filtered = inventory.filter(t => {
              if (riskSel.length > 0 && !riskSel.includes(t.risk)) return false;
              if (typeSel.length > 0 && !typeSel.includes(t.type)) return false;
              if (statusSel.length > 0 && !statusSel.includes(t.status)) return false;
              if (qFilter) {
                const haystack = `${t.name} ${t.type} ${t.risk} ${t.agentNames.join(" ")}`.toLowerCase();
                if (!haystack.includes(qFilter)) return false;
              }
              return true;
            });
            const invTotalPages = Math.max(1, Math.ceil(filtered.length / invPageSize));
            const pagedInventory = filtered.slice(invPage * invPageSize, (invPage + 1) * invPageSize);
            return (
              <Card title="Tool Inventory" accent={C.brand} actions={<Badge label={toolData!.source || "REAL DATA"} color={C.green} />}>
                <PanelFilters
                  config={{
                    search: { placeholder: "Search tool name, type, risk, agents…" },
                    severity: uniqueRisks,
                    source: uniqueTypes,
                    status: uniqueStatuses,
                  }}
                  values={urlState}
                  onChange={(patch) => updateUrl(patch)}
                  resultCount={filtered.length}
                  totalCount={inventory.length}
                />
                <BadgeLegend
                  title="Tool labels"
                  items={[
                    { label: "RISK", color: C.warn, description: "Relative blast-radius risk assigned to the tool or tool group." },
                    { label: "STATUS", color: C.green, description: "Whether the tool is enabled, disabled, or otherwise constrained by policy." },
                  ]}
                  style={{ marginBottom: 10 }}
                />
                <Table
                  headers={["Tool", "Type", "Risk", "Agents", "Used By", "Status"]}
                  rows={pagedInventory.map(t => [
                    <span key="n" style={{ fontWeight: 600 }}>{t.name}</span>,
                    <span key="t" style={{ color: C.txS }}>{t.type}</span>,
                    <Badge key="r" label={t.risk} color={sevColor(t.risk)} />,
                    t.agents,
                    <span key="a" style={{ fontSize: 11, color: C.txT }}>{t.agentNames.join(", ")}</span>,
                    <Badge key="s" label={t.status} color={stColor(t.status)} />,
                  ])}
                />
                {invTotalPages > 1 && (
                  <PaginationFooter
                    currentPage={invPage}
                    totalPages={invTotalPages}
                    pageSize={invPageSize}
                    totalRows={filtered.length}
                    onPageSizeChange={setInvPageSize}
                    onPageChange={setInvPage}
                  />
                )}
              </Card>
            );
          })()}

          {toolData!.agentTools && toolData!.agentTools.length > 0 && (() => {
            const agentTools = toolData!.agentTools!;
            const atTotalPages = Math.max(1, Math.ceil(agentTools.length / agentToolsPageSize));
            const pagedAgentTools = agentTools.slice(agentToolsPage * agentToolsPageSize, (agentToolsPage + 1) * agentToolsPageSize);
            return (
              <Card title="Per-Agent Tool Permissions" accent={C.purp}>
                <BadgeLegend
                  title="Permission labels"
                  items={[
                    { label: "TOOL", color: C.cyan, description: "An allowed tool or tool group available to the listed agent." },
                  ]}
                  style={{ marginBottom: 10 }}
                />
                <Table
                  headers={["Agent", "Role", "Model", "Allowed Tools"]}
                  rows={pagedAgentTools.map(a => [
                    <span key="n" style={{ fontWeight: 600 }}>{a.emoji ? `${a.emoji} ` : ""}{a.agentName}</span>,
                    <span key="r" style={{ color: C.txS, fontSize: 12 }}>{a.role || "--"}</span>,
                    <span key="m" style={{ fontSize: 11, fontFamily: F.mono, color: C.txT }}>{a.model}</span>,
                    <span key="t" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{a.tools.map(t => <Badge key={t} label={t} color={C.cyan} />)}</span>,
                  ])}
                />
                {atTotalPages > 1 && (
                  <PaginationFooter
                    currentPage={agentToolsPage}
                    totalPages={atTotalPages}
                    pageSize={agentToolsPageSize}
                    totalRows={agentTools.length}
                    onPageSizeChange={setAgentToolsPageSize}
                    onPageChange={setAgentToolsPage}
                  />
                )}
              </Card>
            );
          })()}

          {toolData!.deniedToolsDetail && toolData!.deniedToolsDetail.length > 0 && (
            <CollapsibleCard title="Denied Tools" accent={C.danger} count={toolData!.deniedToolsDetail.length}>
              <div style={{ fontSize: 13, color: C.txS, marginBottom: 10 }}>
                These tools are explicitly blocked for specific agents in the OpenClaw configuration.
              </div>
              <Table
                headers={["Tool", "Blocked For", "Type"]}
                rows={toolData!.deniedToolsDetail!.map(d => [
                  <Badge key="t" label={d.tool} color={C.danger} />,
                  <span key="a" style={{ fontSize: 12 }}>{d.agentName}</span>,
                  <span key="type" style={{ fontSize: 11, color: C.txT }}>{d.tool.startsWith('group:') ? 'Tool Group' : 'Individual Tool'}</span>,
                ])}
              />
            </CollapsibleCard>
          )}
        </>
      )}

      {!hasRealData && !demoMode && (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <PanelStateBar state={toolsState} lastUpdated={lastUpdated} onRefresh={refreshTools} />
          </div>
          {toolsState === "disconnected" && (
            <PanelDisconnected onRetry={refreshTools} lastSeen={lastUpdated} />
          )}
          {toolsState === "error" && (
            <PanelErrorState
              title="Couldn't load tool data"
              error={toolsError || "Unknown error loading tool inventory."}
              onRetry={refreshTools}
              hint="The /api/tools route backs this panel. Check server logs if this keeps failing."
            />
          )}
          {(toolsState === "ready" || toolsState === "refreshing" || toolsState === "stale") && (
            <PanelEmptyState
              title="No tool inventory yet"
              description="ClawNex couldn't find any tool data from the OpenClaw configuration. Either no agents are registered yet, or OpenClaw hasn't synced tool permissions. Enable an agent and register its tools in OpenClaw, then refresh."
              actionLabel="Refresh"
              onAction={refreshTools}
            />
          )}
          {(toolsState === "loading" || toolsState === "idle") && (
            <PanelEmptyState
              title="Loading tool data…"
              description="Fetching the current tool inventory from OpenClaw. This should only take a moment."
            />
          )}
        </>
      )}

      {/* Demo data */}
      {demoMode && (
        <Card title="Demo: Tool Inventory" accent={C.txT} actions={<Badge label="DEMO" color={C.txT} />}>
          <Table
            headers={["Tool", "Type", "Risk", "Agents", "Executions", "Status"]}
            rows={TOOL_INVENTORY.map(t => [
              <span key="n" style={{ fontWeight: 600 }}>{t.name}</span>,
              <span key="t" style={{ color: C.txS }}>{t.type}</span>,
              <Badge key="r" label={t.risk} color={sevColor(t.risk)} />,
              t.agents,
              <span key="e" style={{ color: t.executions > 1000 ? C.warn : C.txS }}>{t.executions.toLocaleString()}</span>,
              <Badge key="s" label={t.status} color={stColor(t.status)} />,
            ])}
          />
        </Card>
      )}

      {/* Skills & Plugins */}
      <SkillsPluginsSection />
    </div>
  );
}
