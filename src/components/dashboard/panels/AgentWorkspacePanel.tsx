"use client";

import { useState, useEffect, useCallback } from "react";
import { C, F } from '../constants';
import { Badge, Card, EmptyState, Stat } from '../shared';
import { Tooltip } from '../tooltip';
import { timeAgo } from '../utils';
import { AGENTS_DATA } from '../mock-data';
import { stColor } from '../utils';
import type { DashboardFilters } from '../types';

// ---------------------------------------------------------------------------
// "CHANGED" dismissal — per-operator viewed timestamps in localStorage.
// Keyed by `<agentId|"shared">/<relativePath>` so each agent's files have
// independent state. Click on a file row updates the stored timestamp; the
// CHANGED badge then disappears for that file because mtime <= viewedAt.
// SSR-safe: typeof-window guard around localStorage access; failures degrade
// silently (the badge just keeps showing — no broken UI).
// ---------------------------------------------------------------------------

const VIEWED_FILES_KEY = "clawnex_workspace_viewed";

function readViewedMap(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(VIEWED_FILES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch { return {}; }
}

function writeViewedAt(viewKey: string): void {
  if (typeof window === "undefined") return;
  try {
    const map = readViewedMap();
    map[viewKey] = Date.now();
    localStorage.setItem(VIEWED_FILES_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

function viewKeyFor(agentId: string | undefined, relativePath: string): string {
  return `${agentId || "shared"}/${relativePath}`;
}

interface WsFileInfo { name: string; relativePath: string; size: number; modified: string; isDirectory: boolean; }
interface WsAgentInfo extends WsFileInfo { registry?: { name: string; codename: string; emoji: string; role: string; model: string; agentId: string; soul_path: string; notes: string } }
interface WsSummary { exists: boolean; keyFileCount: number; agentFileCount: number; totalSize: number; lastModified: string; files: WsFileInfo[] }

export function AgentWorkspacePanel({ demoMode, filters }: { demoMode: boolean; filters: DashboardFilters }) {
  const [selectedAgent, setSelectedAgent] = useState(0);
  // Bumps on every file-view to force a re-render of the CHANGED visibility
  // (cheap proxy for "the localStorage map changed" without managing it as
  // React state).
  const [viewedTick, setViewedTick] = useState(0);
  const [wsFiles, setWsFiles] = useState<WsFileInfo[]>([]);
  const [wsAgents, setWsAgents] = useState<WsAgentInfo[]>([]);
  const [wsSummary, setWsSummary] = useState<WsSummary | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileInfo, setFileInfo] = useState<WsFileInfo | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [wsLoaded, setWsLoaded] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);

  const instanceParam = filters.selectedInstance !== "all" ? filters.selectedInstance : "";
  // Track the selected agent's ID for per-agent workspace file resolution
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);

  // Fetch workspace data — scoped to the selected agent when one is chosen
  const fetchWorkspace = useCallback(async (agentId?: string) => {
    try {
      const params = new URLSearchParams();
      if (instanceParam) params.set("instance", instanceParam);
      if (agentId) params.set("agent", agentId);
      const qs = params.toString() ? `?${params}` : "";

      const [filesRes, agentsRes] = await Promise.all([
        fetch(`/api/workspace${qs}`),
        fetch(`/api/workspace/agents${instanceParam ? `?instance=${encodeURIComponent(instanceParam)}` : ""}`),
      ]);
      if (filesRes.ok) {
        const data = await filesRes.json();
        setWsFiles(data.files || []);
        setWsSummary(data);
        setWsLoaded(true);
        setWsError(null);
      }
      if (agentsRes.ok) {
        const data = await agentsRes.json();
        setWsAgents(data.agents || []);
      }
    } catch (err) {
      setWsError(err instanceof Error ? err.message : "Failed to load workspace");
    }
  }, [instanceParam]);

  useEffect(() => { if (!demoMode) fetchWorkspace(); }, [demoMode, fetchWorkspace]);

  // Set selectedAgentId when agents first load (so files resolve to the correct agent workspace)
  useEffect(() => {
    if (wsAgents.length > 0 && !selectedAgentId) {
      const firstAgentId = wsAgents[0]?.registry?.agentId;
      if (firstAgentId) setSelectedAgentId(firstAgentId);
    }
  }, [wsAgents, selectedAgentId]);

  // Fetch specific file content — scoped to the selected agent's workspace.
  // Also marks the file as viewed for the per-operator CHANGED-dismiss flow.
  const loadFile = useCallback(async (relativePath: string, agentId?: string) => {
    setLoadingFile(true);
    setFileContent(null);
    setSelectedFile(relativePath);
    writeViewedAt(viewKeyFor(agentId, relativePath));
    setViewedTick(t => t + 1);
    try {
      const params = new URLSearchParams({ path: relativePath });
      if (instanceParam) params.set("instance", instanceParam);
      if (agentId) params.set("agent", agentId);
      const res = await fetch(`/api/workspace/file?${params}`);
      if (res.ok) {
        const data = await res.json();
        setFileContent(data.content);
        setFileInfo(data.file);
      } else {
        setFileContent("Error: Could not load file");
      }
    } catch { setFileContent("Error: Failed to fetch file"); }
    finally { setLoadingFile(false); }
  }, [instanceParam]);

  // Demo mode fallback
  if (demoMode && !wsLoaded) {
    const agent = AGENTS_DATA[selectedAgent];
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
        <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
          {AGENTS_DATA.map((a, i) => (
            <button key={a.id} onClick={() => setSelectedAgent(i)} style={{
              padding: "6px 12px", borderRadius: 6, fontSize: 13, fontFamily: F.mono, cursor: "pointer",
              background: i === selectedAgent ? `${C.brand}18` : "transparent",
              border: `1px solid ${i === selectedAgent ? C.brand : C.glassBorderSubtle}`,
              color: i === selectedAgent ? C.brand : C.txS,
            }}>
              {a.name}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <Stat label="Model" value={agent.model} color={C.purp} small />
          <Stat label="Status" value={agent.status.toUpperCase()} color={stColor(agent.status)} small />
          <Stat label="Tokens" value={`${(agent.tokensUsed / 1000).toFixed(0)}K`} color={C.warn} small />
          <Stat label="Sessions" value={agent.sessions} color={C.cyan} small />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Card title="Skills" accent={C.brand}>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {agent.skills.map((s, i) => (
                <li key={i} style={{ fontSize: 13, color: C.txS, marginBottom: 4 }}>{s}</li>
              ))}
            </ul>
          </Card>
          <Card title="Permissions" accent={C.cyan}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {agent.toolPerms.map(t => <Badge key={t} label={t} color={t === "bash" ? C.danger : t === "network_scan" ? C.orange : C.info} />)}
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (wsError && !wsLoaded) return <EmptyState message={`Workspace error: ${wsError}`} />;

  // Detect drift: files modified recently AND not viewed since modification.
  // The viewed-map gate makes "CHANGED" a per-operator dismiss flow — clicking
  // a file records `viewedAt = now`, which exceeds the file's mtime, so the
  // badge stops rendering for that operator on that file. Other operators on
  // other browsers/sessions still see CHANGED until they click it themselves.
  const now = Date.now();
  const driftThresholdMs = 24 * 60 * 60 * 1000; // 24 hours
  const allFiles = [...wsFiles, ...wsAgents];
  // viewedTick is read here to make this expression a function of viewedTick
  // (so React re-evaluates `recentlyModified` after a click). The map itself
  // is read on every render — cheap for ~7 files per agent.
  void viewedTick;
  const viewedMap = readViewedMap();
  const isFileChanged = (f: { relativePath: string; modified: string }, agentId?: string): boolean => {
    if (!f.modified) return false;
    const mtime = new Date(f.modified).getTime();
    if (now - mtime >= driftThresholdMs) return false; // outside drift window
    const viewedAt = viewedMap[viewKeyFor(agentId, f.relativePath)];
    if (viewedAt && viewedAt >= mtime) return false; // already seen since change
    return true;
  };
  const recentlyModified = allFiles.filter(f => isFileChanged(f, selectedAgentId));

  const selectedAgentData = wsAgents[selectedAgent] || null;

  return (
    <div>
      {/* Summary stats */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Tooltip as="div" placement="bottom" variant="detail" content={<span><strong>Key files</strong> — the agent&apos;s identity files (SOUL, HEARTBEAT, BOOTSTRAP, IDENTITY, MEMORY, SECURITY) plus shared workflow files. These define <em>who the agent is</em> and how it behaves every time it starts up. Unexpected changes here usually mean tampering.</span>}>
          <Stat label="Key Files" value={wsSummary?.keyFileCount ?? 0} color={C.brand} small />
        </Tooltip>
        <Tooltip as="div" placement="bottom" variant="detail" content={<span><strong>Agent files</strong> — total number of files in the selected agent&apos;s workspace. Includes everything: identity files, conversation logs, tool outputs, and anything else the agent has written.</span>}>
          <Stat label="Agent Files" value={wsSummary?.agentFileCount ?? 0} color={C.cyan} small />
        </Tooltip>
        <Tooltip as="div" placement="bottom" variant="compact" content="Combined disk size of every file in the selected agent's workspace.">
          <Stat label="Total Size" value={wsSummary ? `${(wsSummary.totalSize / 1024).toFixed(1)}KB` : "0"} color={C.purp} small />
        </Tooltip>
        <Tooltip as="div" placement="bottom" variant="detail" content={<span><strong>Recent changes</strong> — files modified in the last 24 hours. Unexpected edits to the SOUL or MEMORY files are a classic <strong>cognitive-tampering</strong> tell, so they&apos;re worth investigating. The files showing a RECENTLY MODIFIED indicator below are the ones being counted.</span>}>
          <Stat label="Recent Changes" value={recentlyModified.length} color={recentlyModified.length > 0 ? C.warn : C.green} small />
        </Tooltip>
        <Tooltip as="div" placement="bottom" variant="detail" content={<span><strong>Workspace</strong> — whether this agent&apos;s workspace directory exists and is readable on disk. <strong>Not Found</strong> means OpenClaw knows about the agent but its files have gone missing — the agent will fail to boot until they&apos;re restored.</span>}>
          <Stat label="Workspace" value={wsSummary?.exists ? "Active" : "Not Found"} color={wsSummary?.exists ? C.green : C.danger} small />
        </Tooltip>
      </div>

      {/* Agent selector tabs */}
      {wsAgents.length > 0 && (
        <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
          {wsAgents.map((a, i) => {
            const isMain = a.registry?.agentId === "main";
            return (
              <button key={a.relativePath} onClick={() => {
                setSelectedAgent(i);
                const agentId = a.registry?.agentId;
                setSelectedAgentId(agentId);
                // Refetch the file list for this agent's workspace
                fetchWorkspace(agentId);
                // Load the agent's SOUL file from their workspace — use "SOUL.md"
                // not the constructed display path (which doesn't exist on disk)
                loadFile("SOUL.md", agentId);
              }} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 6, fontSize: 13, fontFamily: F.mono, cursor: "pointer",
                background: i === selectedAgent ? `${C.brand}18` : "transparent",
                border: `1px solid ${i === selectedAgent ? C.brand : C.glassBorderSubtle}`,
                color: i === selectedAgent ? C.brand : C.txS,
              }}>
                <span>{a.registry ? `${a.registry.emoji} ${a.registry.name}` : a.name.replace(/-soul\.md$/, "")}</span>
                {/* DEFAULT chip on the main tab — main is OpenClaw's persistent
                    operator workspace, the one that survives across agent
                    add/delete cycles. Visual anchor so operators don't lose it
                    among custom-named agents. */}
                {isMain && (
                  <span style={{
                    fontSize: 8, fontWeight: 700, fontFamily: F.mono,
                    color: C.green, background: `${C.green}18`,
                    border: `1px solid ${C.green}44`, borderRadius: 3,
                    padding: "1px 4px", letterSpacing: "0.06em",
                  }}>DEFAULT</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Agent stats from registry */}
      {selectedAgentData?.registry && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <Tooltip as="div" placement="bottom" variant="compact" content="Display name from the OpenClaw agent registry — what the operator calls this agent.">
            <Stat label="Agent" value={selectedAgentData.registry.name} color={C.brand} small />
          </Tooltip>
          <Tooltip as="div" placement="bottom" variant="detail" content={<span><strong>Codename</strong> — internal short identifier for the agent, separate from the display Name and the Agent ID. Used in logs and audit entries where space is tight.</span>}>
            <Stat label="Codename" value={selectedAgentData.registry.codename} color={C.cyan} small />
          </Tooltip>
          <Tooltip as="div" placement="bottom" variant="detail" content={<span><strong>Role</strong> — what this agent is for (e.g. Strategist, Researcher, Builder, Reviewer). Sourced from ClawNex&apos;s known-roles map (since OpenClaw 4.12&apos;s schema doesn&apos;t store role text); shows empty for agents not registered in that map.</span>}>
            <Stat label="Role" value={String(selectedAgentData.registry.role || "")} color={C.purp} small />
          </Tooltip>
          <Tooltip as="div" placement="bottom" variant="detail" content={<span><strong>Model</strong> — the LLM this agent is using. The provider prefix is trimmed for display; the full identifier lives in OpenClaw&apos;s config. Change it via Configuration → Default AI Model.</span>}>
            <Stat label="Model" value={selectedAgentData.registry.model.split("/").pop() || selectedAgentData.registry.model} color={C.warn} small />
          </Tooltip>
          <Tooltip as="div" placement="bottom" variant="detail" content={<span><strong>Agent ID</strong> — the canonical identifier OpenClaw uses internally. This is the value that shows up in traffic and audit log entries; grep for it when tracing this agent across logs.</span>}>
            <Stat label="Agent ID" value={selectedAgentData.registry.agentId} color={C.info} small />
          </Tooltip>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16 }}>
        {/* Left: File browser */}
        <Card title="Workspace Files" accent={C.brand}>
          <div style={{ maxHeight: 500, overflowY: "auto" }}>
            {wsFiles.filter(f => !f.isDirectory).map(f => {
              const uniqueFiles = /\bSOUL\b|HEARTBEAT|BOOTSTRAP|IDENTITY|SECURITY|MEMORY/i;
              const sharedFiles = /\bWORKFLOWS\b|AGENTS\b|RULES\b|TOOLS\b|TEAM\b|USER\b|agents-registry/i;
              const isUnique = uniqueFiles.test(f.name) || (f.relativePath.includes("agents/") && !sharedFiles.test(f.name));
              return (
              <div key={f.relativePath} onClick={() => loadFile(f.relativePath, selectedAgentId)} style={{
                padding: "8px 10px", cursor: "pointer", borderRadius: 4, marginBottom: 2,
                background: selectedFile === f.relativePath ? `${C.brand}18` : "transparent",
                border: `1px solid ${selectedFile === f.relativePath ? C.brand : "transparent"}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13, fontFamily: F.mono, color: selectedFile === f.relativePath ? C.brand : C.tx, fontWeight: selectedFile === f.relativePath ? 600 : 400, flex: 1 }}>{f.name}</span>
                  <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, fontWeight: 700, fontFamily: F.mono, letterSpacing: "0.04em", background: isUnique ? `${C.purp}18` : `${C.cyan}18`, border: `1px solid ${isUnique ? C.purp : C.cyan}33`, color: isUnique ? C.purp : C.cyan }}>{isUnique ? "UNIQUE" : "SHARED"}</span>
                </div>
                <div style={{ fontSize: 11, color: C.txT, display: "flex", gap: 8 }}>
                  <span>{(f.size / 1024).toFixed(1)}KB</span>
                  <span>{timeAgo(f.modified)}</span>
                  {isFileChanged(f, selectedAgentId) && (
                    <span style={{ color: C.warn, fontWeight: 600 }}>CHANGED</span>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        </Card>

        {/* Right: File content viewer */}
        <Card title={selectedFile ? `File: ${selectedFile}` : "Select a file"} accent={C.purp}>
          {loadingFile && <div style={{ color: C.txT, fontFamily: F.mono, fontSize: 13, padding: 20, textAlign: "center" }}>Loading...</div>}
          {!loadingFile && !fileContent && !selectedFile && (
            <div style={{ color: C.txT, fontSize: 13, padding: 20, textAlign: "center" }}>Click a file on the left to view its contents.</div>
          )}
          {!loadingFile && fileContent && (
            <div>
              {fileInfo && (() => {
                const isUnique = /\bSOUL\b|HEARTBEAT|BOOTSTRAP/i.test(fileInfo.name) || (selectedFile || "").includes("/agents/") && !(selectedFile || "").includes("/workspace/");
                return (
                <div style={{ display: "flex", gap: 12, fontSize: 11, color: C.txT, marginBottom: 10, paddingBottom: 8, borderBottom: `1px solid ${C.glassBorderSubtle}`, alignItems: "center" }}>
                  <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, fontWeight: 700, fontFamily: F.mono, background: isUnique ? `${C.purp}18` : `${C.cyan}18`, border: `1px solid ${isUnique ? C.purp : C.cyan}33`, color: isUnique ? C.purp : C.cyan }}>{isUnique ? "UNIQUE" : "SHARED"}</span>
                  <span>Size: {(fileInfo.size / 1024).toFixed(1)}KB</span>
                  <span>Modified: {fileInfo.modified ? new Date(fileInfo.modified).toLocaleString() : "--"}</span>
                  {isFileChanged({ relativePath: fileInfo.relativePath, modified: fileInfo.modified }, selectedAgentId) && (
                    <span style={{ color: C.warn, fontWeight: 600 }}>RECENTLY MODIFIED</span>
                  )}
                </div>
                );
              })()}
              <pre style={{
                fontFamily: F.mono, fontSize: 12, color: C.txS, lineHeight: 1.6, whiteSpace: "pre-wrap",
                wordBreak: "break-word", maxHeight: 420, overflowY: "auto", margin: 0, padding: 10,
                background: C.glassSurfTrans, borderRadius: 6, border: `1px solid ${C.glassBorderSubtle}`,
              }}>
                {fileContent}
              </pre>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
