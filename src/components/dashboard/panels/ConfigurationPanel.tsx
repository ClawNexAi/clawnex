"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { C, F } from "../constants";
import { Badge, BadgeLegend, Dot, CollapsibleCard, CategorySection, LoadingSpinner, PaginationFooter, formatTimeAgo, useStickyBoolean } from "../shared";
import { Tooltip } from "../tooltip";
import { timeAgo } from "../utils";
import type { TabId } from "../types";
import { CORRELATION_STARTER_TEMPLATES } from "@/lib/correlation-templates";
import { AuthDevicesCard } from "./AuthDevicesCard";
import { AuthMethodsCard } from "./AuthMethodsCard";
import { PoliciesAndRulesCard } from "./PoliciesAndRulesCard";
import { ConfirmDialog } from "../ConfirmDialog";
import { MissionControlBreadcrumb } from "./mission-control/MissionControlBreadcrumb";

// ---------------------------------------------------------------------------
// Password strength helper
// ---------------------------------------------------------------------------

function getPasswordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 1) return { score, label: 'Weak', color: '#f43f5e' };
  if (score <= 2) return { score, label: 'Fair', color: '#fbbf24' };
  if (score <= 3) return { score, label: 'Good', color: '#38bdf8' };
  return { score, label: 'Strong', color: '#00e5a0' };
}

// ---------------------------------------------------------------------------
// Panel-local types
// ---------------------------------------------------------------------------

interface ModelProvider {
  id: string;
  name: string;
  type: "lmstudio" | "openai-compatible" | "openclaw";
  baseUrl: string;
  apiKey: string;
  models: string[];
  isDefault?: boolean;
}

interface GatewayInstance {
  id: string;
  name: string;
  url: string;
  token: string;
  status: "connected" | "disconnected" | "error" | "unknown";
  isPrimary?: boolean;
  lastError?: string | null;
  clientName?: string;
}

interface HermesDiagnostics {
  home: string;
  stateDbPath: string;
  installed: boolean;
  stateDbExists: boolean;
  stateDbReadable: boolean;
  schemaOk: boolean;
  available: boolean;
  status: string;
  statusDetail: string | null;
  activeProfile: string | null;
  profiles: { count: number; names: string[] };
  channels: { configured: string[]; observed: string[] };
  skills: { count: number; profilesWithSkills: number };
  tools: { count: number; names: string[]; profilesWithTools: number };
  sessions: { total: number; last24h: number };
  messages: { total: number; last24h: number; lastId: number };
  lastActivity: string | null;
  lastActivityAgeSeconds: number | null;
  watcher: { enabled: boolean; pollIntervalMs: number };
  shieldVisibility: { enabled: boolean; mode: string };
}

interface HermesInstanceConfig {
  id: string;
  name: string;
  home_path: string;
  is_active: number;
  status: string;
  available: boolean;
  statusDetail?: string | null;
  session_count: number;
  diagnostics?: HermesDiagnostics | null;
}

function normalizeHermesPathKey(value?: string | null): string {
  return (value || "").trim().replace(/\/+$/, "");
}

function hermesStateDbFromHome(homePath?: string | null): string {
  const home = normalizeHermesPathKey(homePath);
  return home ? `${home}/state.db` : "";
}

function hermesInstanceMatchesDiagnostics(inst: HermesInstanceConfig, diag: HermesDiagnostics | null | undefined): boolean {
  if (!diag) return false;
  const instHome = normalizeHermesPathKey(inst.diagnostics?.home || inst.home_path);
  const diagHome = normalizeHermesPathKey(diag.home);
  const instStateDb = normalizeHermesPathKey(inst.diagnostics?.stateDbPath || hermesStateDbFromHome(inst.home_path));
  const diagStateDb = normalizeHermesPathKey(diag.stateDbPath);

  return (!!instHome && instHome === diagHome) || (!!instStateDb && instStateDb === diagStateDb);
}

// ---------------------------------------------------------------------------
// Break-Glass Components
// ---------------------------------------------------------------------------

interface BreakGlassStatus {
  active: boolean;
  activated_at: string | null;
  expires_at: string | null;
  remaining_seconds: number | null;
  reason: string | null;
  duration_minutes: number | null;
  cool_down_remaining_seconds: number;
}

function useBreakGlassStatus() {
  const [status, setStatus] = useState<BreakGlassStatus | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch("/api/break-glass/status");
      if (res.ok) setStatus(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetch_();
    const iv = setInterval(fetch_, 5000);
    return () => clearInterval(iv);
  }, [fetch_]);

  return { status, refresh: fetch_ };
}

export function BreakGlassBanner() {
  const { status, refresh } = useBreakGlassStatus();
  const [countdown, setCountdown] = useState<number | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  const countdownInitRef = useRef(false);
  useEffect(() => {
    if (!status?.active || !status.remaining_seconds) {
      setCountdown(null);
      countdownInitRef.current = false;
      return;
    }
    if (countdownInitRef.current) return; // already running
    countdownInitRef.current = true;
    setCountdown(status.remaining_seconds);
    const iv = setInterval(() => {
      setCountdown(prev => {
        if (prev === null || prev <= 0) { clearInterval(iv); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [status?.active, status?.remaining_seconds]);

  if (!status?.active) return null;

  const mins = Math.floor((countdown || 0) / 60);
  const secs = (countdown || 0) % 60;

  const handleDeactivate = async () => {
    setDeactivating(true);
    try {
      await fetch("/api/break-glass/deactivate", { method: "POST" });
      refresh();
    } catch {} finally { setDeactivating(false); }
  };

  return (
    <div style={{
      padding: "12px 16px", marginBottom: 16, borderRadius: 8,
      background: `${C.danger}1f`, border: `1px solid ${C.danger}`,
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
    }}>
      <span style={{ fontSize: 16 }}>{"\u26A0\uFE0F"}</span>
      <span style={{ fontSize: 13, fontWeight: 800, color: C.danger, fontFamily: F.sans, letterSpacing: "0.05em" }}>BREAK-GLASS ACTIVE</span>
      <span style={{ fontSize: 12, color: C.txS }}>Shield bypass enabled. Traffic is unscanned.</span>
      <span style={{ fontSize: 12, color: C.txT, fontStyle: "italic" }}>{status.reason}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: C.warn, fontFamily: F.mono, marginLeft: "auto" }}>
        {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
      </span>
      <button onClick={handleDeactivate} disabled={deactivating} style={{
        padding: "6px 14px", borderRadius: 6, border: `1px solid ${C.danger}`,
        background: "transparent", color: C.danger, fontSize: 12, fontWeight: 700,
        fontFamily: F.sans, cursor: deactivating ? "not-allowed" : "pointer",
      }}>
        {deactivating ? "Deactivating..." : "Deactivate Now"}
      </button>
    </div>
  );
}

function BreakGlassDialog({ onClose, onActivated }: { onClose: () => void; onActivated: () => void }) {
  // SSR-safe portal mount guard — same pattern as the policy-framework modals.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState(30);
  const [confirmText, setConfirmText] = useState("");
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canActivate = confirmText === "CONFIRM" && reason.trim().length >= 10 && !activating;

  const handleActivate = async () => {
    if (!canActivate) return;
    setActivating(true);
    setError(null);
    try {
      const res = await fetch("/api/break-glass/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim(), duration_minutes: duration }),
      });
      if (res.ok) { onActivated(); onClose(); }
      else {
        const data = await res.json();
        setError(data.error || "Activation failed");
      }
    } catch { setError("Network error"); }
    finally { setActivating(false); }
  };

  // Portal-render so position:fixed escapes any ancestor stacking-context trap.
  // Backdrop changed from ${C.bg}cc (page color over page color = invisible) to
  // rgba(0,0,0,0.65) so operators actually see the page dim during break-glass.
  if (!mounted) return null;
  return createPortal(
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
      background: "rgba(4,7,14,0.65)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 480, maxWidth: "90vw",
        background: `linear-gradient(135deg, ${C.glassPanel} 0%, ${C.glassPanel2} 100%)`,
        borderRadius: 16,
        border: `1px solid ${C.glassBorderCyan}`, borderTop: `3px solid ${C.danger}`, padding: 24,
        boxShadow: C.glassShadow,
      }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.danger, marginBottom: 4, fontFamily: F.disp }}>{"\u26A0\uFE0F"} Break-Glass Activation</div>
        <div style={{ fontSize: 12, color: C.txS, marginBottom: 16, lineHeight: 1.5 }}>
          You are about to bypass the ClawNex Prompt Shield. All LLM traffic will flow unscanned for the selected duration.
          This action is fully audited and generates a CRITICAL alert.
        </div>

        {/* Reason */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.txT, textTransform: "uppercase", letterSpacing: "0.05em" }}>Reason (required, min 10 chars)</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is break-glass needed?"
            style={{
              width: "100%", marginTop: 4, padding: "8px 10px", minHeight: 60, resize: "vertical",
              background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6,
              color: C.tx, fontFamily: F.mono, fontSize: 12, outline: "none", boxSizing: "border-box",
            }}
          />
        </div>

        {/* Duration */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.txT, textTransform: "uppercase", letterSpacing: "0.05em" }}>Duration</label>
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            {[15, 30, 60, 120, 240].map(d => (
              <button key={d} onClick={() => setDuration(d)} style={{
                padding: "6px 12px", borderRadius: 4, fontSize: 12, fontFamily: F.mono, fontWeight: 600,
                border: `1px solid ${duration === d ? C.danger : C.glassBorderSubtle}`,
                background: duration === d ? `${C.danger}22` : "transparent",
                color: duration === d ? C.danger : C.txS, cursor: "pointer",
              }}>
                {d < 60 ? `${d}m` : `${d / 60}h`}
              </button>
            ))}
          </div>
        </div>

        {/* Type CONFIRM */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.danger, textTransform: "uppercase", letterSpacing: "0.05em" }}>Type CONFIRM to proceed</label>
          <input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="CONFIRM"
            style={{
              width: "100%", marginTop: 4, padding: "8px 10px",
              background: C.glassSurfTrans, border: `1px solid ${confirmText === "CONFIRM" ? C.danger : C.glassBorderSubtle}`, borderRadius: 6,
              color: C.tx, fontFamily: F.mono, fontSize: 13, fontWeight: 700, outline: "none",
              boxSizing: "border-box", letterSpacing: "0.1em",
            }}
          />
        </div>

        {error && <div style={{ fontSize: 12, color: C.danger, marginBottom: 12, fontFamily: F.mono }}>{error}</div>}

        {/* Buttons */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{
            padding: "8px 18px", borderRadius: 6, border: `1px solid ${C.cyan}`,
            background: "transparent", color: C.cyan, fontSize: 13, fontFamily: F.sans, cursor: "pointer",
          }}>Cancel</button>
          <button onClick={handleActivate} disabled={!canActivate} style={{
            padding: "8px 18px", borderRadius: 6, border: "none",
            background: canActivate ? C.danger : C.glassSurfTrans, color: canActivate ? "#fff" : C.txT,
            fontSize: 13, fontWeight: 800, fontFamily: F.sans,
            cursor: canActivate ? "pointer" : "not-allowed", opacity: canActivate ? 1 : 0.5,
          }}>
            {activating ? "Activating..." : "Activate Break-Glass"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function BreakGlassSection() {
  const { status, refresh } = useBreakGlassStatus();
  const [showDialog, setShowDialog] = useState(false);

  return (
    <>
      <div style={{ marginTop: 16, padding: "12px 14px", background: C.glassSurfTrans, borderRadius: 8, border: `1px solid ${C.danger}44` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.tx }}>Break-Glass Mode</div>
            <div style={{ fontSize: 11, color: C.txT, marginTop: 2 }}>
              {status?.active
                ? "ACTIVE — Shield bypass enabled. All traffic is unscanned."
                : status?.cool_down_remaining_seconds
                  ? `Cool-down: ${Math.ceil(status.cool_down_remaining_seconds / 60)}m remaining`
                  : "Emergency bypass — requires authorization and stated reason"}
            </div>
          </div>
          <Tooltip placement="left" variant="detail" content={
            <span>
              <strong style={{ color: C.danger }}>Turns the Prompt Shield off completely</strong> for a set time window. Every agent request during that window is allowed through unchecked, but each one is logged with a clear &quot;break-glass&quot; tag so you can review them after the fact in Audit &amp; Evidence. Use this <strong>only</strong> when a real incident needs immediate access — it requires an operator confirmation and a stated reason. The bypass auto-expires when the window ends, and an alert fires the moment it does.
            </span>
          }>
            <button
              onClick={() => setShowDialog(true)}
              disabled={status?.active || (status?.cool_down_remaining_seconds ?? 0) > 0}
              style={{
                padding: "8px 16px", borderRadius: 8,
                border: `2px solid ${C.danger}28`,
                background: "transparent",
                color: C.danger, fontWeight: 800, fontSize: 12,
                fontFamily: F.mono, letterSpacing: "0.08em",
                cursor: status?.active || (status?.cool_down_remaining_seconds ?? 0) > 0 ? "not-allowed" : "pointer",
                opacity: status?.active || (status?.cool_down_remaining_seconds ?? 0) > 0 ? 0.4 : 1,
              }}
            >
              {"\uD83D\uDEE1\uFE0F"} BREAK-GLASS
            </button>
          </Tooltip>
        </div>
      </div>
      {showDialog && <BreakGlassDialog onClose={() => setShowDialog(false)} onActivated={() => refresh()} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-cards used by ConfigurationPanel
// ---------------------------------------------------------------------------

function McpServerCard() {
  const [copied, setCopied] = useState<string | null>(null);

  const copyText = (text: string, label: string) => {
    try { navigator.clipboard.writeText(text); } catch {}
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const tools = [
    { name: "shield_scan", desc: "Scan text through the 163-detection prompt shield (plus operator-authored custom rules)", scope: "shield:scan" },
    { name: "check_posture", desc: "Get current security posture and threat score", scope: "fleet:read" },
    { name: "query_threats", desc: "List active alerts and threats", scope: "alerts:read" },
    { name: "review_audit", desc: "Query the immutable audit trail", scope: "audit:read" },
    { name: "manage_access", desc: "Add or remove access control entries", scope: "shield:scan" },
  ];

  const resources = [
    { uri: "clawnex://security-status", desc: "Combined health + shield statistics" },
    { uri: "clawnex://agents", desc: "Agent fleet list with status" },
    { uri: "clawnex://recent-alerts", desc: "Open alerts (last 10)" },
  ];

  const claudeConfig = JSON.stringify({
    mcpServers: {
      clawnex: {
        command: "bash",
        args: ["~/sentinel/scripts/start-mcp.sh"],
      }
    }
  }, null, 2);

  return (
    <CollapsibleCard title="MCP Server" accent={C.info} defaultOpen={false}>
      <div style={{ fontSize: 11, color: C.txT, marginBottom: 12, lineHeight: 1.5 }}>
        The Model Context Protocol (MCP) server lets AI assistants interact with ClawNex directly — scanning prompts, checking posture, querying threats, and reviewing audit trails. Runs as a separate process alongside the dashboard.
      </div>

      {/* Startup */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Start Command</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <code style={{ flex: 1, fontSize: 11, fontFamily: F.mono, color: C.cyan, padding: "6px 8px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4 }}>bash ~/sentinel/scripts/start-mcp.sh</code>
          <button onClick={() => copyText("bash ~/sentinel/scripts/start-mcp.sh", "cmd")} style={{ padding: "4px 8px", background: `${C.brand}18`, border: `1px solid ${C.brand}44`, borderRadius: 4, color: C.brand, fontSize: 10, cursor: "pointer", fontFamily: F.mono }}>{copied === "cmd" ? "Copied" : "Copy"}</button>
        </div>
      </div>

      {/* Tools */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Available Tools ({tools.length})</div>
        {tools.map(t => (
          <div key={t.name} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: `1px solid ${C.glassBorderSubtle}` }}>
            <span style={{ fontSize: 11, color: C.brand, fontFamily: F.mono, fontWeight: 600, minWidth: 110 }}>{t.name}</span>
            <span style={{ fontSize: 11, color: C.txS, flex: 1 }}>{t.desc}</span>
            <span style={{ fontSize: 9, color: C.txT, fontFamily: F.mono }}>{t.scope}</span>
          </div>
        ))}
      </div>

      {/* Resources */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Resources ({resources.length})</div>
        {resources.map(r => (
          <div key={r.uri} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: `1px solid ${C.glassBorderSubtle}` }}>
            <span style={{ fontSize: 11, color: C.cyan, fontFamily: F.mono, minWidth: 180 }}>{r.uri}</span>
            <span style={{ fontSize: 11, color: C.txS }}>{r.desc}</span>
          </div>
        ))}
      </div>

      {/* Claude Code Config */}
      <div>
        <div style={{ fontSize: 10, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Claude Code Integration</div>
        <div style={{ fontSize: 10, color: C.txT, marginBottom: 4 }}>Add to your Claude Code MCP configuration:</div>
        <div style={{ position: "relative" }}>
          <pre style={{ fontSize: 10, fontFamily: F.mono, color: C.txS, padding: "8px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{claudeConfig}</pre>
          <button onClick={() => copyText(claudeConfig, "config")} style={{ position: "absolute", top: 4, right: 4, padding: "2px 6px", background: `${C.brand}18`, border: `1px solid ${C.brand}44`, borderRadius: 3, color: C.brand, fontSize: 9, cursor: "pointer", fontFamily: F.mono }}>{copied === "config" ? "Copied" : "Copy"}</button>
        </div>
      </div>
    </CollapsibleCard>
  );
}

// ---------------------------------------------------------------------------

function ApiKeysCard({ focusedCard }: { focusedCard?: string | null }) {
  const [keys, setKeys] = useState<Array<{ id: string; name: string; key_prefix: string; scopes: string; rate_limit: number; last_used_at: string | null; created_at: string; revoked_at: string | null }>>([]);
  const [newName, setNewName] = useState("");
  const [newScopes, setNewScopes] = useState("shield:scan,agents:read,alerts:read");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const fetchKeys = useCallback(async () => {
    try { const res = await fetch("/api/config/api-keys"); if (res.ok) { const d = await res.json(); setKeys(d.keys || []); } } catch {}
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  const createKey = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/config/api-keys", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, scopes: newScopes.split(",").map(s => s.trim()).filter(Boolean) }),
      });
      if (res.ok) {
        const d = await res.json();
        setCreatedKey(d.key);
        setNewName("");
        fetchKeys();
      }
    } catch {} finally { setCreating(false); }
  };

  const revokeKey = async (id: string) => {
    try { await fetch(`/api/config/api-keys?id=${id}`, { method: "DELETE" }); fetchKeys(); } catch {}
  };

  const AVAILABLE_SCOPES = ["shield:scan", "shield:read", "agents:read", "alerts:read", "audit:read", "fleet:read", "chat:completions", "health:read"];

  return (
    <CollapsibleCard title="API Keys" accent={C.purp} defaultOpen={false} count={keys.filter(k => !k.revoked_at).length} focusKey="apiKeys" focusedCard={focusedCard}>
      <div style={{ fontSize: 11, color: C.txT, marginBottom: 10 }}>Manage API keys for the public API (/api/v1/*). Keys authenticate external integrations.</div>

      {createdKey && (
        <div style={{ padding: "8px 10px", background: `${C.brand}10`, border: `1px solid ${C.brand}33`, borderRadius: 6, marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: C.brand, fontWeight: 700, marginBottom: 4 }}>NEW KEY CREATED — COPY NOW (shown only once)</div>
          <div style={{ fontSize: 12, fontFamily: F.mono, color: C.tx, wordBreak: "break-all", padding: "4px 6px", background: C.bg, borderRadius: 4 }}>{createdKey}</div>
          <Tooltip placement="top" variant="detail" content={<span>Copy the key to your clipboard and clear it from the screen. <strong>The full key is shown only once</strong> — if you lose it, revoke it and create a new one.</span>}>
            <button onClick={() => { try { navigator.clipboard.writeText(createdKey); } catch {} setCreatedKey(null); }} style={{ marginTop: 6, padding: "3px 8px", background: C.brand, color: C.bg, border: "none", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>Copy & Dismiss</button>
          </Tooltip>
        </div>
      )}

      {/* Create new key */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: C.txT, marginBottom: 2, textTransform: "uppercase" }}>Name</div>
          <Tooltip placement="top" variant="detail" content={<span>A label that helps you remember which integration owns this key — shown in the active-keys list and in audit log entries. Examples: <strong>CI Pipeline</strong>, <strong>Grafana exporter</strong>, <strong>Slackbot</strong>.</span>}>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. CI Pipeline" style={{ width: "100%", padding: "4px 6px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, color: C.tx, fontSize: 12, fontFamily: F.mono }} />
          </Tooltip>
        </div>
        <div style={{ flex: 2 }}>
          <div style={{ fontSize: 9, color: C.txT, marginBottom: 2, textTransform: "uppercase" }}>Scopes</div>
          <Tooltip placement="top" variant="detail" content={<span>The permissions this key grants, comma-separated. Each scope unlocks one set of read or write endpoints — pick only what the integration actually needs. Example: a CI smoke-test runner usually only needs <strong>shield:scan</strong> and <strong>health:read</strong>.</span>}>
            <input value={newScopes} onChange={e => setNewScopes(e.target.value)} placeholder="shield:scan,agents:read" style={{ width: "100%", padding: "4px 6px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, color: C.tx, fontSize: 12, fontFamily: F.mono }} />
          </Tooltip>
        </div>
        <Tooltip placement="top" variant="detail" content={<span>Mint a new bearer token with the scopes above. The full key is returned <strong>once</strong> and never stored in plaintext after that — only its prefix and a hash. Lose it and you'll need to revoke + recreate.</span>}>
          <button onClick={createKey} disabled={!newName.trim() || creating} style={{ padding: "4px 10px", background: !newName.trim() ? C.glassSurfTrans : C.purp, color: "#fff", border: "none", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: !newName.trim() ? "default" : "pointer", whiteSpace: "nowrap" }}>{creating ? "..." : "Create Key"}</button>
        </Tooltip>
      </div>
      <div style={{ fontSize: 9, color: C.txT, marginBottom: 10 }}>Available scopes: {AVAILABLE_SCOPES.join(", ")}</div>

      {/* Key list */}
      {keys.filter(k => !k.revoked_at).length === 0 ? (
        <div style={{ fontSize: 12, color: C.txT, padding: 8, textAlign: "center" }}>No active API keys. Create one to use the public API.</div>
      ) : (
        <div style={{ fontSize: 11, fontFamily: F.mono }}>
          {keys.filter(k => !k.revoked_at).map(k => (
            <div key={k.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${C.glassBorderSubtle}` }}>
              <span style={{ color: C.tx, fontWeight: 600, minWidth: 100 }}>{k.name}</span>
              <span style={{ color: C.txT }}>{k.key_prefix}...</span>
              <span style={{ color: C.cyan, fontSize: 9 }}>{(Array.isArray(k.scopes) ? k.scopes : (() => { try { return JSON.parse(k.scopes || "[]"); } catch { return []; } })()).length} scopes</span>
              <span style={{ color: C.txT, fontSize: 9 }}>{k.last_used_at ? `used ${new Date(k.last_used_at).toLocaleDateString()}` : "never used"}</span>
              <div style={{ flex: 1 }} />
              <Tooltip placement="left" variant="detail" content={<span>Permanently disable this key. Takes effect immediately — any in-flight requests using it start failing with an Unauthorized error. The key row stays visible in the audit history but moves out of the active list.</span>}>
                <button onClick={() => revokeKey(k.id)} style={{ padding: "2px 6px", background: `${C.danger}18`, border: `1px solid ${C.danger}33`, borderRadius: 3, color: C.danger, fontSize: 9, fontWeight: 600, cursor: "pointer" }}>Revoke</button>
              </Tooltip>
            </div>
          ))}
        </div>
      )}
    </CollapsibleCard>
  );
}

// ---------------------------------------------------------------------------

function ModuleTogglesCard({ focusedCard }: { focusedCard?: string | null }) {
  const [modules, setModules] = useState<Record<string, { label: string; enabled: boolean; core: boolean; dependents: string[] }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/config/modules");
        if (res.ok) { const data = await res.json(); setModules(data.modules || {}); }
      } catch {}
    })();
  }, []);

  const toggleModule = async (tabId: string, enabled: boolean) => {
    setSaving(tabId);
    setWarning(null);
    try {
      const res = await fetch("/api/config/modules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabId, enabled }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.warning) setWarning(data.warning);
        setModules(prev => ({ ...prev, [tabId]: { ...prev[tabId], enabled } }));
      }
    } catch {} finally { setSaving(null); }
  };

  const entries = Object.entries(modules);

  return (
    <CollapsibleCard title="Modules" accent={C.cyan} defaultOpen={false} count={entries.filter(([, m]) => m.enabled).length} focusKey="modules" focusedCard={focusedCard}>
      <div style={{ fontSize: 11, color: C.txT, marginBottom: 10 }}>Enable or disable dashboard modules. Core modules cannot be disabled.</div>
      {warning && <div style={{ fontSize: 11, color: C.warn, padding: "6px 8px", background: `${C.warn}10`, border: `1px solid ${C.warn}33`, borderRadius: 4, marginBottom: 8 }}>{warning}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 12px", alignItems: "center" }}>
        {entries.map(([id, mod]) => (
          <React.Fragment key={id}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: mod.enabled ? C.tx : C.txT, fontFamily: F.sans }}>{mod.label || id}</span>
              {mod.core && <span style={{ fontSize: 9, color: C.txT, fontFamily: F.mono, padding: "1px 4px", background: `${C.txT}18`, borderRadius: 2 }}>CORE</span>}
            </div>
            <Tooltip placement="left" variant="detail" content={<span>{mod.core ? <><strong>Core module</strong> — cannot be disabled. ClawNex needs this tab to function correctly.</> : <>Show or hide the <strong>{mod.label || id}</strong> tab. Disabling removes it from the navigation but does <strong>not</strong> stop background services or delete data.</>}</span>}>
              <label style={{ position: "relative", display: "inline-block", width: 32, height: 18, cursor: mod.core ? "not-allowed" : "pointer", opacity: saving === id ? 0.5 : 1 }}>
                <input
                  type="checkbox"
                  checked={mod.enabled}
                  disabled={mod.core || saving === id}
                  onChange={() => toggleModule(id, !mod.enabled)}
                  style={{ opacity: 0, width: 0, height: 0 }}
                />
                <span style={{
                  position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 9,
                  background: mod.enabled ? C.brand : C.glassSurfTrans, transition: "background 0.2s ease",
                }}>
                  <span style={{
                    position: "absolute", top: 2, left: mod.enabled ? 16 : 2, width: 14, height: 14, borderRadius: 7,
                    background: "#fff", transition: "left 0.2s ease",
                  }} />
                </span>
              </label>
            </Tooltip>
          </React.Fragment>
        ))}
      </div>
    </CollapsibleCard>
  );
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Developer Tools Card (v0.9.3+) — in-dashboard seed-traffic surface
// ---------------------------------------------------------------------------
//
// Banking-customer constraint: many corporate environments restrict shell
// access, so the CLI-only fixture path doesn't serve those operators. This
// card surfaces seed/reset/list inside the dashboard with three guards:
//   1. Env kill switch (CLAWNEX_DEV_TOOLS_DISABLED=1) — customer-prod
//      installs lock the surface fully off; the card returns null when
//      envAllowed is false so the section header doesn't even hint at it.
//   2. DB toggle (config_defaults.dev_tools_enabled) — admin must
//      consciously flip from this card with a typed-phrase confirm.
//   3. RBAC (system:manage) on every mutation; localhost fallback when
//      RBAC off. Audit-logged.
//
// All four states render different content:
//   envAllowed=false                       -> null (card invisible)
//   envAllowed=true, dbEnabled=false        -> Enable card with typed-phrase
//   envAllowed=true, dbEnabled=true         -> Seed/reset/list UI
//   loading                                 -> spinner
//
interface DevRunSummary {
  runId: string;
  alerts: number;
  shieldScans: number;
  earliest: string | null;
  latest: string | null;
  /** v0.9.3 internal reviewer follow-up: per-run visibility mode for badging.
   *  'simulation-only' = Mode A; 'default-counters' = Mode B (lit up).
   *  'mixed' = both modes' rows present (shouldn't normally happen).
   *  'unknown' = legacy rows without the simulation_visibility tag. */
  visibility?: 'simulation-only' | 'default-counters' | 'mixed' | 'unknown';
}

interface DevStatus {
  envAllowed: boolean;
  dbEnabled: boolean;
  available: boolean;
  activeRuns: DevRunSummary[];
  activeRunCount: number;
  /** v0.9.3 internal reviewer follow-up: top-level breakdown so the header ribbon
   *  can escalate visual treatment when any Mode B run is active. */
  modeARunCount?: number;
  modeBRunCount?: number;
}

function DeveloperToolsCard({ focusedCard }: { focusedCard?: string | null }) {
  const [status, setStatus] = useState<DevStatus | null>(null);
  const [loading, setLoading] = useState(false);
  // Typed-phrase confirm state for the enable flip. The exact phrase is
  // visible to the operator and must be typed character-for-character.
  const ENABLE_PHRASE = "enable developer tools";
  const [enableInput, setEnableInput] = useState("");
  const [enableWorking, setEnableWorking] = useState(false);
  // Seed form state.
  const [seedRunId, setSeedRunId] = useState("");
  const [seedProfile, setSeedProfile] = useState<"standard" | "intense" | "quiet">("standard");
  // Mode B (internal reviewer follow-up 2026-04-29): when checked, seeded rows write
  // origin='production' so default Fleet/Shield/header counters light
  // up. Required for M-01 video / demo recording where the dashboard
  // must look populated under known synthetic load. Requires a second
  // typed-phrase confirm before the seed call goes out.
  const [visibleToDefaultCounters, setVisibleToDefaultCounters] = useState(false);
  const [modeBPhraseInput, setModeBPhraseInput] = useState("");
  const MODE_B_PHRASE = "light up default counters";
  const [seedWorking, setSeedWorking] = useState(false);
  // Reset state — per-run reset uses the row button; reset-all goes through
  // a single-click confirm modal.
  const [resetRunId, setResetRunId] = useState<string | null>(null); // which run is currently being reset
  const [resetAllConfirm, setResetAllConfirm] = useState(false);
  const [resetWorking, setResetWorking] = useState(false);
  // v0.11.5+: rule-of-5 pagination on the active-runs list.
  const [runsPageSize, setRunsPageSize] = useState(5);
  const [runsPage, setRunsPage] = useState(0);
  // Action result panel — last action's status + detail. Cleared on next
  // action.
  const [lastResult, setLastResult] = useState<{ ok: boolean; status: string; message: string } | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dev/status");
      if (res.ok) {
        const d = await res.json();
        setStatus(d);
      } else if (res.status === 404) {
        // env-disabled returns 404 (no information leak about feature).
        setStatus({ envAllowed: false, dbEnabled: false, available: false, activeRuns: [], activeRunCount: 0 });
      }
    } catch { /* silent — keep last status if any */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const flipEnabled = useCallback(async (enable: boolean) => {
    setEnableWorking(true);
    setLastResult(null);
    try {
      const res = await fetch("/api/config/defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "dev_tools_enabled", value: enable ? "true" : "" }),
      });
      if (res.ok) {
        setLastResult({ ok: true, status: enable ? "enabled" : "disabled", message: enable ? "Developer Tools enabled. Seed/reset/list surfaces are now active for system-admin operators." : "Developer Tools disabled. Active simulation runs (if any) remain in the DB until reset; the surfaces just become unavailable." });
        setEnableInput("");
        await fetchStatus();
      } else {
        const d = await res.json().catch(() => ({}));
        setLastResult({ ok: false, status: "error", message: d.error || `Failed (HTTP ${res.status})` });
      }
    } catch (err) {
      setLastResult({ ok: false, status: "error", message: err instanceof Error ? err.message : String(err) });
    }
    setEnableWorking(false);
  }, [fetchStatus]);

  const performSeed = useCallback(async () => {
    setSeedWorking(true);
    setLastResult(null);
    try {
      // Mode B requires the second typed phrase. Check client-side too
      // so we surface a clear UI error instead of a generic 400 from
      // the API. The API enforces independently regardless.
      if (visibleToDefaultCounters && modeBPhraseInput.trim().toLowerCase() !== MODE_B_PHRASE) {
        setLastResult({
          ok: false,
          status: "phrase-required",
          message: `Mode B requires you to type the confirmation phrase exactly: "${MODE_B_PHRASE}".`,
        });
        setSeedWorking(false);
        return;
      }
      const body: Record<string, string | boolean> = { profile: seedProfile };
      if (seedRunId.trim()) body.runId = seedRunId.trim();
      if (visibleToDefaultCounters) {
        body.visibleToDefaultCounters = true;
        body.confirm_phrase = MODE_B_PHRASE;
      }
      const res = await fetch("/api/dev/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (res.ok && d.ok) {
        setLastResult({ ok: true, status: visibleToDefaultCounters ? "seeded-mode-b" : "seeded", message: d.message || `Seeded run-id ${d.runId}` });
        setSeedRunId("");
        // Reset Mode B state after a successful Mode B seed so a follow-up
        // click doesn't accidentally repeat it without a fresh confirm.
        if (visibleToDefaultCounters) {
          setVisibleToDefaultCounters(false);
          setModeBPhraseInput("");
        }
        await fetchStatus();
      } else {
        setLastResult({ ok: false, status: "error", message: d.error || `Failed (HTTP ${res.status})` });
      }
    } catch (err) {
      setLastResult({ ok: false, status: "error", message: err instanceof Error ? err.message : String(err) });
    }
    setSeedWorking(false);
  }, [seedRunId, seedProfile, fetchStatus, visibleToDefaultCounters, modeBPhraseInput]);

  const performResetRun = useCallback(async (runId: string) => {
    setResetWorking(true);
    setResetRunId(runId);
    setLastResult(null);
    try {
      const res = await fetch("/api/dev/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const d = await res.json();
      if (res.ok && d.ok) {
        setLastResult({ ok: true, status: "reset", message: d.message || `Reset ${runId}` });
        await fetchStatus();
      } else {
        setLastResult({ ok: false, status: "error", message: d.error || `Failed (HTTP ${res.status})` });
      }
    } catch (err) {
      setLastResult({ ok: false, status: "error", message: err instanceof Error ? err.message : String(err) });
    }
    setResetWorking(false);
    setResetRunId(null);
  }, [fetchStatus]);

  const performResetAll = useCallback(async () => {
    setResetWorking(true);
    setLastResult(null);
    setResetAllConfirm(false);
    try {
      const res = await fetch("/api/dev/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const d = await res.json();
      if (res.ok && d.ok) {
        setLastResult({ ok: true, status: "reset-all", message: d.message || "All simulation runs cleared." });
        await fetchStatus();
      } else {
        setLastResult({ ok: false, status: "error", message: d.error || `Failed (HTTP ${res.status})` });
      }
    } catch (err) {
      setLastResult({ ok: false, status: "error", message: err instanceof Error ? err.message : String(err) });
    }
    setResetWorking(false);
  }, [fetchStatus]);

  // Banking-customer prod hides the card entirely. No section header
  // entry, no aria-label hint, no UI surface at all. The 404 from
  // /api/dev/status (env kill-switch) tells us this.
  if (status && !status.envAllowed) return null;

  return (
    <CollapsibleCard title="DEVELOPER TOOLS" accent={C.warn} defaultOpen={false} focusKey="developerTools" focusedCard={focusedCard}>
      <div style={{ fontSize: 12, color: C.txS, lineHeight: 1.5, marginBottom: 10 }}>
        Seed and reset <strong>simulation traffic</strong> directly from the dashboard — populates real ClawNex code paths
        with synthetic alerts and shield scans tagged <span style={{ fontFamily: F.mono, color: C.cyan }}>origin: simulation</span>.
        Default dashboard counters do <strong>not</strong> count these as production evidence
        (per the <span style={{ fontFamily: F.mono, color: C.cyan }}>productionOriginSqlClause</span> contract); use this
        for sanity tests, demos, and operator-onboarding walkthroughs.
      </div>

      {loading && !status && <LoadingSpinner />}

      {/* State: env-allowed but DB toggle off — show the typed-phrase enable */}
      {status && status.envAllowed && !status.dbEnabled && (
        <div>
          <div style={{ padding: "10px 12px", background: `${C.warn}10`, border: `1px solid ${C.warn}33`, borderRadius: 6, marginBottom: 10, fontSize: 11, color: C.txS, lineHeight: 1.5 }}>
            <strong style={{ color: C.warn }}>Disabled.</strong> Enabling activates seed/reset surfaces. Simulation rows write to the DB but are filtered out of production counters by default. Operator edits to seed/reset are audit-logged.
          </div>
          <div style={{ fontSize: 11, color: C.txS, marginBottom: 6 }}>
            Type the phrase <span style={{ fontFamily: F.mono, color: C.brand, fontWeight: 700 }}>{ENABLE_PHRASE}</span> to confirm:
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="text"
              value={enableInput}
              onChange={e => setEnableInput(e.target.value)}
              placeholder="enable developer tools"
              spellCheck={false}
              autoComplete="off"
              style={{ flex: 1, minWidth: 240, padding: "6px 10px", fontSize: 12, fontFamily: F.mono, background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, color: C.tx }}
            />
            <button
              onClick={() => flipEnabled(true)}
              disabled={enableWorking || enableInput.trim().toLowerCase() !== ENABLE_PHRASE}
              style={{ padding: "6px 14px", borderRadius: 4, fontSize: 12, fontWeight: 700, background: enableInput.trim().toLowerCase() === ENABLE_PHRASE ? `${C.warn}22` : "transparent", border: `1px solid ${enableInput.trim().toLowerCase() === ENABLE_PHRASE ? C.warn : C.glassBorderSubtle}`, color: enableInput.trim().toLowerCase() === ENABLE_PHRASE ? C.warn : C.txT, cursor: enableInput.trim().toLowerCase() === ENABLE_PHRASE && !enableWorking ? "pointer" : "not-allowed", fontFamily: F.sans }}
            >
              {enableWorking ? "Enabling..." : "Enable Developer Tools"}
            </button>
          </div>
        </div>
      )}

      {/* State: fully available — show seed/reset/list UI */}
      {status && status.available && (
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, padding: "6px 10px", background: `${C.green}08`, border: `1px solid ${C.green}33`, borderRadius: 4 }}>
            <Dot color={C.green} size={6} />
            <span style={{ fontSize: 11, fontWeight: 700, color: C.green, letterSpacing: "0.05em" }}>ENABLED</span>
            <span style={{ fontSize: 11, color: C.txS, flex: 1 }}>{status.activeRunCount} active simulation run{status.activeRunCount === 1 ? "" : "s"}</span>
            <button
              onClick={() => flipEnabled(false)}
              disabled={enableWorking}
              style={{ padding: "3px 10px", borderRadius: 3, fontSize: 10, fontWeight: 600, background: "transparent", border: `1px solid ${C.glassBorderSubtle}`, color: C.txS, cursor: enableWorking ? "wait" : "pointer", fontFamily: F.sans }}
            >
              {enableWorking ? "Disabling..." : "Disable Developer Tools"}
            </button>
          </div>

          {/* Seed form */}
          <div style={{ padding: "10px 12px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6, marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.txT, marginBottom: 8 }}>Seed Simulation Traffic</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginBottom: 8 }}>
              <input
                type="text"
                value={seedRunId}
                onChange={e => setSeedRunId(e.target.value)}
                placeholder="Run ID (auto-generated if empty)"
                spellCheck={false}
                autoComplete="off"
                style={{ padding: "6px 10px", fontSize: 12, fontFamily: F.mono, background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, color: C.tx }}
              />
              <select
                value={seedProfile}
                onChange={e => setSeedProfile(e.target.value as "standard" | "intense" | "quiet")}
                style={{ padding: "6px 10px", fontSize: 12, fontFamily: F.mono, background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, color: C.tx, cursor: "pointer" }}
              >
                <option value="quiet">quiet (light load)</option>
                <option value="standard">standard (balanced)</option>
                <option value="intense">intense (heavy load)</option>
              </select>
            </div>

            {/* Mode B opt-in: when checked, expand a typed-phrase confirm
                + a clearly-labeled warning. Hidden when unchecked so the
                normal Seed Traffic flow stays one-click. internal reviewer follow-up
                2026-04-29 + operator requirement: this is the production-
                visible mode required for M-01 video / demo recording. */}
            <div style={{ marginBottom: 8, padding: "6px 8px", background: visibleToDefaultCounters ? `${C.warn}10` : "transparent", border: `1px solid ${visibleToDefaultCounters ? `${C.warn}33` : C.glassBorderSubtle}`, borderRadius: 4 }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer", fontSize: 11, color: C.txS }}>
                <input
                  type="checkbox"
                  checked={visibleToDefaultCounters}
                  onChange={e => {
                    setVisibleToDefaultCounters(e.target.checked);
                    if (!e.target.checked) setModeBPhraseInput("");
                  }}
                  style={{ marginTop: 2, cursor: "pointer" }}
                />
                <span>
                  <strong style={{ color: visibleToDefaultCounters ? C.warn : C.tx }}>Make simulation visible in default dashboard counters</strong>
                  <div style={{ marginTop: 2, fontSize: 10, color: C.txT, lineHeight: 1.5 }}>
                    Mode B (<span style={{ fontFamily: F.mono }}>--visible-to-default-counters</span>): seeded rows tag <span style={{ fontFamily: F.mono, color: C.cyan }}>origin: production</span> so Fleet/header/Shield default counters light up. Reset still removes by simulation metadata. <strong>For local / QA / disposable demo / controlled recording only. Do not enable on customer production data.</strong>
                  </div>
                </span>
              </label>
              {visibleToDefaultCounters && (
                <div style={{ marginTop: 6, paddingLeft: 22 }}>
                  <div style={{ fontSize: 10, color: C.warn, marginBottom: 4 }}>
                    Type the phrase <span style={{ fontFamily: F.mono, color: C.warn, fontWeight: 700 }}>{MODE_B_PHRASE}</span> to confirm:
                  </div>
                  <input
                    type="text"
                    value={modeBPhraseInput}
                    onChange={e => setModeBPhraseInput(e.target.value)}
                    placeholder={MODE_B_PHRASE}
                    spellCheck={false}
                    autoComplete="off"
                    style={{ width: "100%", padding: "5px 8px", fontSize: 11, fontFamily: F.mono, background: C.glassSurfTrans, border: `1px solid ${modeBPhraseInput.trim().toLowerCase() === MODE_B_PHRASE ? C.warn : C.glassBorderSubtle}`, borderRadius: 3, color: C.tx }}
                  />
                </div>
              )}
            </div>

            <button
              onClick={performSeed}
              disabled={seedWorking || resetWorking || (visibleToDefaultCounters && modeBPhraseInput.trim().toLowerCase() !== MODE_B_PHRASE)}
              style={{
                padding: "6px 14px", borderRadius: 4, fontSize: 12, fontWeight: 700,
                background: visibleToDefaultCounters
                  ? (modeBPhraseInput.trim().toLowerCase() === MODE_B_PHRASE ? (seedWorking ? `${C.warn}33` : `${C.warn}22`) : "transparent")
                  : (seedWorking ? `${C.brand}33` : `${C.brand}22`),
                border: `1px solid ${visibleToDefaultCounters ? (modeBPhraseInput.trim().toLowerCase() === MODE_B_PHRASE ? C.warn : C.glassBorderSubtle) : `${C.brand}66`}`,
                color: visibleToDefaultCounters ? (modeBPhraseInput.trim().toLowerCase() === MODE_B_PHRASE ? C.warn : C.txT) : C.brand,
                cursor: seedWorking || resetWorking || (visibleToDefaultCounters && modeBPhraseInput.trim().toLowerCase() !== MODE_B_PHRASE) ? "not-allowed" : "pointer",
                fontFamily: F.sans,
              }}
            >
              {seedWorking ? "Seeding..." : visibleToDefaultCounters ? "Seed Traffic (Mode B — visible to default counters)" : "Seed Traffic"}
            </button>
          </div>

          {/* Active runs list */}
          {status.activeRuns.length > 0 ? (
            <div style={{ padding: "10px 12px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6 }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.txT, flex: 1 }}>Active Runs ({status.activeRuns.length})</span>
                {!resetAllConfirm ? (
                  <button
                    onClick={() => setResetAllConfirm(true)}
                    disabled={resetWorking || seedWorking}
                    style={{ padding: "3px 10px", borderRadius: 3, fontSize: 10, fontWeight: 600, background: "transparent", border: `1px solid ${C.danger}66`, color: C.danger, cursor: resetWorking || seedWorking ? "wait" : "pointer", fontFamily: F.sans }}
                  >
                    Reset All Simulation
                  </button>
                ) : (
                  <span style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={performResetAll}
                      disabled={resetWorking}
                      style={{ padding: "3px 10px", borderRadius: 3, fontSize: 10, fontWeight: 700, background: `${C.danger}22`, border: `1px solid ${C.danger}`, color: C.danger, cursor: resetWorking ? "wait" : "pointer", fontFamily: F.sans }}
                    >
                      {resetWorking ? "Resetting..." : "Confirm Reset All"}
                    </button>
                    <button
                      onClick={() => setResetAllConfirm(false)}
                      disabled={resetWorking}
                      style={{ padding: "3px 8px", borderRadius: 3, fontSize: 10, background: "transparent", border: `1px solid ${C.glassBorderSubtle}`, color: C.txT, cursor: "pointer", fontFamily: F.sans }}
                    >
                      Cancel
                    </button>
                  </span>
                )}
              </div>
              {(() => {
                const runs = status.activeRuns;
                const totalPages = Math.max(1, Math.ceil(runs.length / runsPageSize));
                const safePage = Math.min(runsPage, totalPages - 1);
                const pagedRuns = runs.slice(safePage * runsPageSize, (safePage + 1) * runsPageSize);
                return pagedRuns.map(run => {
                const isModeB = run.visibility === 'default-counters' || run.visibility === 'mixed';
                return (
                <div key={run.runId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: `1px solid ${C.glassBorderSubtle}`, fontSize: 11 }}>
                  <span style={{ fontFamily: F.mono, color: C.cyan, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{run.runId}</span>
                  {isModeB && (
                    <span title="Mode B: rows tagged origin='production' so default counters include them" style={{ fontSize: 9, fontWeight: 800, padding: "1px 5px", borderRadius: 2, background: `${C.warn}28`, color: C.warn, letterSpacing: "0.05em", fontFamily: F.mono }}>LIT</span>
                  )}
                  <span style={{ color: C.txS, fontFamily: F.mono }}>{run.alerts}A · {run.shieldScans}S</span>
                  <span style={{ color: C.txT, fontFamily: F.mono, fontSize: 10 }}>{run.latest ? new Date(run.latest).toLocaleString() : ""}</span>
                  <button
                    onClick={() => performResetRun(run.runId)}
                    disabled={resetWorking || seedWorking}
                    style={{ padding: "2px 8px", borderRadius: 3, fontSize: 10, fontWeight: 600, background: "transparent", border: `1px solid ${C.warn}66`, color: C.warn, cursor: resetWorking || seedWorking ? "wait" : "pointer", fontFamily: F.sans }}
                  >
                    {resetRunId === run.runId ? "Resetting..." : "Reset"}
                  </button>
                </div>
                );
                });
              })()}
              {(() => {
                const totalPages = Math.max(1, Math.ceil(status.activeRuns.length / runsPageSize));
                if (totalPages <= 1) return null;
                return (
                  <PaginationFooter
                    currentPage={Math.min(runsPage, totalPages - 1)}
                    totalPages={totalPages}
                    pageSize={runsPageSize}
                    totalRows={status.activeRuns.length}
                    onPageSizeChange={setRunsPageSize}
                    onPageChange={setRunsPage}
                  />
                );
              })()}
            </div>
          ) : (
            <div style={{ padding: "10px 12px", fontSize: 11, color: C.txT, fontStyle: "italic", textAlign: "center", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6 }}>
              No active simulation runs. Click <strong>Seed Traffic</strong> to populate the dashboard.
            </div>
          )}

          {/* Refresh */}
          <div style={{ marginTop: 10, textAlign: "right" }}>
            <button
              onClick={fetchStatus}
              disabled={loading || seedWorking || resetWorking}
              style={{ padding: "4px 10px", borderRadius: 3, fontSize: 10, background: "transparent", border: `1px solid ${C.glassBorderSubtle}`, color: C.txS, cursor: "pointer", fontFamily: F.sans }}
            >
              Refresh
            </button>
          </div>
        </div>
      )}

      {/* Result panel — shows after any action */}
      {lastResult && (
        <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 4, background: lastResult.ok ? `${C.green}08` : `${C.danger}08`, border: `1px solid ${lastResult.ok ? C.green : C.danger}33` }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: lastResult.ok ? C.green : C.danger, marginBottom: 4 }}>{lastResult.status}</div>
          <div style={{ fontSize: 11, color: C.txS, lineHeight: 1.5 }}>{lastResult.message}</div>
        </div>
      )}
    </CollapsibleCard>
  );
}

function SystemManagementCard() {
  const [archiving, setArchiving] = useState(false);
  const [archiveResult, setArchiveResult] = useState<string | null>(null);
  const [purgeStep, setPurgeStep] = useState(0); // 0=idle, 1=confirm
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<string | null>(null);
  const [uninstallStep, setUninstallStep] = useState(0); // 0-3
  const [uninstallInput, setUninstallInput] = useState("");
  const [uninstallResult, setUninstallResult] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<string | null>(null);

  const handleArchive = useCallback(async () => {
    setArchiving(true); setArchiveResult(null);
    try {
      const res = await fetch("/api/system/archive", { method: "POST" });
      if (res.ok) { const d = await res.json(); setArchiveResult(`Archived: ${d.filename} (${d.sizeFormatted})`); }
      else setArchiveResult("Archive failed");
    } catch { setArchiveResult("Archive error"); }
    setArchiving(false);
  }, []);

  const handlePurge = useCallback(async () => {
    setPurging(true); setPurgeResult(null);
    try {
      const res = await fetch("/api/system/purge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "PURGE" }) });
      if (res.ok) { const d = await res.json(); setPurgeResult(`Purged: ${d.purged.traffic} traffic, ${d.purged.alerts} alerts, ${d.purged.audit} audit entries`); setPurgeStep(0); }
      else setPurgeResult("Purge failed");
    } catch { setPurgeResult("Purge error"); }
    setPurging(false);
  }, []);

  const handleUninstallStep = useCallback(async () => {
    const step = uninstallStep;
    const confirms = ["YES", "UNINSTALL", "DO IT NOW"];
    if (step < 1 || step > 3) return;
    if (uninstallInput !== confirms[step - 1]) {
      setUninstallResult(`Invalid confirmation. Expected: ${confirms[step - 1]}`);
      return;
    }
    setUninstallResult(null);
    try {
      const res = await fetch("/api/system/uninstall", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step, confirm: uninstallInput }) });
      if (res.ok) {
        const d = await res.json();
        setUninstallResult(d.message);
        if (step < 3) { setUninstallStep(step + 1); setUninstallInput(""); }
        else { setUninstallResult(`Uninstall ready. Run: ${d.command}`); }
      } else { const e = await res.json(); setUninstallResult(e.error); }
    } catch { setUninstallResult("Error"); }
  }, [uninstallStep, uninstallInput]);

  const handleMigrate = useCallback(async () => {
    setMigrating(true); setMigrateResult(null);
    try {
      const res = await fetch("/api/system/migrate", { method: "POST" });
      if (res.ok) { const d = await res.json(); setMigrateResult(`Migration package: ${d.bundle} (in ${d.location})`); }
      else setMigrateResult("Migration failed");
    } catch { setMigrateResult("Migration error"); }
    setMigrating(false);
  }, []);

  return (
    <CollapsibleCard title="SYSTEM MANAGEMENT" accent={C.danger} defaultOpen={false}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* Archive */}
        <div style={{ padding: 12, background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.tx, marginBottom: 4 }}>Archive Database</div>
          <div style={{ fontSize: 10, color: C.txT, marginBottom: 8 }}>Create a timestamped backup of the database.</div>
          <Tooltip placement="top" variant="detail" content={<span>Take a one-shot snapshot of the database to a timestamped file under <strong>backups/</strong>. Finishes in seconds. Safe to run while the dashboard is live — operators won&apos;t notice.</span>}>
            <button onClick={handleArchive} disabled={archiving} style={{ padding: "5px 12px", background: `${C.brand}18`, border: `1px solid ${C.brand}44`, borderRadius: 4, color: C.brand, fontSize: 10, fontWeight: 700, cursor: archiving ? "wait" : "pointer", fontFamily: F.mono }}>{archiving ? "Archiving..." : "Create Backup"}</button>
          </Tooltip>
          {archiveResult && <div style={{ marginTop: 6, fontSize: 10, color: C.green }}>{archiveResult}</div>}
        </div>

        {/* Migrate */}
        <div style={{ padding: 12, background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.tx, marginBottom: 4 }}>Migrate to New Host</div>
          <div style={{ fontSize: 10, color: C.txT, marginBottom: 8 }}>Bundle DB + config for transfer to another machine.</div>
          <Tooltip placement="top" variant="detail" content={<span>Bundle everything you&apos;d need to move ClawNex to a new host — database, environment file, mail settings, operators, and shield whitelist — into a single tarball you can copy over. On the receiving host, run setup.sh and pick the &quot;Import migration package&quot; option to restore from it.</span>}>
            <button onClick={handleMigrate} disabled={migrating} style={{ padding: "5px 12px", background: `${C.cyan}18`, border: `1px solid ${C.cyan}44`, borderRadius: 4, color: C.cyan, fontSize: 10, fontWeight: 700, cursor: migrating ? "wait" : "pointer", fontFamily: F.mono }}>{migrating ? "Packaging..." : "Create Migration Package"}</button>
          </Tooltip>
          {migrateResult && <div style={{ marginTop: 6, fontSize: 10, color: C.cyan, fontFamily: F.mono, wordBreak: "break-all" as const }}>{migrateResult}</div>}
        </div>

        {/* Purge */}
        <div style={{ padding: 12, background: `${C.danger}06`, border: `1px solid ${C.danger}22`, borderRadius: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.danger, marginBottom: 4 }}>Purge Database</div>
          <div style={{ fontSize: 10, color: C.txT, marginBottom: 8 }}>Wipe all operational data. Configuration is preserved.</div>
          {purgeStep === 0 ? (
            <Tooltip placement="top" variant="detail" content={<span>Empty the operational tables — traffic logs, alerts, audit entries, shield scans, correlation history. Configuration (providers, RBAC, shield whitelist, mail) is <strong>preserved</strong>. Use after a noisy demo or when starting a new evaluation cycle.</span>}>
              <button onClick={() => setPurgeStep(1)} style={{ padding: "5px 12px", background: `${C.danger}18`, border: `1px solid ${C.danger}44`, borderRadius: 4, color: C.danger, fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: F.mono }}>Purge Data</button>
            </Tooltip>
          ) : (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: C.danger, fontWeight: 700 }}>Type PURGE to confirm:</span>
              <Tooltip placement="top" variant="compact" content="Final confirmation. No undo.">
                <button onClick={handlePurge} disabled={purging} style={{ padding: "3px 10px", background: C.danger, border: "none", borderRadius: 4, color: "#fff", fontSize: 10, fontWeight: 700, cursor: purging ? "wait" : "pointer" }}>{purging ? "..." : "PURGE"}</button>
              </Tooltip>
              <button onClick={() => setPurgeStep(0)} style={{ padding: "3px 8px", background: "transparent", border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, color: C.txT, fontSize: 10, cursor: "pointer" }}>Cancel</button>
            </div>
          )}
          {purgeResult && <div style={{ marginTop: 6, fontSize: 10, color: C.warn }}>{purgeResult}</div>}
        </div>

        {/* Uninstall */}
        <div style={{ padding: 12, background: `${C.danger}08`, border: `1px solid ${C.danger}33`, borderRadius: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.danger, marginBottom: 4 }}>Uninstall ClawNex</div>
          <div style={{ fontSize: 10, color: C.txT, marginBottom: 8 }}>Remove ClawNex. Backups and docs are preserved.</div>
          {uninstallStep === 0 && (
            <Tooltip placement="top" variant="detail" content={<span>Start the 3-step uninstall flow. Each step requires a typed confirmation. Step 3 returns the shell command to run — the dashboard can&apos;t remove its own running process. <strong>Backups and docs are preserved</strong>; OpenClaw and LiteLLM are never touched.</span>}>
              <button onClick={() => setUninstallStep(1)} style={{ padding: "5px 12px", background: `${C.danger}22`, border: `1px solid ${C.danger}`, borderRadius: 4, color: C.danger, fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: F.mono }}>Begin Uninstall</button>
            </Tooltip>
          )}
          {uninstallStep >= 1 && uninstallStep <= 3 && (
            <div>
              <div style={{ fontSize: 10, color: C.danger, fontWeight: 700, marginBottom: 4 }}>
                {uninstallStep === 1 ? "Step 1/3: Type YES to archive database first" :
                 uninstallStep === 2 ? "Step 2/3: Type UNINSTALL to stop services" :
                 "Step 3/3: Type DO IT NOW to remove files"}
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <input value={uninstallInput} onChange={e => setUninstallInput(e.target.value)} placeholder={uninstallStep === 1 ? "YES" : uninstallStep === 2 ? "UNINSTALL" : "DO IT NOW"} style={{ padding: "3px 8px", background: C.bg, border: `1px solid ${C.danger}44`, borderRadius: 4, color: C.danger, fontSize: 10, fontFamily: F.mono, outline: "none", flex: 1 }} />
                <button onClick={handleUninstallStep} style={{ padding: "3px 10px", background: C.danger, border: "none", borderRadius: 4, color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>Confirm</button>
                <button onClick={() => { setUninstallStep(0); setUninstallInput(""); setUninstallResult(null); }} style={{ padding: "3px 8px", background: "transparent", border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, color: C.txT, fontSize: 10, cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          )}
          {uninstallResult && <div style={{ marginTop: 6, fontSize: 10, color: C.warn, fontFamily: F.mono, wordBreak: "break-all" as const }}>{uninstallResult}</div>}
        </div>
      </div>

      {/* Scheduled Backup */}
      <div style={{ marginTop: 12, padding: 12, background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.tx }}>Scheduled Daily Backup</div>
            <div style={{ fontSize: 10, color: C.txT }}>Cron job at 3:00 AM daily — archives database automatically</div>
          </div>
          <Tooltip placement="left" variant="detail" content={<span>Toggle the daily 3:00 AM cron that snapshots the database. Browser can&apos;t edit crontab directly, so the install/remove command is printed back for you to paste into a terminal once.</span>}>
            <button onClick={async () => {
              try {
                const check = await fetch("/api/system/archive", { method: "POST" }); // test the endpoint
                if (!check.ok) { setArchiveResult("Archive endpoint not ready"); return; }
                await fetch("/api/config/defaults", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "backup_cron_toggle", value: "toggle" }) });
                // Install or remove cron
                const installCron = `(crontab -l 2>/dev/null | grep -v "system/archive"; echo "0 3 * * * curl -s -X POST http://127.0.0.1:${window.location.port || '5001'}/api/system/archive > /dev/null 2>&1") | crontab -`;
                const removeCron = `crontab -l 2>/dev/null | grep -v "system/archive" | crontab -`;
                const currentCron = await fetch("/api/config/defaults").then(r => r.json()).then(d => d.settings?.backup_cron === "enabled");
                if (currentCron) {
                  await fetch("/api/config/defaults", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "backup_cron", value: "disabled" }) });
                  // Can't run shell from browser — show command
                  setArchiveResult("Disabled. Run: " + removeCron.slice(0, 60) + "...");
                } else {
                  await fetch("/api/config/defaults", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "backup_cron", value: "enabled" }) });
                  setArchiveResult("To enable, run in terminal: " + installCron.slice(0, 80) + "...");
                }
              } catch { setArchiveResult("Error toggling backup cron"); }
            }} style={{ padding: "5px 12px", background: `${C.green}18`, border: `1px solid ${C.green}44`, borderRadius: 4, color: C.green, fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: F.mono }}>Enable / Disable</button>
          </Tooltip>
        </div>
      </div>

      {/* CVE Sync */}
      <div style={{ marginTop: 12, padding: 12, background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.tx }}>CVE Database Sync</div>
            <div style={{ fontSize: 10, color: C.txT }}>Sync 108+ CVEs from jgamblin/OpenClawCVEs (GitHub)</div>
          </div>
          <Tooltip placement="left" variant="detail" content={<span>Pull the latest CVE data (100+ entries today, growing) from the curated AI-security CVE feed. Adds new entries and updates existing ones; never deletes. The freshened data shows up in <strong>Security Posture</strong>.</span>}>
            <button onClick={async () => {
              setArchiveResult("Syncing CVEs...");
              try {
                const res = await fetch("/api/cve/sync", { method: "POST" });
                if (res.ok) { const d = await res.json(); setArchiveResult(`Synced ${d.synced} CVEs (${d.inserted} new, ${d.updated} updated)`); }
                else setArchiveResult("CVE sync failed");
              } catch { setArchiveResult("CVE sync error"); }
            }} style={{ padding: "5px 12px", background: `${C.danger}18`, border: `1px solid ${C.danger}44`, borderRadius: 4, color: C.danger, fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: F.mono }}>Sync CVEs</button>
          </Tooltip>
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 10, color: C.txT }}>
        CLI alternative: <span style={{ fontFamily: F.mono, color: C.txS }}>bash ~/sentinel/scripts/uninstall.sh</span>
      </div>
    </CollapsibleCard>
  );
}

// ---------------------------------------------------------------------------
// Mail Configuration Card
// ---------------------------------------------------------------------------

function MailConfigCard({ focusedCard }: { focusedCard?: string | null }) {
  const [provider, setProvider] = useState<string>("none");
  const [fromEmail, setFromEmail] = useState("");
  const [resendKey, setResendKey] = useState("");
  const [resendConfigured, setResendConfigured] = useState(false);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpTls, setSmtpTls] = useState(true);
  const [emailitKey, setEmailitKey] = useState("");
  const [emailitConfigured, setEmailitConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/config/mail");
        if (res.ok) {
          const d = await res.json();
          setProvider(d.provider || "none");
          setFromEmail(d.fromEmail || "");
          if (d.resend) {
            // Server returns the masked key (e.g. "re_xxx...abcd") in
            // d.resend.apiKey when one is stored, plus a configured flag.
            // We surface the flag as a "stored" badge so the empty input
            // doesn't look like the value was wiped on save.
            setResendConfigured(Boolean(d.resend.configured));
          }
          if (d.smtp) {
            setSmtpHost(d.smtp.host || "");
            setSmtpPort(String(d.smtp.port || 587));
            setSmtpUser(d.smtp.username || "");
            setSmtpTls(d.smtp.tls !== false);
          }
          if (d.emailit) {
            setEmailitConfigured(Boolean(d.emailit.configured));
          }
        }
      } catch {}
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const body: Record<string, unknown> = { provider, fromEmail };
      if (provider === "resend" && resendKey) body.resendApiKey = resendKey;
      if (provider === "smtp") {
        body.smtpHost = smtpHost;
        body.smtpPort = parseInt(smtpPort) || 587;
        body.smtpUsername = smtpUser;
        if (smtpPass) body.smtpPassword = smtpPass;
        body.smtpTls = smtpTls;
      }
      // Emailit (v0.9.0+) — only send the key when the user actually typed
      // something. Empty string preserves the stored value (mask round-trip).
      if (provider === "emailit" && emailitKey) body.emailitApiKey = emailitKey;
      const res = await fetch("/api/config/mail", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) {
        setMessage("Saved");
        // Re-pull effective state so the "stored" badges flip on without
        // needing a page reload, and clear the entered keys so the user
        // doesn't think their cleartext is still sitting in the form.
        try {
          const r2 = await fetch("/api/config/mail");
          if (r2.ok) {
            const d = await r2.json();
            if (d.resend) setResendConfigured(Boolean(d.resend.configured));
            if (d.emailit) setEmailitConfigured(Boolean(d.emailit.configured));
          }
        } catch {}
        setResendKey("");
        setEmailitKey("");
        setSmtpPass("");
      }
      else setMessage("Save failed");
    } catch { setMessage("Save failed"); }
    setSaving(false);
  };

  const handleTest = async () => {
    if (!testEmail.trim()) return;
    setTesting(true);
    setMessage("");
    try {
      const res = await fetch("/api/config/mail", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ testTo: testEmail.trim() }) });
      const d = await res.json();
      setMessage(d.ok ? "Test email sent!" : `Test failed: ${d.error || "unknown error"}`);
    } catch { setMessage("Test failed"); }
    setTesting(false);
  };

  return (
    <CollapsibleCard title="MAIL CONFIGURATION" accent={C.info} defaultOpen={false} focusKey="mailConfig" focusedCard={focusedCard}>
      <div style={{ fontSize: 13, color: C.txS, marginBottom: 12 }}>Configure email delivery for password resets and notifications.</div>

      {/* Provider selector */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: C.txT, marginBottom: 4 }}>PROVIDER</div>
        <div style={{ display: "flex", gap: 8 }}>
          {(["none", "resend", "smtp", "emailit"] as const).map(p => {
            const tip = p === "none"
              ? <span>Turn off outbound mail entirely. Magic Link auth, password resets, and scheduled report emails will all fail with a clear &quot;mail provider not configured&quot; error.</span>
              : p === "resend"
                ? <span><strong>Resend</strong> — modern transactional email API. Easiest setup: one API key, no SMTP server to run. Free tier covers most ClawNex installs.</span>
                : p === "smtp"
                  ? <span><strong>SMTP</strong> — classic mail relay. Use this when you already run your own mail server (Postfix, Sendgrid SMTP, Mailgun SMTP, Gmail SMTP). Needs host, port, credentials.</span>
                  : <span><strong>Emailit</strong> — another transactional email service (REST API). Alternative to Resend; same single-key setup.</span>;
            return (
              <Tooltip key={p} placement="top" variant="detail" content={tip}>
                <button onClick={() => setProvider(p)} style={{
                  padding: "6px 16px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer",
                  textTransform: "uppercase", fontFamily: F.mono,
                  background: provider === p ? `${C.info}18` : "transparent",
                  border: `1px solid ${provider === p ? C.info : C.glassBorderSubtle}`,
                  color: provider === p ? C.info : C.txT,
                }}>{p === "none" ? "Disabled" : p}</button>
              </Tooltip>
            );
          })}
        </div>
      </div>

      {provider !== "none" && (
        <>
          {/* From email — placeholder is a generic format example, not a
              real address. Using a real-looking ClawNex domain as the
              placeholder confused operators (they thought it was the
              default and tried to save without changing it). */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: C.txT, marginBottom: 4 }}>FROM EMAIL</div>
            <Tooltip placement="top" variant="detail" content={<span>The address every ClawNex email will appear to come from. Use the format <strong>Display Name &lt;noreply@yourdomain.com&gt;</strong>. The domain must already be <strong>verified with your mail provider</strong>, otherwise sends will fail silently.</span>}>
              <input value={fromEmail} onChange={e => setFromEmail(e.target.value)} placeholder="Display Name <noreply@yourdomain.com>"
                style={{ width: "100%", padding: "8px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6, color: C.tx, fontFamily: F.mono, fontSize: 12, outline: "none", boxSizing: "border-box" as const }} />
            </Tooltip>
            <div style={{ fontSize: 10, color: C.txT, marginTop: 4 }}>
              Format: <code style={{ background: C.glassSurfTrans, padding: "1px 4px", borderRadius: 3 }}>Display Name &lt;address@domain&gt;</code>. The domain must be verified with your mail provider (Resend / SMTP / Emailit) before sends will succeed.
            </div>
          </div>

          {/* Resend config */}
          {provider === "resend" && (
            <div style={{ marginBottom: 12, padding: "12px", background: `${C.info}06`, borderRadius: 8, border: `1px solid ${C.info}22` }}>
              <div style={{ fontSize: 11, color: C.txT, marginBottom: 4 }}>
                RESEND API KEY {resendConfigured && <span style={{ color: C.green, fontStyle: "italic" }}>· stored</span>}
              </div>
              <Tooltip placement="top" variant="detail" content={<span>Your Resend API key (starts with <strong>re_</strong>). Stored encrypted; the field always renders empty after save so you don&apos;t accidentally see the cleartext later. Leave blank when re-saving to keep the existing key.</span>}>
                <input type="password" value={resendKey} onChange={e => setResendKey(e.target.value)} placeholder={resendConfigured ? "Leave blank to keep current" : "re_xxxxxxxxxxxx"}
                  style={{ width: "100%", padding: "8px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6, color: C.tx, fontFamily: F.mono, fontSize: 12, outline: "none", boxSizing: "border-box" as const }} />
              </Tooltip>
              <div style={{ fontSize: 10, color: C.txT, marginTop: 4 }}>Get your key at <a href="https://resend.com" target="_blank" rel="noopener" style={{ color: C.info }}>resend.com</a></div>
            </div>
          )}

          {/* Emailit config (v0.9.0+) — REST API at api.emailit.com */}
          {provider === "emailit" && (
            <div style={{ marginBottom: 12, padding: "12px", background: `${C.info}06`, borderRadius: 8, border: `1px solid ${C.info}22` }}>
              <div style={{ fontSize: 11, color: C.txT, marginBottom: 4 }}>
                EMAILIT API KEY {emailitConfigured && <span style={{ color: C.green, fontStyle: "italic" }}>· stored</span>}
              </div>
              <Tooltip placement="top" variant="detail" content={<span>Your Emailit API key (starts with <strong>em_</strong>). Stored encrypted. Leave blank on re-save to keep the existing key.</span>}>
                <input type="password" value={emailitKey} onChange={e => setEmailitKey(e.target.value)} placeholder={emailitConfigured ? "Leave blank to keep current" : "em_..."}
                  style={{ width: "100%", padding: "8px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6, color: C.tx, fontFamily: F.mono, fontSize: 12, outline: "none", boxSizing: "border-box" as const }} />
              </Tooltip>
              <div style={{ fontSize: 10, color: C.txT, marginTop: 4 }}>Get your key at <a href="https://emailit.com" target="_blank" rel="noopener" style={{ color: C.info }}>emailit.com</a></div>
            </div>
          )}

          {/* SMTP config */}
          {provider === "smtp" && (
            <div style={{ marginBottom: 12, padding: "12px", background: `${C.info}06`, borderRadius: 8, border: `1px solid ${C.info}22` }}>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 11, color: C.txT, marginBottom: 4 }}>HOST</div>
                  <Tooltip placement="top" variant="detail" content={<span>The SMTP server hostname. Common examples: <strong>smtp.gmail.com</strong>, <strong>smtp.sendgrid.net</strong>, <strong>smtp.mailgun.org</strong>, or your internal relay.</span>}>
                    <input value={smtpHost} onChange={e => setSmtpHost(e.target.value)} placeholder="smtp.gmail.com"
                      style={{ width: "100%", padding: "8px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6, color: C.tx, fontFamily: F.mono, fontSize: 12, outline: "none", boxSizing: "border-box" as const }} />
                  </Tooltip>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.txT, marginBottom: 4 }}>PORT</div>
                  <Tooltip placement="top" variant="detail" content={<span><strong>587</strong> for STARTTLS (the common modern default), <strong>465</strong> for implicit TLS, <strong>25</strong> for plain (rarely allowed by modern providers). When in doubt, start with <strong>587</strong>.</span>}>
                    <input value={smtpPort} onChange={e => setSmtpPort(e.target.value)} placeholder="587"
                      style={{ width: "100%", padding: "8px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6, color: C.tx, fontFamily: F.mono, fontSize: 12, outline: "none", boxSizing: "border-box" as const }} />
                  </Tooltip>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 11, color: C.txT, marginBottom: 4 }}>USERNAME</div>
                  <Tooltip placement="top" variant="compact" content="SMTP login. Usually your full email address.">
                    <input value={smtpUser} onChange={e => setSmtpUser(e.target.value)} placeholder="user@example.com"
                      style={{ width: "100%", padding: "8px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6, color: C.tx, fontFamily: F.mono, fontSize: 12, outline: "none", boxSizing: "border-box" as const }} />
                  </Tooltip>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.txT, marginBottom: 4 }}>PASSWORD</div>
                  <Tooltip placement="top" variant="detail" content={<span>SMTP password — for Gmail, this must be an <strong>app password</strong>, not your account password. Encrypted at rest. Leave blank on re-save to keep the current value.</span>}>
                    <input type="password" value={smtpPass} onChange={e => setSmtpPass(e.target.value)} placeholder="••••••••"
                      style={{ width: "100%", padding: "8px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6, color: C.tx, fontFamily: F.mono, fontSize: 12, outline: "none", boxSizing: "border-box" as const }} />
                  </Tooltip>
                </div>
              </div>
              <Tooltip placement="left" variant="detail" content={<span>Negotiate <strong>STARTTLS</strong> after connecting on port 587. Recommended for everything except port 465 (which uses implicit TLS — leave this on, it&apos;s ignored there).</span>}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={smtpTls} onChange={e => setSmtpTls(e.target.checked)} style={{ accentColor: C.info }} />
                  <span style={{ fontSize: 12, color: C.txS }}>Use TLS</span>
                </div>
              </Tooltip>
            </div>
          )}

          {/* Save + Test */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Tooltip placement="top" variant="detail" content={<span>Save the mail provider settings. Encrypted fields (API keys, SMTP password) are wiped from the form after save so the cleartext doesn&apos;t sit in the page.</span>}>
              <button onClick={handleSave} disabled={saving} style={{
                padding: "6px 16px", background: C.info, color: "#fff", border: "none", borderRadius: 6,
                fontSize: 12, fontWeight: 700, cursor: saving ? "wait" : "pointer",
              }}>{saving ? "Saving..." : "Save"}</button>
            </Tooltip>

            <Tooltip placement="top" variant="compact" content="Where to send the smoke-test email. Use an inbox you can actually check.">
              <input value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="Test email address"
                style={{ flex: 1, padding: "6px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6, color: C.tx, fontFamily: F.mono, fontSize: 12, outline: "none", minWidth: 160 }} />
            </Tooltip>

            <Tooltip placement="top" variant="detail" content={<span>Send a real one-off email through the saved provider to verify FROM-domain auth, API key validity, and network reachability. Result returns within a few seconds — green = success, red shows the underlying provider error verbatim.</span>}>
              <button onClick={handleTest} disabled={testing || !testEmail.trim()} style={{
                padding: "6px 16px", background: !testEmail.trim() ? C.glassSurfTrans : C.green, color: "#fff", border: "none", borderRadius: 6,
                fontSize: 12, fontWeight: 700, cursor: !testEmail.trim() ? "not-allowed" : "pointer",
              }}>{testing ? "Sending..." : "Send Test"}</button>
            </Tooltip>
          </div>

          {message && (
            <div style={{ marginTop: 8, fontSize: 12, color: message.includes("fail") ? C.danger : C.green, fontFamily: F.mono }}>{message}</div>
          )}
        </>
      )}
    </CollapsibleCard>
  );
}

// ---------------------------------------------------------------------------
// Voice & Avatar Card
// ---------------------------------------------------------------------------

function VoiceAvatarCard({ focusedCard }: { focusedCard?: string | null }) {
  const [voiceProvider, setVoiceProviderState] = useState("browser");
  const [elevenLabsKey, setElevenLabsKey] = useState("");
  const [elevenLabsVoice, setElevenLabsVoice] = useState("<elevenlabs_voice_id>");
  const [avatarProvider, setAvatarProviderState] = useState("shield");
  const [heyGenKey, setHeyGenKey] = useState("");
  const [heyGenAvatar, setHeyGenAvatar] = useState("");
  const [didKey, setDidKey] = useState("");
  const [didPresenter, setDidPresenter] = useState("");
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/config/voice").then(r => r.ok ? r.json() : null).then(d => {
      if (!d?.settings) return;
      const s = d.settings;
      setVoiceProviderState(s.voice_provider || "browser");
      setElevenLabsKey(s.elevenlabs_api_key || "");
      setElevenLabsVoice(s.elevenlabs_voice_id || "<elevenlabs_voice_id>");
      setAvatarProviderState(s.avatar_provider || "shield");
      setHeyGenKey(s.heygen_api_key || "");
      setHeyGenAvatar(s.heygen_avatar_id || "");
      setDidKey(s.did_api_key || "");
      setDidPresenter(s.did_presenter_id || "");
    }).catch(() => {});
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await fetch("/api/config/voice", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: {
          voice_provider: voiceProvider,
          elevenlabs_api_key: elevenLabsKey.includes("...") ? undefined : elevenLabsKey,
          elevenlabs_voice_id: elevenLabsVoice,
          avatar_provider: avatarProvider,
          heygen_api_key: heyGenKey.includes("...") ? undefined : heyGenKey,
          heygen_avatar_id: heyGenAvatar,
          did_api_key: didKey.includes("...") ? undefined : didKey,
          did_presenter_id: didPresenter,
        }}),
      });
      setTestResult("Saved!");
      setTimeout(() => setTestResult(null), 2000);
    } catch { setTestResult("Save failed"); }
    finally { setSaving(false); }
  }, [voiceProvider, elevenLabsKey, elevenLabsVoice, avatarProvider, heyGenKey, heyGenAvatar, didKey, didPresenter]);

  const handleTestVoice = useCallback(async () => {
    setTestResult("Testing...");
    try {
      const res = await fetch("/api/voice/speak", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "ClawNex is online. One nexus. Total control." }),
      });
      if (res.ok && res.headers.get("content-type")?.includes("audio")) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        audio.play();
        setTestResult("Playing...");
        setTimeout(() => setTestResult(null), 3000);
      } else {
        const data = await res.json().catch(() => ({}));
        setTestResult(data.error || data.message || `HTTP ${res.status}`);
      }
    } catch { setTestResult("Test failed"); }
  }, []);

  const inputStyle = { width: "100%", padding: "6px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, color: C.tx, fontFamily: F.mono, fontSize: 11, outline: "none", boxSizing: "border-box" as const };

  return (
    <CollapsibleCard title="AI VOICE & AVATAR" accent={C.cyan} defaultOpen={false} focusKey="voiceAvatar" focusedCard={focusedCard}>
      <div style={{ fontSize: 12, color: C.txS, marginBottom: 12, lineHeight: 1.5 }}>
        Configure the AI assistant's voice and avatar. API keys are stored server-side and never exposed to the browser.
      </div>

      {/* Voice Provider */}
      <div style={{ padding: "10px 14px", background: "rgba(16,29,52,0.3)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.04)", marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.txT, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Voice Provider</div>
        <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
          {([["browser", "Browser TTS"], ["elevenlabs", "ElevenLabs"]] as [string, string][]).map(([val, label]) => {
            const tip = val === "browser"
              ? <span><strong>Browser TTS</strong> — uses the operator&apos;s OS speech synthesis (free, local, no API key). Quality varies by browser/OS; voices are generic.</span>
              : <span><strong>ElevenLabs</strong> — cloud TTS with high-quality, customizable voices. Requires an API key and costs per-character. Best for branded voices and demos.</span>;
            return (
              <Tooltip key={val} placement="top" variant="detail" content={tip}>
                <button onClick={() => setVoiceProviderState(val)} style={{
                  padding: "3px 10px", borderRadius: 4, fontSize: 11, fontFamily: F.mono, cursor: "pointer",
                  background: voiceProvider === val ? `${C.cyan}22` : "transparent",
                  border: `1px solid ${voiceProvider === val ? C.cyan : C.glassBorderSubtle}`,
                  color: voiceProvider === val ? C.cyan : C.txS,
                }}>{label}</button>
              </Tooltip>
            );
          })}
        </div>
        {voiceProvider === "elevenlabs" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div>
              <div style={{ fontSize: 10, color: C.txT, marginBottom: 2 }}>API KEY</div>
              <input value={elevenLabsKey} onChange={e => setElevenLabsKey(e.target.value)} placeholder="xi-..." type="password" style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.txT, marginBottom: 2 }}>VOICE ID</div>
              <input value={elevenLabsVoice} onChange={e => setElevenLabsVoice(e.target.value)} placeholder="<elevenlabs_voice_id>" style={inputStyle} />
            </div>
          </div>
        )}
      </div>

      {/* Avatar Provider */}
      <div style={{ padding: "10px 14px", background: "rgba(16,29,52,0.3)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.04)", marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.txT, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Avatar Provider</div>
        <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
          {([["shield", "Shield (default)"], ["heygen", "HeyGen/LiveAvatar"], ["did", "D-ID"], ["comfyui", "ComfyUI"]] as [string, string][]).map(([val, label]) => {
            const isFuture = val === "comfyui";
            const tip = val === "shield"
              ? <span>The built-in animated <strong>Shield</strong> avatar. No external API, no cost, always available. Looks the same for every operator.</span>
              : val === "heygen"
                ? <span><strong>HeyGen LiveAvatar</strong> — streaming photoreal avatars. Requires HeyGen API key + a created avatar ID. Best for demos and briefings.</span>
                : val === "did"
                  ? <span><strong>D-ID</strong> — streaming presenter avatars from a still image or stock presenter. Requires D-ID API key + presenter ID from their gallery.</span>
                  : <span><strong>ComfyUI</strong> — self-hosted avatar generation pipeline. Needs ComfyUI server + GPU. <em>Coming soon — this option is locked.</em></span>;
            return (
              <Tooltip key={val} placement="top" variant="detail" content={tip}>
                <button onClick={() => !isFuture ? setAvatarProviderState(val) : null} style={{
                  padding: "3px 10px", borderRadius: 4, fontSize: 11, fontFamily: F.mono, cursor: isFuture ? "not-allowed" : "pointer",
                  background: avatarProvider === val ? `${C.purp}22` : "transparent",
                  border: `1px solid ${avatarProvider === val ? C.purp : C.glassBorderSubtle}`,
                  color: isFuture ? C.txG : avatarProvider === val ? C.purp : C.txS,
                  opacity: isFuture ? 0.5 : 1,
                }}>{label}{isFuture ? " *" : ""}</button>
              </Tooltip>
            );
          })}
        </div>
        {avatarProvider === "heygen" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 10, color: C.txT, marginBottom: 2 }}>API KEY</div>
                <input value={heyGenKey} onChange={e => setHeyGenKey(e.target.value)} placeholder="HeyGen API key" type="password" style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.txT, marginBottom: 2 }}>AVATAR ID</div>
                <input value={heyGenAvatar} onChange={e => setHeyGenAvatar(e.target.value)} placeholder="Avatar ID from HeyGen" style={inputStyle} />
              </div>
            </div>
            <button onClick={async () => {
              setTestResult("Testing HeyGen...");
              try {
                // Save settings first so the API has the latest key/avatar
                setSaving(true);
                await fetch("/api/config/voice", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: { heygen_api_key: heyGenKey.includes("...") ? undefined : heyGenKey, heygen_avatar_id: heyGenAvatar, avatar_provider: "heygen" } }) });
                setSaving(false);
                await new Promise(r => setTimeout(r, 500));
                const res = await fetch("/api/voice/heygen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_token" }) });
                if (res.ok) {
                  const d = await res.json();
                  if (d.session_token) setTestResult("\u2713 HeyGen connected — avatar token created");
                  else setTestResult("\u2717 HeyGen responded but no token returned");
                } else {
                  const status = res.status;
                  if (status === 400) setTestResult("\u2717 Invalid avatar ID — check the Avatar ID field");
                  else if (status === 401 || status === 403) setTestResult("\u2717 Invalid API key");
                  else setTestResult(`\u2717 HeyGen error: ${status}`);
                }
              } catch { setTestResult("\u2717 Could not reach HeyGen API"); }
              setTimeout(() => setTestResult(null), 5000);
            }} style={{ padding: "4px 12px", background: `${C.cyan}18`, border: `1px solid ${C.cyan}44`, borderRadius: 4, color: C.cyan, fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: F.mono }}>Test HeyGen</button>
          </div>
        )}
        {avatarProvider === "did" && (
          <div>
            <div style={{ fontSize: 11, color: C.info, padding: "4px 0 6px", display: "flex", alignItems: "center", gap: 6 }}>
              D-ID streaming avatar. Get your API key from <span style={{ color: C.cyan }}>studio.d-id.com</span> and presenter ID from the presenters gallery.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <div>
                <div style={{ fontSize: 10, color: C.txT, marginBottom: 2 }}>D-ID API KEY</div>
                <input value={didKey} onChange={e => setDidKey(e.target.value)} placeholder="Basic auth key" type="password" style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.txT, marginBottom: 2 }}>PRESENTER ID</div>
                <input value={didPresenter} onChange={e => setDidPresenter(e.target.value)} placeholder="e.g., v2_public_Amber@0zSz8kflCN" style={inputStyle} />
              </div>
            </div>
          </div>
        )}
        {avatarProvider === "comfyui" && (
          <div style={{ fontSize: 11, color: C.txT, padding: "6px 0" }}>
            {"\uD83D\uDEA7"} ComfyUI — self-hosted avatar generation. Requires ComfyUI + GPU (e.g., RTX 4090). Coming soon.
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
        {testResult && <span style={{ fontSize: 11, color: testResult.includes("fail") || testResult.includes("error") ? C.danger : C.brand, fontFamily: F.mono }}>{testResult}</span>}
        {voiceProvider === "elevenlabs" && (
          <Tooltip placement="top" variant="detail" content={<span>Speak a short test phrase through the saved ElevenLabs voice — verifies the API key and voice ID. Plays through your speakers; counts against your ElevenLabs character quota.</span>}>
            <button onClick={handleTestVoice} style={{ padding: "4px 12px", borderRadius: 4, border: `1px solid ${C.cyan}`, background: "transparent", color: C.cyan, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: F.sans }}>Test Voice</button>
          </Tooltip>
        )}
        <button onClick={handleSave} disabled={saving} style={{
          padding: "4px 14px", borderRadius: 4, border: "none",
          background: C.brand, color: C.bg, fontSize: 11, fontWeight: 700,
          fontFamily: F.sans, cursor: saving ? "not-allowed" : "pointer",
        }}>{saving ? "Saving..." : "Save"}</button>
      </div>
    </CollapsibleCard>
  );
}

// ---------------------------------------------------------------------------
// UI Preferences Card
// ---------------------------------------------------------------------------

function UIPreferencesCard({ onNavigate, focusedCard }: { onNavigate?: (tab: TabId, focus?: string) => void; focusedCard?: string | null }) {
  const [aiPanelDefault, setAiPanelDefault] = useState<"open" | "closed">("open");
  const [displayName, setDisplayName] = useState("");
  const [displayNameSaved, setDisplayNameSaved] = useState<string | null>(null);
  const [wizardResetStatus, setWizardResetStatus] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const resetWizard = useCallback(async () => {
    if (!confirm("Reset the Welcome Wizard? This clears any skipped steps and the dismissal flag so the wizard reappears on Fleet Command. Your other configuration is untouched.")) return;
    setResetting(true);
    setWizardResetStatus(null);
    // Clear every wizard-related flag by PUTting empty values.
    const keys = [
      "wizard_dismissed",
      "wizard_skip_provider",
      "wizard_skip_clawkeeper",
      "wizard_skip_cve",
      "wizard_skip_routing",
      "wizard_skip_shield",
    ];
    try {
      await Promise.all(keys.map(k =>
        fetch("/api/config/defaults", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: k, value: "" }),
        })
      ));
      setWizardResetStatus("Reset \u2713");
      // Briefly show success, then bounce the operator back to Fleet Command where the wizard will reappear.
      setTimeout(() => { setWizardResetStatus(null); onNavigate?.("fleet"); }, 1200);
    } catch {
      setWizardResetStatus("Error");
      setTimeout(() => setWizardResetStatus(null), 2500);
    } finally {
      setResetting(false);
    }
  }, [onNavigate]);

  useEffect(() => {
    fetch("/api/config/defaults").then(r => r.ok ? r.json() : null).then(d => {
      if (d?.settings?.ai_panel_default === "closed") setAiPanelDefault("closed");
      if (typeof d?.settings?.display_name === "string") setDisplayName(d.settings.display_name);
    }).catch(() => {});
  }, []);

  const toggleAiPanel = useCallback(async () => {
    const newVal = aiPanelDefault === "open" ? "closed" : "open";
    try {
      await fetch("/api/config/defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "ai_panel_default", value: newVal }),
      });
      setAiPanelDefault(newVal);
    } catch {}
  }, [aiPanelDefault]);

  const saveDisplayName = useCallback(async () => {
    try {
      await fetch("/api/config/defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "display_name", value: displayName }),
      });
      setDisplayNameSaved("Saved");
      setTimeout(() => setDisplayNameSaved(null), 2000);
    } catch {
      setDisplayNameSaved("Error");
      setTimeout(() => setDisplayNameSaved(null), 2000);
    }
  }, [displayName]);

  return (
    <CollapsibleCard title="UI PREFERENCES" accent={C.info} defaultOpen={false} focusKey="uiPreferences" focusedCard={focusedCard}>
      <div style={{ padding: "10px 14px", background: "rgba(16,29,52,0.3)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.04)", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.tx, marginBottom: 4 }}>Display Name</div>
        {/* Both onBlur AND an explicit Save button — onBlur covers the
            tab-away case so changes never get silently discarded; the
            button makes the persistence affordance visible (operators
            were looking for it and assumed nothing was saved). */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Tooltip placement="top" variant="detail" content={<span>Friendly name for this ClawNex instance. Surfaces in the header, Fleet Command instance row, scheduled report headers, and exported audit bundles. Saves on blur, Enter, or the SAVE button.</span>}>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              onBlur={saveDisplayName}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); saveDisplayName(); } }}
              placeholder="Leave empty to use hostname"
              style={{
                flex: 1,
                padding: "6px 10px",
                background: "rgba(0,0,0,0.3)",
                border: `1px solid ${C.txG}`,
                borderRadius: 6,
                color: C.tx,
                fontSize: 12,
                fontFamily: F.mono,
              }}
            />
          </Tooltip>
          <button
            onClick={saveDisplayName}
            style={{
              padding: "6px 14px",
              background: `${C.brand}22`,
              border: `1px solid ${C.brand}`,
              borderRadius: 6,
              color: C.brand,
              fontSize: 11,
              fontFamily: F.mono,
              fontWeight: 700,
              letterSpacing: "0.04em",
              cursor: "pointer",
            }}
          >SAVE</button>
          {displayNameSaved && (
            <span style={{ fontSize: 11, color: displayNameSaved === "Saved" ? C.green : C.danger, fontFamily: F.mono }}>
              {displayNameSaved}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: C.txT, marginTop: 4 }}>
          Shown in Fleet Command as your instance name. Leave blank to use the machine&apos;s hostname.
        </div>
      </div>
      <div style={{ padding: "10px 14px", background: "rgba(16,29,52,0.3)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.04)", marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.tx }}>AI Panel Default</div>
            <div style={{ fontSize: 11, color: C.txT, marginTop: 2 }}>
              {aiPanelDefault === "open" ? "AI chat panel opens automatically on load" : "AI chat panel starts closed on load"}
            </div>
          </div>
          <Tooltip placement="left" variant="detail" content={<span>Whether the right-side AI chat panel auto-expands when the dashboard loads. <strong>OPEN</strong> = always visible (good for power users), <strong>CLOSED</strong> = collapsed and out of the way (good for high-density panels). Operators can still toggle per-session from the chat icon.</span>}>
            <button onClick={toggleAiPanel} style={{
              padding: "4px 14px", borderRadius: 6,
              border: `1px solid ${aiPanelDefault === "open" ? C.brand : C.txG}`,
              background: aiPanelDefault === "open" ? `${C.brand}22` : "transparent",
              color: aiPanelDefault === "open" ? C.brand : C.txS,
              fontWeight: 700, fontSize: 11, fontFamily: F.mono, cursor: "pointer",
            }}>
              {aiPanelDefault === "open" ? "OPEN" : "CLOSED"}
            </button>
          </Tooltip>
        </div>
      </div>

      <div style={{ padding: "10px 14px", background: "rgba(16,29,52,0.3)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.04)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.tx }}>Welcome Wizard</div>
            <div style={{ fontSize: 11, color: C.txT, marginTop: 2, lineHeight: 1.5 }}>
              Clear the dismissal and any skipped-step flags so the Welcome Wizard reappears on Fleet Command. Useful when re-onboarding an operator or verifying setup after a config change. Your other configuration is untouched.
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
            <Tooltip placement="left" variant="compact" content="Re-shows the Welcome Wizard on Fleet Command. Other configuration is untouched.">
              <button onClick={resetWizard} disabled={resetting} style={{
                padding: "5px 14px",
                borderRadius: 6,
                border: `1px solid ${C.warn}44`,
                background: `${C.warn}18`,
                color: C.warn,
                fontWeight: 700,
                fontSize: 11,
                fontFamily: F.mono,
                cursor: resetting ? "wait" : "pointer",
                whiteSpace: "nowrap",
              }}>{resetting ? "Resetting..." : "Reset Wizard"}</button>
            </Tooltip>
            {wizardResetStatus && (
              <span style={{ fontSize: 10, color: wizardResetStatus === "Error" ? C.danger : C.green, fontFamily: F.mono }}>
                {wizardResetStatus}
              </span>
            )}
          </div>
        </div>
      </div>
    </CollapsibleCard>
  );
}

// ---------------------------------------------------------------------------
// Local Model Cost Rates Card
// ---------------------------------------------------------------------------

function LocalModelCostsCard() {
  const [rates, setRates] = useState<Record<string, { input: string; output: string }>>({});
  const [models, setModels] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [newModel, setNewModel] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/config/defaults");
        if (res.ok) {
          const d = await res.json();
          const stored = d.settings?.local_model_costs;
          if (stored) {
            try {
              const parsed = JSON.parse(stored);
              setRates(parsed);
              setModels(Object.keys(parsed));
            } catch {}
          }
        }
      } catch {}
      // Also fetch known models from config
      try {
        const res = await fetch("/api/config/models");
        if (res.ok) {
          const d = await res.json();
          const localModels = (d.models || []).filter((m: { provider_type: string }) => m.provider_type === "lmstudio").map((m: { model_id: string }) => m.model_id);
          setModels(prev => Array.from(new Set([...prev, ...localModels])));
        }
      } catch {}
    })();
  }, []);

  const saveRates = useCallback(async (updated: Record<string, { input: string; output: string }>) => {
    setRates(updated);
    try {
      await fetch("/api/config/defaults", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "local_model_costs", value: JSON.stringify(updated) }) });
      setSaved("Saved"); setTimeout(() => setSaved(null), 2000);
    } catch { setSaved("Error"); setTimeout(() => setSaved(null), 2000); }
  }, []);

  const addModel = useCallback(() => {
    if (!newModel.trim()) return;
    const updated = { ...rates, [newModel.trim()]: { input: "0", output: "0" } };
    setModels(prev => Array.from(new Set([...prev, newModel.trim()])));
    saveRates(updated);
    setNewModel("");
  }, [newModel, rates, saveRates]);

  return (
    <CollapsibleCard title="LOCAL MODEL COST RATES" accent={C.warn} count={models.length} defaultOpen={false}>
      <div style={{ fontSize: 10, color: C.txT, marginBottom: 10 }}>Set cost per million tokens for local models (input/output). Used in Fleet Cost and Cost by Agent calculations. Overrides openclaw.json rates.</div>
      {models.map(model => (
        <div key={model} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: `1px solid ${C.glassBorderSubtle}` }}>
          <span style={{ fontSize: 11, fontFamily: F.mono, color: C.txS, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{model}</span>
          <span style={{ fontSize: 9, color: C.txT }}>In:</span>
          <input value={rates[model]?.input || "0"} onChange={e => { const updated = { ...rates, [model]: { ...rates[model], input: e.target.value } }; setRates(updated); }} onBlur={e => { const updated = { ...rates, [model]: { ...rates[model], input: e.target.value } }; saveRates(updated); }} style={{ width: 60, padding: "2px 4px", fontSize: 10, fontFamily: F.mono, background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 3, color: C.tx, outline: "none", textAlign: "right" }} placeholder="0.00" />
          <span style={{ fontSize: 9, color: C.txT }}>Out:</span>
          <input value={rates[model]?.output || "0"} onChange={e => { const updated = { ...rates, [model]: { ...rates[model], output: e.target.value } }; setRates(updated); }} onBlur={e => { const updated = { ...rates, [model]: { ...rates[model], output: e.target.value } }; saveRates(updated); }} style={{ width: 60, padding: "2px 4px", fontSize: 10, fontFamily: F.mono, background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 3, color: C.tx, outline: "none", textAlign: "right" }} placeholder="0.00" />
          <span style={{ fontSize: 8, color: C.txT }}>$/M</span>
          <button onClick={() => { const updated = { ...rates }; delete updated[model]; setModels(prev => prev.filter(m => m !== model)); saveRates(updated); }} style={{ background: "none", border: "none", color: C.txT, fontSize: 12, cursor: "pointer", padding: "0 4px" }}>{"\u2715"}</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
        <Tooltip placement="top" variant="detail" content={<span>The exact model name as it appears in your local provider (LM Studio, Ollama, vLLM). Examples: <strong>llama-3.2-3b-instruct</strong>, <strong>qwen2.5-7b</strong>. It needs to match the name in traffic logs exactly, otherwise cost tracking won&apos;t attach to the right model.</span>}>
          <input value={newModel} onChange={e => setNewModel(e.target.value)} onKeyDown={e => e.key === "Enter" && addModel()} placeholder="model-name" style={{ flex: 1, padding: "3px 6px", fontSize: 10, fontFamily: F.mono, background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 3, color: C.tx, outline: "none" }} />
        </Tooltip>
        <Tooltip placement="top" variant="compact" content="Add the model with default $0 rates. Set per-million-token rates inline after.">
          <button onClick={addModel} disabled={!newModel.trim()} style={{ padding: "3px 8px", background: !newModel.trim() ? C.glassSurfTrans : `${C.warn}18`, border: `1px solid ${!newModel.trim() ? C.glassBorderSubtle : C.warn + "44"}`, borderRadius: 3, color: !newModel.trim() ? C.txT : C.warn, fontSize: 10, fontWeight: 600, cursor: !newModel.trim() ? "not-allowed" : "pointer", opacity: !newModel.trim() ? 0.5 : 1 }}>Add</button>
        </Tooltip>
      </div>
      {saved && <div style={{ marginTop: 4, fontSize: 10, color: saved === "Saved" ? C.green : C.danger }}>{saved === "Saved" ? "\u2713" : "\u2717"} {saved}</div>}
    </CollapsibleCard>
  );
}

// ---------------------------------------------------------------------------
// Agent Ignore Card
// ---------------------------------------------------------------------------

function AgentIgnoreCard() {
  const [patterns, setPatterns] = useState<string[]>([]);
  const [newPattern, setNewPattern] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchPatterns = useCallback(async () => {
    try {
      const res = await fetch("/api/config/agent-ignore");
      if (res.ok) { const data = await res.json(); setPatterns(data.patterns || []); }
    } catch {}
  }, []);

  useEffect(() => { fetchPatterns(); }, [fetchPatterns]);

  const handleAdd = useCallback(async () => {
    const trimmed = newPattern.trim();
    if (!trimmed || patterns.includes(trimmed)) return;
    setSaving(true);
    try {
      const updated = [...patterns, trimmed];
      const res = await fetch("/api/config/agent-ignore", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patterns: updated }),
      });
      if (res.ok) { setPatterns(updated); setNewPattern(""); }
    } catch {} finally { setSaving(false); }
  }, [newPattern, patterns]);

  const handleRemove = useCallback(async (pattern: string) => {
    setSaving(true);
    try {
      const updated = patterns.filter(p => p !== pattern);
      const res = await fetch("/api/config/agent-ignore", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patterns: updated }),
      });
      if (res.ok) { setPatterns(updated); }
    } catch {} finally { setSaving(false); }
  }, [patterns]);

  return (
    <CollapsibleCard title="AGENT IGNORE LIST" accent={C.orange} count={patterns.length} defaultOpen={false}>
      <div style={{ fontSize: 13, color: C.txS, marginBottom: 10, lineHeight: 1.5 }}>
        Internal agents matching these name prefixes are hidden from all dashboard views (Tools & Access, Agents & Sessions, etc.).
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        {patterns.map(p => (
          <div key={p} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "6px 10px", background: "rgba(16,29,52,0.3)", borderRadius: 6, border: "1px solid rgba(255,255,255,0.04)",
          }}>
            <span style={{ fontSize: 12, fontFamily: F.mono, color: C.tx }}>{p}</span>
            <button onClick={() => handleRemove(p)} disabled={saving} style={{
              padding: "2px 8px", borderRadius: 3, border: `1px solid ${C.danger}33`, background: "transparent",
              color: C.danger, fontSize: 10, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", fontFamily: F.mono,
            }}>REMOVE</button>
          </div>
        ))}
        {patterns.length === 0 && <span style={{ fontSize: 12, color: C.txT }}>No patterns configured — all agents are visible.</span>}
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <Tooltip placement="top" variant="detail" content={<span><strong>Prefix match</strong> on agent names — anything starting with this string gets hidden from view. Example: <strong>internal-</strong> hides <strong>internal-router</strong> and <strong>internal-watcher</strong>, but leaves <strong>internal_telemetry</strong> visible (different separator).</span>}>
          <input value={newPattern} onChange={e => setNewPattern(e.target.value)} placeholder="Agent name prefix..."
            onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
            style={{
              flex: 1, padding: "6px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4,
              color: C.tx, fontFamily: F.mono, fontSize: 12, outline: "none",
            }}
          />
        </Tooltip>
        <button onClick={handleAdd} disabled={!newPattern.trim() || saving} style={{
          padding: "6px 14px", borderRadius: 4, border: "none",
          background: newPattern.trim() ? C.orange : C.glassSurfTrans, color: C.bg,
          fontSize: 11, fontWeight: 700, fontFamily: F.sans,
          cursor: newPattern.trim() && !saving ? "pointer" : "not-allowed", opacity: newPattern.trim() ? 1 : 0.5,
        }}>Add</button>
      </div>
    </CollapsibleCard>
  );
}

// ---------------------------------------------------------------------------
// Data Retention Card
// ---------------------------------------------------------------------------

interface RetentionCategory {
  key: string;
  label: string;
  value: number;
  options: number[];
}

function DataRetentionCard() {
  const [categories, setCategories] = useState<RetentionCategory[]>([]);
  const [pending, setPending] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<string | null>(null);

  const fetchRetention = useCallback(async () => {
    try {
      const res = await fetch("/api/config/retention");
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories);
        setPending({});
        setDirty(false);
      }
    } catch {}
  }, []);

  useEffect(() => { fetchRetention(); }, [fetchRetention]);

  const handleChange = useCallback((key: string, value: number) => {
    setPending(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/config/retention", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: pending }),
      });
      if (res.ok) { fetchRetention(); }
    } catch {} finally { setSaving(false); }
  }, [pending, fetchRetention]);

  if (categories.length === 0) return null;

  const formatOption = (days: number) => {
    if (days === 0) return "Unlimited";
    if (days < 30) return `${days}d`;
    if (days < 365) return `${Math.round(days / 30)}mo`;
    return `${Math.round(days / 365)}yr`;
  };

  return (
    <CollapsibleCard title="DATA RETENTION" accent={C.purp} defaultOpen={false} actions={
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {dirty && <span style={{ fontSize: 11, color: C.warn, fontFamily: F.mono }}>unsaved</span>}
        <button onClick={handleSave} disabled={!dirty || saving} style={{
          padding: "3px 12px", borderRadius: 4, border: "none",
          background: dirty ? `linear-gradient(135deg, ${C.cyan} 0%, ${C.green} 100%)` : C.glassSurfTrans, color: C.bg,
          fontSize: 12, fontWeight: 700, fontFamily: F.sans,
          cursor: dirty && !saving ? "pointer" : "not-allowed", opacity: dirty ? 1 : 0.5,
        }}>
          {saving ? "Saving..." : "Save"}
        </button>
        <Tooltip placement="left" variant="detail" content={<span>Run the retention enforcer immediately instead of waiting for the next hourly cycle. Uses the <strong>currently saved</strong> windows — save unsaved changes first if you want them applied. Audit log entries are <strong>never</strong> purged this way; archive instead.</span>}>
          <button onClick={async () => {
            setPurging(true); setPurgeResult(null);
            try {
              const res = await fetch("/api/system/purge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "PURGE" }) });
              if (res.ok) { const d = await res.json(); const p = d.purged || {}; setPurgeResult(`Purged ${(p.traffic||0)+(p.alerts||0)+(p.audit||0)+(p.shieldScans||0)+(p.metrics||0)+(p.correlations||0)} rows`); }
              else { setPurgeResult("Purge failed"); }
            } catch { setPurgeResult("Purge error"); }
            finally { setPurging(false); setTimeout(() => setPurgeResult(null), 5000); }
          }} disabled={purging} style={{
            padding: "3px 12px", borderRadius: 4, border: `1px solid ${C.warn}44`,
            background: `${C.warn}18`, color: C.warn,
            fontSize: 12, fontWeight: 700, fontFamily: F.sans,
            cursor: purging ? "not-allowed" : "pointer", opacity: purging ? 0.5 : 1,
          }}>
            {purging ? "Purging..." : purgeResult || "Purge Now"}
          </button>
        </Tooltip>
      </div>
    }>
      <div style={{ fontSize: 13, color: C.txS, marginBottom: 12, lineHeight: 1.5 }}>
        Configure how long each data category is retained before automatic cleanup.
        Retention is enforced on startup and hourly. Changes take effect on the next enforcement cycle.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {categories.map((cat) => {
          const currentValue = pending[cat.key] ?? cat.value;
          // Per-category detail copy — only the high-value categories get a
          // tooltip, to keep the retention card uncluttered.
          const detailCopy: Record<string, React.ReactNode> = {
            retention_audit_days: (
              <span>
                The immutable audit trail — every config change, break-glass action, whitelist edit, and admin action. Set this to <strong>Unlimited</strong> when compliance requires permanent retention. Audit entries can&apos;t be cleared by &quot;Purge Now&quot;; if you need to clean them up, archive instead.
              </span>
            ),
            retention_traffic_days: (
              <span>
                Proxy request/response bodies and shield scan results. Keeping this short (1–7 days) saves a lot of disk. Extend only if you&apos;re running incident investigations that reach back further.
              </span>
            ),
          };
          const labelNode = (
            <div style={{ fontSize: 13, fontWeight: 600, color: C.tx }}>{cat.label.split(" (")[0]}</div>
          );
          return (
            <div key={cat.key} style={{
              padding: "10px 14px", background: C.bg, borderRadius: 8,
              border: `1px solid ${cat.key in pending ? C.purp : C.glassBorderSubtle}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  {detailCopy[cat.key] ? (
                    <Tooltip as="div" placement="right" variant="detail" content={detailCopy[cat.key]}>
                      {labelNode}
                    </Tooltip>
                  ) : labelNode}
                  <div style={{ fontSize: 11, color: C.txT, fontFamily: F.mono, marginTop: 2 }}>
                    {cat.label.includes("(") ? cat.label.split("(")[1].replace(")", "") : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {cat.options.map((opt) => (
                    <button key={opt} onClick={() => handleChange(cat.key, opt)} style={{
                      padding: "4px 10px", borderRadius: 4, fontSize: 11, fontFamily: F.mono, fontWeight: 600,
                      border: `1px solid ${currentValue === opt ? C.purp : C.glassBorderSubtle}`,
                      background: currentValue === opt ? `${C.purp}22` : "transparent",
                      color: currentValue === opt ? C.purp : C.txS,
                      cursor: "pointer",
                    }}>
                      {formatOption(opt)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </CollapsibleCard>
  );
}

// ---------------------------------------------------------------------------
// OpenClaw Routing Guide
// ---------------------------------------------------------------------------

// Sidecar shape echoed from GET /api/openclaw/routing — see
// src/lib/services/openclaw-routing-wire.ts SidecarV1.
interface RoutingSidecar {
  version: number;
  managedAt: string;
  clawnexVersion: string;
  openclawVersion: string | null;
  providerId: string;
  paths: Array<{ path: string[]; valueSha256: string; operation: 'set' | 'set-if-missing' }>;
}

interface ConnectorRoutingItem {
  id: string;
  connector: 'openclaw' | 'hermes';
  sourceId: string;
  itemType: 'provider' | 'model';
  providerId: string;
  modelId: string;
  displayName: string;
  baseUrl: string | null;
  capability: 'provider-routing' | 'model-inventory' | 'read-only' | 'unsupported';
  currentRoute: 'routed' | 'direct' | 'unknown' | 'unsupported';
  desiredRoute: 'routed' | 'direct';
  present: boolean;
  metadata: Record<string, unknown>;
  isNew?: boolean;
  isRemoved?: boolean;
  isChanged?: boolean;
}

interface ConnectorRoutingSummary {
  status: 'ok' | 'missing' | 'read-only' | 'error';
  detail: string;
  items: ConnectorRoutingItem[];
  drift: { new: number; removed: number; changed: number; total: number };
  selected: number;
  scannedAt: string;
}

interface ConnectorRoutingResponse {
  litellmTarget: string;
  openclaw: ConnectorRoutingSummary;
  hermes: ConnectorRoutingSummary;
  driftTotal: number;
  scannedAt: string;
}

function OpenClawRoutingGuide({ focusedCard }: { focusedCard?: string | null }) {
  const [routingData, setRoutingData] = useState<{ providers: Array<{ id: string; name: string; baseUrl: string; routed: boolean }> } | null>(null);
  const [connectorRouting, setConnectorRouting] = useState<ConnectorRoutingResponse | null>(null);
  const [sidecar, setSidecar] = useState<RoutingSidecar | null>(null);
  const [openclawVersion, setOpenClawVersion] = useState<string | null>(null);
  const [configMissing, setConfigMissing] = useState(false);
  const [loading, setLoading] = useState(false);
  // Wire/revert/restart action state. `working` blocks repeat clicks;
  // `lastResult` surfaces the API's status + detail so the operator
  // sees exactly what happened (wired / already-wired / conflict /
  // reverted / preserved paths / restartRequired / gateway restarted
  // / supervisor detected).
  const [working, setWorking] = useState<'wire' | 'revert' | 'force-wire' | 'restart' | null>(null);
  const [lastResult, setLastResult] = useState<{ ok: boolean; status: string; detail: string; preservedPaths?: string[][]; reclaimedDespiteEditPaths?: string[][]; restartRequired?: boolean; output?: string; elapsedMs?: number; supervisor?: string; manualCommand?: string } | null>(null);
  const [connectorWorking, setConnectorWorking] = useState<'sync' | 'select' | 'apply-openclaw' | 'apply-hermes' | 'revert-hermes' | 'restart-hermes' | null>(null);
  const [connectorResult, setConnectorResult] = useState<{ ok: boolean; status: string; detail: string; restartRequired?: boolean; connector?: 'openclaw' | 'hermes' | 'all' } | null>(null);
  // Gateway supervisor probe -- determines whether we render an active
  // Restart button or a "manual command" hint. Probed once on mount;
  // re-probed after any wire/revert/restart so the button stays honest.
  const [supervisor, setSupervisor] = useState<{ kind: string; label: string; manualCommand: string } | null>(null);
  const [hermesSupervisor, setHermesSupervisor] = useState<{ kind: string; label: string; manualCommand: string; targets?: string[] } | null>(null);

  const fetchRouting = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/openclaw/routing");
      if (res.ok) {
        const d = await res.json();
        if (d.found) {
          setRoutingData({ providers: d.providers });
          setSidecar(d.managed?.sidecar ?? null);
          setOpenClawVersion(d.openclawVersion ?? null);
          setConfigMissing(false);
        } else {
          setConfigMissing(true);
          setRoutingData(null);
          setSidecar(null);
        }
      } else {
        setConfigMissing(true);
      }
    } catch {
      setConfigMissing(true);
    }
    setLoading(false);
  }, []);

  const fetchConnectorRouting = useCallback(async () => {
    try {
      const res = await fetch("/api/connector-routing");
      if (res.ok) {
        setConnectorRouting(await res.json());
      }
    } catch { /* inventory is advisory; keep the OpenClaw routing card usable */ }
  }, []);

  const fetchSupervisor = useCallback(async () => {
    try {
      const res = await fetch("/api/openclaw/gateway/restart");
      if (res.ok) {
        const d = await res.json();
        if (d.ok && d.supervisor) setSupervisor(d.supervisor);
      }
    } catch { /* silent -- the manual hint is the fallback */ }
  }, []);

  const fetchHermesSupervisor = useCallback(async () => {
    try {
      const res = await fetch("/api/hermes/gateway/restart");
      if (res.ok) {
        const d = await res.json();
        if (d.ok && d.supervisor) setHermesSupervisor(d.supervisor);
      }
    } catch { /* silent -- Hermes restart falls back to manual guidance */ }
  }, []);

  useEffect(() => { fetchRouting(); fetchSupervisor(); fetchHermesSupervisor(); fetchConnectorRouting(); }, [fetchRouting, fetchSupervisor, fetchHermesSupervisor, fetchConnectorRouting]);

  const performRestart = useCallback(async () => {
    setWorking('restart');
    setLastResult(null);
    try {
      const res = await fetch("/api/openclaw/gateway/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const d = await res.json();
      setLastResult({
        ok: Boolean(d.ok),
        status: d.status || (res.ok ? 'ok' : 'error'),
        detail: d.detail || d.error || 'No detail returned.',
        output: d.output,
        elapsedMs: d.elapsedMs,
        supervisor: d.supervisor,
        manualCommand: d.manualCommand,
      });
    } catch (err) {
      setLastResult({
        ok: false,
        status: 'error',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    setWorking(null);
  }, []);

  const performAction = useCallback(async (action: 'wire' | 'revert' | 'force-wire') => {
    setWorking(action);
    setLastResult(null);
    try {
      const body = action === 'force-wire' ? { action: 'wire', force: true } : { action };
      const res = await fetch("/api/openclaw/routing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      setLastResult({
        ok: Boolean(d.ok),
        status: d.status || (res.ok ? 'ok' : 'error'),
        detail: d.detail || d.error || 'No detail returned.',
        preservedPaths: d.preservedPaths,
        reclaimedDespiteEditPaths: d.reclaimedDespiteEditPaths,
        restartRequired: d.restartRequired,
      });
      // Re-read state so the badges refresh (ROUTED indicator, sidecar block).
      await fetchRouting();
      await fetchConnectorRouting();
    } catch (err) {
      setLastResult({
        ok: false,
        status: 'error',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    setWorking(null);
  }, [fetchRouting, fetchConnectorRouting]);

  const selectConnectorItem = useCallback(async (item: ConnectorRoutingItem, desiredRoute: 'routed' | 'direct') => {
    setConnectorWorking('select');
    setConnectorResult(null);
    try {
      const res = await fetch("/api/connector-routing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "select",
          connector: item.connector,
          itemIds: [item.id],
          desiredRoute,
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || "Failed to update selection");
      await fetchConnectorRouting();
    } catch (err) {
      setConnectorResult({
        ok: false,
        status: "selection_error",
        detail: err instanceof Error ? err.message : String(err),
        connector: item.connector,
      });
    }
    setConnectorWorking(null);
  }, [fetchConnectorRouting]);

  const syncConnectorInventory = useCallback(async () => {
    setConnectorWorking('sync');
    setConnectorResult(null);
    try {
      const res = await fetch("/api/connector-routing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || "Failed to sync routing inventory");
      setConnectorRouting(d as ConnectorRoutingResponse);
      setConnectorResult({ ok: true, status: "synced", detail: `Inventory synced. ${d.driftTotal || 0} change(s) need review.`, connector: "all" });
    } catch (err) {
      setConnectorResult({ ok: false, status: "sync_error", detail: err instanceof Error ? err.message : String(err), connector: "all" });
    }
    setConnectorWorking(null);
  }, []);

  const applySelectedOpenClawRouting = useCallback(async () => {
    setConnectorWorking('apply-openclaw');
    setConnectorResult(null);
    try {
      const res = await fetch("/api/connector-routing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply-openclaw" }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || d.result?.detail || "Failed to apply OpenClaw routing");
      setConnectorResult({
        ok: true,
        status: d.result?.status || "applied",
        detail: d.result?.detail || "OpenClaw routing applied.",
        restartRequired: Boolean(d.result?.restartRequired),
        connector: "openclaw",
      });
      await fetchRouting();
      await fetchConnectorRouting();
    } catch (err) {
      setConnectorResult({ ok: false, status: "apply_error", detail: err instanceof Error ? err.message : String(err), connector: "openclaw" });
    }
    setConnectorWorking(null);
  }, [fetchConnectorRouting, fetchRouting]);

  const applySelectedHermesRouting = useCallback(async () => {
    setConnectorWorking('apply-hermes');
    setConnectorResult(null);
    try {
      const res = await fetch("/api/connector-routing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply-hermes" }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || d.result?.detail || "Failed to apply Hermes routing");
      setConnectorResult({
        ok: true,
        status: d.result?.status || "applied",
        detail: d.result?.detail || "Hermes routing applied.",
        restartRequired: Boolean(d.result?.restartRequired),
        connector: "hermes",
      });
      await fetchConnectorRouting();
    } catch (err) {
      setConnectorResult({ ok: false, status: "apply_error", detail: err instanceof Error ? err.message : String(err), connector: "hermes" });
    }
    setConnectorWorking(null);
  }, [fetchConnectorRouting]);

  const revertHermesWire = useCallback(async () => {
    setConnectorWorking('revert-hermes');
    setConnectorResult(null);
    try {
      const res = await fetch("/api/connector-routing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revert-hermes" }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || d.result?.detail || "Failed to revert Hermes wire");
      setConnectorResult({
        ok: true,
        status: d.result?.status || "reverted",
        detail: d.result?.detail || "Hermes wire reverted.",
        restartRequired: Boolean(d.result?.restartRequired),
        connector: "hermes",
      });
      await fetchConnectorRouting();
    } catch (err) {
      setConnectorResult({ ok: false, status: "revert_error", detail: err instanceof Error ? err.message : String(err), connector: "hermes" });
    }
    setConnectorWorking(null);
  }, [fetchConnectorRouting]);

  const restartHermesGateway = useCallback(async () => {
    setConnectorWorking('restart-hermes');
    setConnectorResult(null);
    try {
      const res = await fetch("/api/hermes/gateway/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || d.detail || "Failed to restart Hermes gateway");
      setConnectorResult({
        ok: true,
        status: d.status || "restarted",
        detail: d.detail || "Hermes gateway restarted.",
        connector: "hermes",
      });
      await fetchHermesSupervisor();
      await fetchConnectorRouting();
    } catch (err) {
      setConnectorResult({ ok: false, status: "restart_error", detail: err instanceof Error ? err.message : String(err), connector: "hermes" });
    }
    setConnectorWorking(null);
  }, [fetchConnectorRouting, fetchHermesSupervisor]);

  const litellmUrl = connectorRouting?.litellmTarget || "http://127.0.0.1:4001/v1";
  const providerLevelHelp = (
    <span>
      OpenClaw and Hermes custom providers route by provider endpoint, not by
      independent per-model switches. If several models share the same provider,
      selecting one model routes that provider&apos;s endpoint through LiteLLM, so
      sibling models on that provider follow the same route.
    </span>
  );
  const connectorActionRowStyle: React.CSSProperties = {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
    marginBottom: 10,
  };
  const connectorRoutingLegend = [
    {
      label: "PROVIDER",
      color: C.info,
      description: "An upstream endpoint group in OpenClaw or a Hermes custom_provider. Routing is enforced at this provider endpoint.",
    },
    {
      label: "MODEL",
      color: C.purp,
      description: <span>An advertised model under a provider. Selecting one model protects that provider&apos;s traffic because connector routing is enforced at provider endpoints.</span>,
    },
    {
      label: "PROXY BRIDGE",
      color: C.green,
      description: "The local LiteLLM bridge that ClawNex owns. It is shown for transparency but is not a selectable upstream provider.",
    },
    {
      label: "ROUTED",
      color: C.green,
      description: "Traffic currently flows through the ClawNex LiteLLM proxy, so real-time Prompt Shield scanning is active.",
    },
    {
      label: "DIRECT",
      color: C.warn,
      description: "Traffic goes directly to the upstream provider. ClawNex may still see it later through the Session Watcher, but real-time shield scanning is bypassed.",
    },
    {
      label: "SELECTED",
      color: C.brand,
      description: "The operator has marked this provider/model for routing on the next connector-specific Apply action.",
    },
    {
      label: "READ-ONLY",
      color: C.txT,
      description: "Observed inventory only. OAuth/session-bound or watcher-only rows cannot be safely rewritten by ClawNex.",
    },
  ];

  // Wire-state classification feeds the button bank below.
  // - `managed`: sidecar present AND its provider path is currently in
  //   openclaw.json (the steady-state "ClawNex wired this") condition.
  // - `conflict`: there's a `litellm` provider in openclaw.json that
  //   doesn't have a sidecar — operator-owned or stale ClawNex wire.
  //   Force Wire reclaims it.
  // - `unwired`: no `litellm` entry, no sidecar — fresh state, primary
  //   action is Wire.
  const litellmProvider = routingData?.providers.find(p => p.id === 'litellm');
  const wireState: 'managed' | 'conflict' | 'unwired' | 'unknown' =
    sidecar && litellmProvider ? 'managed' :
    !sidecar && litellmProvider ? 'conflict' :
    !litellmProvider && !configMissing ? 'unwired' :
    'unknown';

  const renderConnectorInventory = (summary: ConnectorRoutingSummary, connector: 'openclaw' | 'hermes') => {
    const presentItems = summary.items.filter(item => item.present);
    const removedItems = summary.items.filter(item => !item.present).slice(0, 6);
    if (presentItems.length === 0 && removedItems.length === 0) {
      return (
        <div style={{ padding: "8px 10px", border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, fontSize: 11, color: C.txS, lineHeight: 1.5 }}>
          {summary.detail}
        </div>
      );
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {presentItems.map(item => {
          const isProxyBridge = (connector === 'openclaw' && item.providerId === 'litellm') || (connector === 'hermes' && item.providerId === 'clawnex-litellm');
          const isReadOnly = item.capability === 'read-only' || item.capability === 'unsupported';
          const canRoute = !isProxyBridge && !isReadOnly;
          const checked = item.desiredRoute === 'routed';
          const selectedForApply = checked && !isProxyBridge;
          const driftLabel = item.isNew ? "NEW" : item.isChanged ? "CHANGED" : null;
          const typeBadgeLabel = isProxyBridge ? "PROXY BRIDGE" : item.itemType.toUpperCase();
          const typeBadgeColor = isProxyBridge ? C.green : item.itemType === 'provider' ? C.info : C.purp;
          return (
            <div key={item.id} style={{
              display: "grid",
              gridTemplateColumns: "24px minmax(160px, 1fr) minmax(180px, 1.4fr) auto",
              gap: 8,
              alignItems: "center",
              padding: "8px 10px",
              border: `1px solid ${selectedForApply ? `${C.brand}55` : C.glassBorderSubtle}`,
              borderLeft: `3px solid ${item.currentRoute === 'routed' ? C.green : item.currentRoute === 'direct' ? C.warn : C.txT}`,
              borderRadius: 4,
              background: selectedForApply ? `${C.brand}08` : C.glassSurfTrans,
            }}>
              <input
                type="checkbox"
                checked={isProxyBridge ? false : checked}
                disabled={!canRoute || connectorWorking !== null}
                onChange={(e) => selectConnectorItem(item, e.target.checked ? 'routed' : 'direct')}
                aria-label={isProxyBridge ? `${item.displayName} is the local proxy bridge and cannot be selected` : `${checked ? "Do not route" : "Route"} ${item.displayName}`}
                style={{ width: 15, height: 15, accentColor: C.brand, cursor: canRoute ? "pointer" : "not-allowed" }}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.tx }}>
                    {item.itemType === 'model' ? `${item.providerId}/${item.modelId}` : item.displayName}
                  </span>
                  <Badge label={typeBadgeLabel} color={typeBadgeColor} tip={null} />
                  {driftLabel && <Badge label={driftLabel} color={C.warn} tip={null} />}
                  {isReadOnly && !isProxyBridge && <Badge label="READ-ONLY" color={C.txT} tip={null} />}
                </div>
                {item.itemType === 'model' && item.displayName !== item.modelId && (
                  <div style={{ fontSize: 10, color: C.txT, marginTop: 2 }}>{item.displayName}</div>
                )}
              </div>
              <div style={{ minWidth: 0, fontSize: 10, fontFamily: F.mono, color: C.txT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.baseUrl || (connector === 'hermes' ? "observed-only / no writable endpoint" : "no endpoint")}
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, flexWrap: "wrap" }}>
                <Badge label={item.currentRoute.toUpperCase()} color={item.currentRoute === 'routed' ? C.green : item.currentRoute === 'direct' ? C.warn : C.txT} tip={null} />
                {selectedForApply && <Badge label="SELECTED" color={C.brand} tip={null} />}
              </div>
            </div>
          );
        })}
        {removedItems.length > 0 && (
          <div style={{ marginTop: 4, padding: "8px 10px", border: `1px solid ${C.warn}33`, borderRadius: 4, background: `${C.warn}08`, fontSize: 11, color: C.txS }}>
            <strong style={{ color: C.warn }}>Removed since last scan:</strong>{" "}
            {removedItems.map(item => item.itemType === 'model' ? `${item.providerId}/${item.modelId}` : item.providerId).join(", ")}
          </div>
        )}
      </div>
    );
  };

  const renderConnectorResult = (connector: 'openclaw' | 'hermes') => {
    if (!connectorResult) return null;
    if (connectorResult.connector && connectorResult.connector !== "all" && connectorResult.connector !== connector) return null;
    return (
      <div style={{
        marginTop: 10, padding: "8px 10px", borderRadius: 4,
        background: connectorResult.ok ? `${C.green}08` : `${C.danger}08`,
        border: `1px solid ${connectorResult.ok ? C.green : C.danger}33`,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: connectorResult.ok ? C.green : C.danger, marginBottom: 4 }}>
          {connectorResult.status}
        </div>
        <div style={{ fontSize: 11, color: C.txS, lineHeight: 1.5 }}>{connectorResult.detail}</div>
        {connectorResult.restartRequired && (
          <div style={{ marginTop: 6, color: C.warn, fontSize: 11 }}>
            Restart the affected {connector === "openclaw" ? "OpenClaw gateway" : "Hermes runtime"} to apply the selected routing changes.
          </div>
        )}
      </div>
    );
  };

  return (
    <>
    <CollapsibleCard title="OPENCLAW ROUTING" accent={C.info} defaultOpen={false} focusKey="openclawRouting" focusedCard={focusedCard}>
      <div style={{ fontSize: 12, color: C.txS, marginBottom: 10, lineHeight: 1.5 }}>
        For ClawNex to scan LLM traffic, OpenClaw providers must route through the LiteLLM proxy (port 4001).
        Providers not routing through LiteLLM will bypass the Prompt Shield — traffic won't be scanned.
      </div>

      {loading && <LoadingSpinner />}

      {configMissing && !loading && (
        <span style={{ fontSize: 12, color: C.warn }}>Could not read openclaw.json. Ensure OpenClaw is installed.</span>
      )}

      {!configMissing && routingData && routingData.providers.length === 0 && !loading && (
        <div style={{ padding: "10px 12px", background: `${C.info}08`, border: `1px solid ${C.info}22`, borderRadius: 6, fontSize: 12, color: C.txS, lineHeight: 1.5 }}>
          OpenClaw config found, but no LLM providers are registered in <span style={{ fontFamily: F.mono, color: C.cyan }}>openclaw.json</span> yet.
          Add a provider in OpenClaw first — ClawNex will then show its routing status here.
        </div>
      )}

      {routingData && routingData.providers.length > 0 ? (
        <div>
          {routingData.providers.map(p => (
            <div key={p.id} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", marginBottom: 4,
              background: p.routed ? `${C.green}06` : `${C.warn}06`,
              borderLeft: `3px solid ${p.routed ? C.green : C.warn}`,
              borderRadius: 4,
            }}>
              <Dot color={p.routed ? C.green : C.warn} size={6} />
              <span style={{ fontSize: 12, fontWeight: 600, color: C.tx, minWidth: 120 }}>{p.name || p.id}</span>
              <span style={{ fontSize: 10, fontFamily: F.mono, color: C.txT, flex: 1 }}>{p.baseUrl}</span>
              {p.routed ? (
                <Tooltip placement="left" variant="detail" content={
                  <span>
                    Traffic from this provider goes through the local safety proxy first, so the <strong style={{ color: C.brand }}>Prompt Shield</strong> scans every request before it reaches the model.
                  </span>
                }>
                  <span><Badge label="ROUTED" color={C.green} /></span>
                </Tooltip>
              ) : (
                <Tooltip placement="left" variant="detail" content={
                  <span>
                    Provider traffic <strong>bypasses</strong> LiteLLM and goes directly to the upstream (often because OAuth or subscription auth can&apos;t be proxied). Real-time scanning is off, but traffic is still visible <em>retroactively</em> through the <strong style={{ color: C.cyan }}>Session Watcher</strong>, which tails each agent&apos;s session files on disk.
                  </span>
                }>
                  <span><Badge label="DIRECT" color={C.warn} /></span>
                </Tooltip>
              )}
            </div>
          ))}

          {routingData.providers.some(p => !p.routed) && (
            <div style={{ marginTop: 10, padding: "10px 12px", background: `${C.info}08`, border: `1px solid ${C.info}22`, borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: C.info, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Heads Up — DIRECT Providers</div>
              <div style={{ fontSize: 11, color: C.txS, lineHeight: 1.6 }}>
                Providers marked <span style={{ fontFamily: F.mono, color: C.warn, fontWeight: 700 }}>DIRECT</span> bypass the Prompt Shield&apos;s real-time scanning. This is often intentional:
                OAuth and subscription-based providers (Claude.ai, ChatGPT Pro, Gemini, etc.) can&apos;t be proxied because their auth is bound to the client session. Their traffic
                is still visible <em>retroactively</em> through the <span style={{ fontFamily: F.mono, color: C.cyan }}>Session Watcher</span>, which tails each agent&apos;s session files on disk.
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: C.txS, lineHeight: 1.6 }}>
                If you want <strong>real-time</strong> scanning for an API-based provider instead, use the <strong>OpenClaw Selective Routing</strong> section below: tick the provider/model, apply routing, then restart the gateway.
              </div>
              <div style={{ marginTop: 6, padding: "6px 10px", background: C.bg, borderRadius: 4, fontFamily: F.mono, fontSize: 12, color: C.brand }}>{litellmUrl}</div>
              <div style={{ fontSize: 10, color: C.txT, marginTop: 6 }}>
                OpenClaw enforces routing at{" "}
                <Tooltip placement="top" variant="detail" content={providerLevelHelp}>
                  <span style={{ color: C.warn, cursor: "help", borderBottom: `1px dotted ${C.warn}` }}>provider endpoint level</span>
                </Tooltip>
                , so selected models route through their provider.
              </div>
            </div>
          )}

          {routingData.providers.every(p => p.routed) && (
            <div style={{ marginTop: 8, fontSize: 11, color: C.green, fontWeight: 600 }}>{"\u2713"} All providers routed through ClawNex shield</div>
          )}
        </div>
      ) : null}

      {connectorRouting && (
        <div style={{ marginTop: 12, padding: "10px 12px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              OpenClaw Selective Routing
            </span>
            {connectorRouting.openclaw.drift.total > 0 ? <Badge label={`${connectorRouting.openclaw.drift.total} CHANGE${connectorRouting.openclaw.drift.total === 1 ? "" : "S"}`} color={C.warn} /> : <Badge label="IN SYNC" color={C.green} />}
            <span style={{ marginLeft: "auto", fontSize: 10, color: C.txT, fontFamily: F.mono }}>
              target {connectorRouting.litellmTarget}
            </span>
          </div>

          {connectorRouting.openclaw.drift.total > 0 && (
            <div style={{ marginBottom: 10, padding: "8px 10px", border: `1px solid ${C.warn}44`, borderRadius: 4, background: `${C.warn}10`, fontSize: 11, color: C.txS, lineHeight: 1.5 }}>
              OpenClaw inventory changed. Review new or removed providers/models before assuming traffic is protected.
            </div>
          )}

          <div style={connectorActionRowStyle}>
            <button
              onClick={syncConnectorInventory}
              disabled={connectorWorking !== null}
              style={{
                padding: "6px 12px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                background: connectorWorking === 'sync' ? `${C.info}33` : `${C.info}14`,
                border: `1px solid ${C.info}66`, color: C.info,
                cursor: connectorWorking ? "wait" : "pointer", fontFamily: F.sans,
              }}
            >
              {connectorWorking === 'sync' ? "Syncing..." : "Sync Inventory"}
            </button>
            <button
              onClick={applySelectedOpenClawRouting}
              disabled={connectorWorking !== null || connectorRouting.openclaw.selected === 0}
              style={{
                padding: "6px 12px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                background: connectorWorking === 'apply-openclaw' ? `${C.brand}33` : `${C.brand}18`,
                border: `1px solid ${C.brand}66`, color: C.brand,
                cursor: connectorWorking || connectorRouting.openclaw.selected === 0 ? "not-allowed" : "pointer", fontFamily: F.sans,
                opacity: connectorRouting.openclaw.selected === 0 ? 0.55 : 1,
              }}
            >
              {connectorWorking === 'apply-openclaw' ? "Applying..." : `Apply OpenClaw Routing (${connectorRouting.openclaw.selected})`}
            </button>
            {wireState === 'unwired' && (
              <button
                onClick={() => performAction('wire')}
                disabled={working !== null}
                style={{
                  padding: "6px 12px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                  background: working === 'wire' ? `${C.brand}33` : `${C.brand}22`,
                  border: `1px solid ${C.brand}66`, color: C.brand,
                  cursor: working ? "wait" : "pointer", fontFamily: F.sans,
                }}
              >
                {working === 'wire' ? "Wiring..." : "Wire LiteLLM"}
              </button>
            )}

              {wireState === 'conflict' && (
                <button
                  onClick={() => performAction('force-wire')}
                  disabled={working !== null}
                  style={{
                    padding: "6px 12px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                    background: working === 'force-wire' ? `${C.warn}33` : `${C.warn}22`,
                    border: `1px solid ${C.warn}66`, color: C.warn,
                    cursor: working ? "wait" : "pointer", fontFamily: F.sans,
                  }}
                >
                  {working === 'force-wire' ? "Force-Wiring..." : "Force Wire (overwrite)"}
                </button>
              )}

              {wireState === 'managed' && (
                <button
                  onClick={() => performAction('revert')}
                  disabled={working !== null}
                  style={{
                    padding: "6px 12px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                    background: working === 'revert' ? `${C.warn}33` : `${C.warn}14`,
                    border: `1px solid ${C.warn}66`, color: C.warn,
                    cursor: working ? "wait" : "pointer", fontFamily: F.sans,
                  }}
                >
                  {working === 'revert' ? "Reverting..." : "Revert ClawNex Wire"}
                </button>
              )}

              {supervisor && supervisor.kind !== 'unsupported' && (
                <Tooltip placement="top" variant="detail" content={
                  <span>
                    Restarts the long-running <span style={{ fontFamily: F.mono, color: C.cyan }}>openclaw-gateway</span> daemon
                    via <strong>{supervisor.label}</strong> so it picks up routing changes from <span style={{ fontFamily: F.mono, color: C.cyan }}>openclaw.json</span>.
                    No SSH required.
                  </span>
                }>
                  <button
                    onClick={performRestart}
                    disabled={working !== null}
                    style={{
                      padding: "6px 12px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                      background: working === 'restart' ? `${C.cyan}33` : `${C.cyan}14`,
                      border: `1px solid ${C.cyan}66`, color: C.cyan,
                      cursor: working ? "wait" : "pointer", fontFamily: F.sans,
                    }}
                  >
                    {working === 'restart' ? "Restarting..." : "Restart Gateway"}
                  </button>
                </Tooltip>
              )}

              {supervisor && supervisor.kind === 'unsupported' && (
                <Tooltip placement="top" variant="detail" content={
                  <span>
                    Auto-restart is not supported on this host. Manual fallback:
                    <span style={{ fontFamily: F.mono, color: C.cyan }}> {supervisor.manualCommand}</span>
                  </span>
                }>
                  <button
                    disabled
                    style={{
                      padding: "6px 12px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                      background: `${C.txT}10`, border: `1px solid ${C.glassBorderSubtle}`,
                      color: C.txT, cursor: "not-allowed", fontFamily: F.sans,
                    }}
                  >
                    Restart Gateway
                  </button>
                </Tooltip>
              )}

            <button
              onClick={() => { fetchRouting(); fetchSupervisor(); fetchConnectorRouting(); }}
              disabled={working !== null}
              style={{
                padding: "6px 12px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                background: "transparent", border: `1px solid ${C.glassBorderSubtle}`, color: C.txS,
                cursor: working ? "wait" : "pointer", fontFamily: F.sans,
              }}
            >
              Refresh
            </button>
          </div>

          <div style={{ fontSize: 11, color: C.txS, lineHeight: 1.5, marginBottom: 10 }}>
            OpenClaw enforces routing by{" "}
            <Tooltip placement="top" variant="detail" content={providerLevelHelp}>
              <span style={{ color: C.warn, cursor: "help", borderBottom: `1px dotted ${C.warn}` }}>provider endpoint</span>
            </Tooltip>
            . Selecting an individual model marks it for protection and routes that model&apos;s provider through LiteLLM when applied.
          </div>

          <BadgeLegend items={connectorRoutingLegend} title="OpenClaw routing labels" style={{ marginBottom: 10 }} />

          {renderConnectorInventory(connectorRouting.openclaw, 'openclaw')}
          {renderConnectorResult('openclaw')}
        </div>
      )}

      {/* ClawNex-managed wire/revert. The engine at
          src/lib/services/openclaw-routing-wire.ts writes a single
          `models.providers.litellm` entry and (if unset) a primary
          model alias, tracking ownership in a sidecar at
          ~/.clawnex-routing-managed.json so revert can be precise.
          OpenClaw schema is identical for our use case across 2026.3.x
          and 2026.4.x -- `meta.lastTouchedVersion` is recorded in the
          sidecar for audit. */}
      {!configMissing && (
        <div style={{ marginTop: 12, padding: "10px 12px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              ClawNex-Managed Routing
            </span>
            {wireState === 'managed' && <Badge label="WIRED" color={C.green} />}
            {wireState === 'conflict' && <Badge label="OPERATOR-OWNED" color={C.warn} />}
            {wireState === 'unwired' && <Badge label="NOT WIRED" color={C.txT} />}
            {openclawVersion && (
              <span style={{ fontSize: 10, fontFamily: F.mono, color: C.txT, marginLeft: "auto" }}>
                OpenClaw {openclawVersion}
              </span>
            )}
          </div>

          {wireState === 'managed' && sidecar && (
            <div style={{ fontSize: 11, color: C.txS, lineHeight: 1.5, marginBottom: 8 }}>
              ClawNex wrote {sidecar.paths.length} path(s) on{" "}
              <span style={{ fontFamily: F.mono, color: C.txS }}>
                {new Date(sidecar.managedAt).toLocaleString()}
              </span>
              . Revert removes only paths whose values still match the recorded fingerprints
              -- operator edits made after the wire are preserved automatically.
            </div>
          )}

          {wireState === 'conflict' && (
            <div style={{ fontSize: 11, color: C.txS, lineHeight: 1.5, marginBottom: 8 }}>
              <span style={{ fontFamily: F.mono, color: C.cyan }}>models.providers.litellm</span> already exists in openclaw.json
              but ClawNex doesn&apos;t have a sidecar for it. <strong>Force Wire</strong> overwrites the existing entry with
              ClawNex&apos;s canonical values and starts tracking ownership.
              <div style={{ marginTop: 6, padding: "6px 10px", background: `${C.warn}10`, border: `1px solid ${C.warn}33`, borderRadius: 4, color: C.warn }}>
                <strong>Blast radius:</strong> the existing values for <span style={{ fontFamily: F.mono }}>models.providers.litellm</span> will be replaced. From this point ClawNex owns the slot &mdash; a future <strong>Revert ClawNex Wire</strong> will reclaim it (remove the entry) regardless of any operator edits made afterwards. <span style={{ fontFamily: F.mono }}>agents.defaults.model.primary</span> is only set if currently unset; operator edits to it after the wire are preserved on revert.
              </div>
            </div>
          )}

          {wireState === 'unwired' && (
            <div style={{ fontSize: 11, color: C.txS, lineHeight: 1.5, marginBottom: 8 }}>
              OpenClaw has no <span style={{ fontFamily: F.mono, color: C.cyan }}>litellm</span> provider entry yet, so its agent traffic
              bypasses the LiteLLM proxy and the Prompt Shield. <strong>Wire LiteLLM</strong> adds the
              entry pointing at <span style={{ fontFamily: F.mono, color: C.brand }}>{litellmUrl}</span>.
            </div>
          )}

          {lastResult && (
            <div style={{
              marginTop: 10, padding: "8px 10px", borderRadius: 4,
              background: lastResult.ok ? `${C.green}08` : `${C.danger}08`,
              border: `1px solid ${lastResult.ok ? C.green : C.danger}33`,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: lastResult.ok ? C.green : C.danger, marginBottom: 4 }}>
                {lastResult.status}
              </div>
              <div style={{ fontSize: 11, color: C.txS, lineHeight: 1.5 }}>{lastResult.detail}</div>
              {lastResult.restartRequired && (
                <div style={{ marginTop: 6, padding: "4px 8px", background: `${C.warn}10`, border: `1px solid ${C.warn}33`, borderRadius: 3, fontSize: 11, color: C.warn }}>
                  Restart required -- run <span style={{ fontFamily: F.mono }}>sudo systemctl restart openclaw-gateway</span> on the host for OpenClaw to pick up the new routing.
                </div>
              )}
              {lastResult.preservedPaths && lastResult.preservedPaths.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 11, color: C.txS }}>
                  <strong>Preserved</strong> (set-if-missing paths the operator edited after wire): <span style={{ fontFamily: F.mono }}>
                    {lastResult.preservedPaths.map(p => p.join(".")).join(", ")}
                  </span>
                </div>
              )}
              {lastResult.reclaimedDespiteEditPaths && lastResult.reclaimedDespiteEditPaths.length > 0 && (
                <div style={{ marginTop: 6, padding: "4px 8px", background: `${C.warn}10`, border: `1px solid ${C.warn}33`, borderRadius: 3, fontSize: 11, color: C.warn }}>
                  <strong>Reclaimed despite edit</strong> (ClawNex-owned <em>set</em> slots; any operator changes here were removed): <span style={{ fontFamily: F.mono }}>
                    {lastResult.reclaimedDespiteEditPaths.map(p => p.join(".")).join(", ")}
                  </span>
                </div>
              )}
              {lastResult.supervisor && lastResult.elapsedMs !== undefined && (
                <div style={{ marginTop: 6, fontSize: 10, color: C.txT, fontFamily: F.mono }}>
                  via {lastResult.supervisor} in {lastResult.elapsedMs}ms
                </div>
              )}
              {lastResult.output && (
                <details style={{ marginTop: 6 }}>
                  <summary style={{ cursor: "pointer", fontSize: 10, color: C.txT, fontFamily: F.mono, userSelect: "none" }}>
                    Supervisor output
                  </summary>
                  <pre style={{
                    marginTop: 4, padding: "4px 8px", borderRadius: 3,
                    background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`,
                    fontSize: 10, lineHeight: 1.4, color: C.txS,
                    fontFamily: F.mono, maxHeight: 160, overflow: "auto",
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>{lastResult.output}</pre>
                </details>
              )}
              {!lastResult.ok && lastResult.manualCommand && (
                <div style={{ marginTop: 6, fontSize: 11, color: C.txS }}>
                  Manual fallback: <span style={{ fontFamily: F.mono, color: C.brand }}>{lastResult.manualCommand}</span>
                </div>
              )}
            </div>
          )}

          {/* Full transparency: surface the raw sidecar JSON inline so
              the operator can audit exactly what ClawNex is tracking
              without SSH. Native <details> handles the disclosure
              with no extra React state. Only renders when a sidecar
              exists, so a fresh fleet doesn't show an empty pane. */}
          {sidecar && (
            <details style={{ marginTop: 10 }}>
              <summary style={{
                cursor: "pointer", fontSize: 11, color: C.cyan, fontWeight: 600,
                userSelect: "none", padding: "4px 0",
              }}>
                View raw sidecar (~/.clawnex-routing-managed.json)
              </summary>
              <pre style={{
                marginTop: 6, padding: "8px 10px", borderRadius: 4,
                background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`,
                fontSize: 10, lineHeight: 1.45, color: C.txS,
                fontFamily: F.mono, maxHeight: 320, overflow: "auto",
                whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>{JSON.stringify(sidecar, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </CollapsibleCard>

    {connectorRouting && (
      <CollapsibleCard title="HERMES ROUTING" accent={C.purp} defaultOpen={false} focusKey="hermesRouting" focusedCard={focusedCard}>
        <div style={{ fontSize: 12, color: C.txS, marginBottom: 10, lineHeight: 1.5 }}>
          Hermes routing is managed separately from OpenClaw. Writable Hermes custom providers can be routed through the LiteLLM proxy for real-time Prompt Shield scanning.
          OAuth/session-bound and watcher-only Hermes rows stay read-only because ClawNex cannot safely rewrite those client-owned paths.
        </div>

        <div style={{ padding: "10px 12px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Hermes Provider Routing
            </span>
            {connectorRouting.hermes.drift.total > 0 ? <Badge label={`${connectorRouting.hermes.drift.total} CHANGE${connectorRouting.hermes.drift.total === 1 ? "" : "S"}`} color={C.warn} /> : <Badge label="IN SYNC" color={C.green} />}
            <span style={{ marginLeft: "auto", fontSize: 10, color: C.txT, fontFamily: F.mono }}>
              target {connectorRouting.litellmTarget}
            </span>
          </div>

          {connectorRouting.hermes.drift.total > 0 && (
            <div style={{ marginBottom: 10, padding: "8px 10px", border: `1px solid ${C.warn}44`, borderRadius: 4, background: `${C.warn}10`, fontSize: 11, color: C.txS, lineHeight: 1.5 }}>
              Hermes inventory changed. Review new or removed custom providers/models before assuming traffic is protected.
            </div>
          )}

          <div style={connectorActionRowStyle}>
            <button
              onClick={syncConnectorInventory}
              disabled={connectorWorking !== null}
              style={{
                padding: "6px 12px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                background: connectorWorking === 'sync' ? `${C.info}33` : `${C.info}14`,
                border: `1px solid ${C.info}66`, color: C.info,
                cursor: connectorWorking ? "wait" : "pointer", fontFamily: F.sans,
              }}
            >
              {connectorWorking === 'sync' ? "Syncing..." : "Sync Inventory"}
            </button>
            <button
              onClick={applySelectedHermesRouting}
              disabled={connectorWorking !== null || connectorRouting.hermes.selected === 0}
              style={{
                padding: "6px 12px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                background: connectorWorking === 'apply-hermes' ? `${C.purp}33` : `${C.purp}18`,
                border: `1px solid ${C.purp}66`, color: C.purp,
                cursor: connectorWorking || connectorRouting.hermes.selected === 0 ? "not-allowed" : "pointer", fontFamily: F.sans,
                opacity: connectorRouting.hermes.selected === 0 ? 0.55 : 1,
              }}
            >
              {connectorWorking === 'apply-hermes' ? "Saving..." : `Save Hermes Wire (${connectorRouting.hermes.selected})`}
            </button>
            <button
              onClick={revertHermesWire}
              disabled={connectorWorking !== null}
              style={{
                padding: "6px 12px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                background: connectorWorking === 'revert-hermes' ? `${C.warn}33` : `${C.warn}14`,
                border: `1px solid ${C.warn}66`, color: C.warn,
                cursor: connectorWorking ? "wait" : "pointer", fontFamily: F.sans,
              }}
            >
              {connectorWorking === 'revert-hermes' ? "Reverting..." : "Revert Hermes Wire"}
            </button>
              {hermesSupervisor && hermesSupervisor.kind !== 'unsupported' && (
                <Tooltip placement="top" variant="detail" content={
                  <span>
                    Restarts the detected Hermes gateway supervisor so Hermes reloads provider changes from
                    <span style={{ fontFamily: F.mono, color: C.cyan }}> config.yaml</span>.
                    {hermesSupervisor.targets?.length ? <> Targets: <span style={{ fontFamily: F.mono, color: C.cyan }}>{hermesSupervisor.targets.join(", ")}</span>.</> : null}
                  </span>
                }>
                  <button
                    onClick={restartHermesGateway}
                    disabled={connectorWorking !== null}
                    style={{
                      padding: "6px 12px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                      background: connectorWorking === 'restart-hermes' ? `${C.cyan}33` : `${C.cyan}14`,
                      border: `1px solid ${C.cyan}66`, color: C.cyan,
                      cursor: connectorWorking ? "wait" : "pointer", fontFamily: F.sans,
                    }}
                  >
                    {connectorWorking === 'restart-hermes' ? "Restarting..." : "Restart Gateway"}
                  </button>
                </Tooltip>
              )}
              {hermesSupervisor && hermesSupervisor.kind === 'unsupported' && (
                <Tooltip placement="top" variant="detail" content={
                  <span>
                    ClawNex did not detect a known Hermes gateway supervisor on this host. Manual fallback:
                    <span style={{ fontFamily: F.mono, color: C.cyan }}> {hermesSupervisor.manualCommand}</span>
                  </span>
                }>
                  <button
                    disabled
                    style={{
                      padding: "6px 12px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                      background: `${C.txT}10`, border: `1px solid ${C.glassBorderSubtle}`,
                      color: C.txT, cursor: "not-allowed", fontFamily: F.sans,
                    }}
                  >
                    Restart Gateway
                  </button>
                </Tooltip>
              )}
            <button
              onClick={fetchHermesSupervisor}
              disabled={connectorWorking !== null}
              style={{
                padding: "6px 12px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                background: "transparent", border: `1px solid ${C.glassBorderSubtle}`, color: C.txS,
                cursor: connectorWorking ? "wait" : "pointer", fontFamily: F.sans,
              }}
            >
              Detect Gateway
            </button>
          </div>

          <div style={{ fontSize: 11, color: C.txS, lineHeight: 1.5, marginBottom: 10 }}>
            Hermes custom providers enforce routing by{" "}
            <Tooltip placement="top" variant="detail" content={providerLevelHelp}>
              <span style={{ color: C.warn, cursor: "help", borderBottom: `1px dotted ${C.warn}` }}>provider endpoint</span>
            </Tooltip>
            . Selecting an individual model marks it for protection and routes that model&apos;s writable custom provider through LiteLLM when applied.
          </div>

          <BadgeLegend items={connectorRoutingLegend} title="Hermes routing labels" style={{ marginBottom: 10 }} />
          {renderConnectorInventory(connectorRouting.hermes, 'hermes')}
          {renderConnectorResult('hermes')}
        </div>
      </CollapsibleCard>
    )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Proxy Settings Card (Shield Settings)
// ---------------------------------------------------------------------------

function ProxySettingsCard({ focusedCard }: { focusedCard?: string | null }) {
  const [blockMode, setBlockMode] = useState("off");
  const [providers, setProviders] = useState<Array<{ prefix: string; provider: string; url: string }>>([]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy/block-mode");
      if (res.ok) {
        const d = await res.json();
        setBlockMode(d.blockMode || "off");
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchStatus();
    const iv = setInterval(fetchStatus, 10000);
    return () => clearInterval(iv);
  }, [fetchStatus]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/config/providers");
        if (res.ok) {
          const data = await res.json();
          const routes = (data.providers || [])
            .filter((p: { type: string }) => p.type !== "openclaw")
            .map((p: { name: string; type: string; base_url: string }) => ({
              prefix: `${p.type}/*`,
              provider: p.name,
              url: p.base_url,
            }));
          setProviders(routes);
        }
      } catch { /* silent */ }
    })();
  }, []);

  const toggleBlockMode = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy/block-mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      if (res.ok) {
        const d = await res.json();
        setBlockMode(d.blockMode);
      }
    } catch { /* silent */ }
  }, []);

  return (
    <CollapsibleCard title="SHIELD SETTINGS" accent={C.cyan} defaultOpen={false} focusKey="shieldSettings" focusedCard={focusedCard}>
      <div style={{ fontSize: 13, color: C.txS, marginBottom: 12 }}>ClawNex Prompt Shield intercepts all LLM requests through 163 built-in detections (plus any custom policy rules) via LiteLLM proxy (port 4001).</div>

      {/* Block Mode Toggle */}
      <div style={{ padding: "12px 14px", marginBottom: 12, background: C.glassSurfTrans, borderRadius: 8, border: `1px solid ${C.glassBorderSubtle}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.tx }}>Shield Block Mode</div>
            <div style={{ fontSize: 11, color: C.txT, marginTop: 2 }}>
              {blockMode === "on" ? "Threats are actively blocked with 403 response" : "Threats are logged and observed, not blocked"}
            </div>
          </div>
          <Tooltip placement="left" variant="detail" content={
            <div style={{ lineHeight: 1.5 }}>
              <div style={{ marginBottom: 6 }}><strong style={{ color: C.danger }}>Critical setting.</strong></div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li style={{ marginBottom: 4 }}><strong>ON</strong> — when the Shield decides to BLOCK, the request is rejected and never reaches the model.</li>
                <li><strong>OFF</strong> (observation mode) — the Shield still scans and logs everything, but no request is actually blocked.</li>
              </ul>
              <div style={{ marginTop: 6, opacity: 0.8 }}>
                Most teams run OFF for the first week to see what would have been blocked and tune out false positives, then flip ON.
              </div>
            </div>
          }>
            <button onClick={toggleBlockMode} style={{
              padding: "8px 20px",
              borderRadius: 8,
              border: blockMode === "on" ? `2px solid ${C.danger}` : `2px solid ${C.txG}`,
              background: blockMode === "on" ? `${C.danger}22` : `${C.txG}11`,
              color: blockMode === "on" ? C.danger : C.txS,
              fontWeight: 800,
              fontSize: 13,
              fontFamily: F.mono,
              cursor: "pointer",
              letterSpacing: "0.08em",
              transition: "all 0.3s ease",
            }}>
              {blockMode === "on" ? "ON" : "OFF"}
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Routing Table */}
      <div style={{ fontSize: 12, fontWeight: 700, color: C.txT, marginBottom: 8, letterSpacing: "0.05em" }}>ROUTING TABLE</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {providers.map((r) => (
          <div key={r.prefix} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: C.glassSurfTrans, borderRadius: 6, border: `1px solid ${C.glassBorderSubtle}` }}>
            <span style={{ fontSize: 12, fontFamily: F.mono, color: C.cyan, fontWeight: 600 }}>{r.prefix}</span>
            <span style={{ fontSize: 12, color: C.txS }}>{r.provider}</span>
            <span style={{ fontSize: 11, fontFamily: F.mono, color: C.txT }}>{r.url}</span>
          </div>
        ))}
      </div>

      {/* Break-Glass */}
      <BreakGlassSection />
    </CollapsibleCard>
  );
}

// ---------------------------------------------------------------------------
// Model Pricing Row — inside the Updates card
// ---------------------------------------------------------------------------

interface PricingStatus {
  ok?: boolean;
  totalModels: number;
  bySource: { bundled: number; synced: number; manual: number };
  lastSync: string | null;
  lastSyncTag: string | null;
  lastSyncCount: number | null;
  staleDays: number;
  isStale: boolean;
  autoSyncEnabled: boolean;
  autoSyncIntervalHours: number;
  pinnedLiteLLMVersion: string;
  everSynced: boolean;
}

function ModelPricingRow() {
  const [status, setStatus] = useState<PricingStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [staleDaysDraft, setStaleDaysDraft] = useState<string>("30");
  const [intervalDraft, setIntervalDraft] = useState<string>("24");

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/config/model-pricing");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        setStaleDaysDraft(String(data.staleDays));
        setIntervalDraft(String(data.autoSyncIntervalHours));
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const triggerSync = useCallback(async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/config/model-pricing/sync", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMessage({ text: `Synced ${data.result.totalModels} models from ${data.result.tag}`, tone: 'ok' });
        if (data.status) setStatus(data.status);
      } else {
        setMessage({ text: data.error || "Sync failed", tone: 'err' });
      }
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Sync failed", tone: 'err' });
    } finally {
      setSyncing(false);
      setTimeout(() => setMessage(null), 6000);
    }
  }, []);

  const saveSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/config/model-pricing/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staleDays: parseInt(staleDaysDraft, 10) || 30,
          autoSyncIntervalHours: parseInt(intervalDraft, 10) || 24,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status) setStatus(data.status);
        setMessage({ text: "Settings saved", tone: 'ok' });
      } else {
        setMessage({ text: "Save failed", tone: 'err' });
      }
    } catch {
      setMessage({ text: "Save failed", tone: 'err' });
    }
    setTimeout(() => setMessage(null), 4000);
  }, [staleDaysDraft, intervalDraft]);

  const toggleAutoSync = useCallback(async () => {
    if (!status) return;
    try {
      const res = await fetch("/api/config/model-pricing/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoSyncEnabled: !status.autoSyncEnabled }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status) setStatus(data.status);
      }
    } catch { /* silent */ }
  }, [status]);

  const lastSyncLabel = status?.lastSync
    ? `${timeAgo(status.lastSync)} (${status.lastSyncTag || "unknown tag"})`
    : "never";

  return (
    <div style={{
      padding: "12px 14px", marginBottom: 8, background: C.bg, borderRadius: 8,
      border: `1px solid ${C.glassBorderSubtle}`, borderLeft: `3px solid ${C.warn}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Tooltip placement="top" variant="detail" content={
            <span>
              Pricing is a <strong style={{ color: C.tx }}>version-locked snapshot</strong> of LiteLLM&apos;s public model database, pulled at the tag matching your pinned LiteLLM version (currently <strong>v{status?.pinnedLiteLLMVersion || "1.84.10"}</strong>) — never the unverified upstream tip. Model names use <strong>fuzzy family matching</strong>: an exact name is preferred, but if a model isn&apos;t listed yet, the closest version in the same family is used (e.g. a brand-new <strong>claude-sonnet-4-6</strong> falls back to <strong>claude-sonnet-4-5</strong>, then to the family anchor <strong>claude-sonnet-4</strong>) so cost numbers stay reasonable until the snapshot catches up.
            </span>
          }>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.tx, borderBottom: `1px dotted ${C.txT}`, cursor: "help" }}>Model Pricing</span>
          </Tooltip>
          {status && (
            <span style={{ fontSize: 12, color: C.txT, fontFamily: F.mono }}>
              {status.totalModels.toLocaleString()} models
              {status.bySource.synced > 0 && status.bySource.bundled > 0 && (
                <span style={{ color: C.txT }}> ({status.bySource.synced} synced / {status.bySource.bundled} bundled)</span>
              )}
              {" · "}Last sync: {lastSyncLabel}
            </span>
          )}
          {status?.isStale && (
            <Tooltip placement="top" variant="detail" content={
              <span>
                Pricing hasn&apos;t been refreshed in more than <strong>{status.staleDays} days</strong>. New models released since then fall back to fuzzy family matching instead of exact rates. Click <strong>Update Now</strong> to refresh.
              </span>
            }>
              <span><Badge label={`STALE (> ${status.staleDays}d)`} color={C.warn} /></span>
            </Tooltip>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button onClick={() => setShowSettings(s => !s)} style={{
            padding: "4px 10px", background: "transparent", border: `1px solid ${C.glassBorderSubtle}`,
            borderRadius: 4, color: C.txS, fontSize: 11, fontWeight: 600, cursor: "pointer",
          }}>{showSettings ? "Hide settings" : "Settings"}</button>
          <Tooltip placement="top" variant="detail" content={<span>Pull the freshest model pricing from the pinned LiteLLM GitHub tag right now. Cost calculations across the dashboard will pick up the new rates immediately. No restart needed.</span>}>
            <button onClick={triggerSync} disabled={syncing} style={{
              padding: "4px 12px", background: C.brand, color: C.bg, border: "none", borderRadius: 4,
              fontSize: 11, fontWeight: 700, cursor: syncing ? "wait" : "pointer",
            }}>{syncing ? "Syncing..." : "Update Now"}</button>
          </Tooltip>
        </div>
      </div>

      <div style={{ marginTop: 6, fontSize: 11, color: C.txT, lineHeight: 1.5 }}>
        Pricing data powers the Token &amp; Cost Intel panel. Bundled snapshot seeds the DB on first boot; updates pull from LiteLLM&apos;s GitHub at the pinned tag{" "}
        <span style={{ fontFamily: F.mono, color: C.cyan }}>v{status?.pinnedLiteLLMVersion || "1.84.10"}</span>.
      </div>

      {message && (
        <div style={{
          marginTop: 8, padding: "6px 10px", borderRadius: 4, fontSize: 11, fontFamily: F.mono,
          background: message.tone === 'ok' ? `${C.green}10` : `${C.danger}10`,
          border: `1px solid ${message.tone === 'ok' ? C.green : C.danger}44`,
          color: message.tone === 'ok' ? C.green : C.danger,
        }}>{message.text}</div>
      )}

      {showSettings && status && (
        <div style={{
          marginTop: 10, padding: "10px 12px", background: "rgba(16,29,52,0.3)",
          borderRadius: 6, border: `1px solid ${C.glassBorderSubtle}`,
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: C.txT, display: "block", marginBottom: 4 }}>
                Stale threshold (days)
              </label>
              <input
                type="number"
                min={1}
                max={365}
                value={staleDaysDraft}
                onChange={e => setStaleDaysDraft(e.target.value)}
                style={{
                  width: "100%", padding: "6px 10px", background: "rgba(0,0,0,0.3)",
                  border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, color: C.tx,
                  fontSize: 12, fontFamily: F.mono,
                }}
              />
              <div style={{ fontSize: 10, color: C.txT, marginTop: 3 }}>
                Data older than this shows a STALE badge. Default 30.
              </div>
            </div>
            <div>
              <label style={{ fontSize: 11, color: C.txT, display: "block", marginBottom: 4 }}>
                Auto-sync interval (hours)
              </label>
              <input
                type="number"
                min={1}
                max={720}
                value={intervalDraft}
                onChange={e => setIntervalDraft(e.target.value)}
                style={{
                  width: "100%", padding: "6px 10px", background: "rgba(0,0,0,0.3)",
                  border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, color: C.tx,
                  fontSize: 12, fontFamily: F.mono,
                }}
              />
              <div style={{ fontSize: 10, color: C.txT, marginTop: 3 }}>
                When auto-sync is on, runs at most every N hours via the daily cron.
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={toggleAutoSync} style={{
              padding: "5px 12px", borderRadius: 6,
              border: `1px solid ${status.autoSyncEnabled ? C.green : C.txG}`,
              background: status.autoSyncEnabled ? `${C.green}22` : "transparent",
              color: status.autoSyncEnabled ? C.green : C.txS,
              fontWeight: 700, fontSize: 11, fontFamily: F.mono, cursor: "pointer",
            }}>
              Auto-sync: {status.autoSyncEnabled ? "ON" : "OFF"}
            </button>
            <button onClick={saveSettings} style={{
              padding: "5px 12px", background: `${C.brand}18`, border: `1px solid ${C.brand}44`,
              borderRadius: 6, color: C.brand, fontSize: 11, fontWeight: 700, cursor: "pointer",
            }}>Save</button>
            <span style={{ fontSize: 10, color: C.txT, flex: 1 }}>
              Auto-sync also fetches from the pinned LiteLLM tag — never upstream{" "}
              <span style={{ fontFamily: F.mono }}>main</span>.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scheduled Reports Card
// ---------------------------------------------------------------------------

function ScheduledReportsCard() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [newJob, setNewJob] = useState({ report_type: 'executive_summary', schedule: 'daily', format: 'markdown', email_to: '' });
  const [showAdd, setShowAdd] = useState(false);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/reports/schedule');
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const addJob = async () => {
    await fetch('/api/reports/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newJob) });
    setShowAdd(false);
    fetchJobs();
  };

  const toggleJob = async (id: string, enabled: boolean) => {
    await fetch('/api/reports/schedule', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, enabled }) });
    fetchJobs();
  };

  const deleteJob = async (id: string) => {
    await fetch(`/api/reports/schedule?id=${id}`, { method: 'DELETE' });
    fetchJobs();
  };

  const inputStyle: React.CSSProperties = { padding: '6px 10px', background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, color: C.tx, fontSize: 12, fontFamily: F.mono, outline: 'none', width: '100%' };
  const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'none' as any };

  return (
    <CollapsibleCard title="SCHEDULED REPORTS" accent={C.purp} defaultOpen={false}>
      {loading && <div style={{ textAlign: 'center', padding: 12, color: C.txT, fontSize: 12 }}>Loading...</div>}

      {jobs.length === 0 && !loading && (
        <div style={{ fontSize: 12, color: C.txT, padding: '8px 0' }}>No scheduled reports configured.</div>
      )}

      {jobs.map((job: any) => (
        <div key={job.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.glassBorderSubtle}` }}>
          <button onClick={() => toggleJob(job.id, !job.enabled)} style={{
            width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
            background: job.enabled ? C.brand : C.glassSurfTrans, position: 'relative', transition: 'background 0.2s',
          }}>
            <div style={{
              width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2,
              left: job.enabled ? 18 : 2, transition: 'left 0.2s',
            }} />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: job.enabled ? C.tx : C.txT }}>{job.report_type.replace(/_/g, ' ')}</div>
            <div style={{ fontSize: 10, color: C.txG }}>{job.schedule} &middot; {job.format}{job.email_to ? ` → ${job.email_to}` : ''}</div>
          </div>
          {job.last_run && <div style={{ fontSize: 10, color: C.txG }}>Last: {timeAgo(job.last_run)}</div>}
          <button onClick={() => deleteJob(job.id)} style={{ background: 'none', border: 'none', color: C.danger, cursor: 'pointer', fontSize: 14 }}>×</button>
        </div>
      ))}

      {showAdd ? (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Tooltip placement="top" variant="detail" content={<span>Which canned report to generate. <strong>Executive summary</strong> = high-level KPIs, <strong>Security posture</strong> = Host Security grade, <strong>Cost analysis</strong> = spend by agent, <strong>Compliance evidence</strong> = audit log bundle, <strong>Incident report</strong> = open alerts + correlations.</span>}>
            <select value={newJob.report_type} onChange={e => setNewJob({ ...newJob, report_type: e.target.value })} style={selectStyle}>
              <option value="executive_summary">Executive Summary</option>
              <option value="security_posture">Security Posture</option>
              <option value="cost_analysis">Cost Analysis</option>
              <option value="compliance_evidence">Compliance Evidence</option>
              <option value="incident_report">Incident Report</option>
            </select>
          </Tooltip>
          <select value={newJob.schedule} onChange={e => setNewJob({ ...newJob, schedule: e.target.value })} style={selectStyle}>
            <option value="daily">Daily (6am)</option>
            <option value="weekly">Weekly (Sunday 6am)</option>
            <option value="monthly">Monthly (1st 6am)</option>
          </select>
          <Tooltip placement="top" variant="detail" content={<span><strong>Markdown</strong> renders nicely in email clients and GitHub. <strong>JSON</strong> is for downstream tools (Splunk, custom dashboards, etc.) — same data, machine-readable.</span>}>
            <select value={newJob.format} onChange={e => setNewJob({ ...newJob, format: e.target.value })} style={selectStyle}>
              <option value="markdown">Markdown</option>
              <option value="json">JSON</option>
            </select>
          </Tooltip>
          <Tooltip placement="top" variant="detail" content={<span>Where to email the report. Comma-separated for multiple recipients. <strong>Leave blank</strong> to just write the file to disk under <strong>reports/</strong> without emailing — useful for CI pickup or local archival.</span>}>
            <input placeholder="Email to (optional)" value={newJob.email_to} onChange={e => setNewJob({ ...newJob, email_to: e.target.value })} style={inputStyle} />
          </Tooltip>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={addJob} style={{ flex: 1, padding: '6px 12px', background: C.brand, color: C.bg, border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Create</button>
            <button onClick={() => setShowAdd(false)} style={{ padding: '6px 12px', background: 'none', color: C.txT, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)} style={{ marginTop: 8, padding: '6px 12px', background: 'none', color: C.brand, border: `1px solid ${C.brand}40`, borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: 'pointer', width: '100%' }}>+ Add Scheduled Report</button>
      )}
    </CollapsibleCard>
  );
}

// ---------------------------------------------------------------------------
// Correlation Rules Card
// ---------------------------------------------------------------------------

// Starter templates are defined in src/lib/correlation-templates.ts so the
// Correlations panel can also offer them as a one-click empty-state fix.

function CorrelationRulesCard() {
  const [rules, setRules] = useState<any[]>([]);
  const [fields, setFields] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const emptyRule = () => ({
    name: '', description: '', severity: 'medium', threshold: 5, time_window_minutes: 15, min_event_count: 3,
    conditions: [{ field: 'shield_verdict', operator: 'eq', value: 'BLOCK', weight: 5 }],
  });
  const [newRule, setNewRule] = useState<any>(emptyRule());
  const [evalResults, setEvalResults] = useState<any>(null);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/correlations/rules');
      const data = await res.json();
      setRules(data.rules || []);
      setFields(data.fields || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const addCondition = () => {
    setNewRule({ ...newRule, conditions: [...newRule.conditions, { field: 'shield_score', operator: 'gte', value: '60', weight: 3 }] });
  };

  const updateCondition = (idx: number, key: string, val: any) => {
    const conds = [...newRule.conditions];
    (conds[idx] as any)[key] = val;
    setNewRule({ ...newRule, conditions: conds });
  };

  const removeCondition = (idx: number) => {
    setNewRule({ ...newRule, conditions: newRule.conditions.filter((_: any, i: number) => i !== idx) });
  };

  const createRule = async () => {
    if (!newRule.name) return;
    await fetch('/api/correlations/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newRule) });
    setShowAdd(false);
    setNewRule(emptyRule());
    fetchRules();
  };

  const cloneTemplate = (tpl: typeof CORRELATION_STARTER_TEMPLATES[number]) => {
    setNewRule({
      name: tpl.name,
      description: tpl.description,
      severity: tpl.severity,
      threshold: tpl.threshold,
      time_window_minutes: tpl.time_window_minutes,
      min_event_count: tpl.min_event_count,
      conditions: tpl.conditions.map(c => ({ ...c })),
    });
    setShowAdd(true);
  };

  const toggleRule = async (id: string, enabled: boolean) => {
    await fetch('/api/correlations/rules', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, enabled }) });
    fetchRules();
  };

  const deleteRuleById = async (id: string) => {
    await fetch(`/api/correlations/rules?id=${id}`, { method: 'DELETE' });
    fetchRules();
  };

  const evaluateAll = async () => {
    const res = await fetch('/api/correlations/rules?evaluate=true', { method: 'POST' });
    const data = await res.json();
    setEvalResults(data);
    // Re-fetch so updated trigger_count / last_triggered show in the list.
    fetchRules();
  };

  const sevColors: Record<string, string> = { critical: '#f43f5e', high: '#fb923c', medium: '#fbbf24', low: '#38bdf8', info: '#556a90' };
  const inputStyle: React.CSSProperties = { padding: '6px 10px', background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, color: C.tx, fontSize: 12, fontFamily: F.mono, outline: 'none', width: '100%' };
  const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'none' as any };

  const enabledCount = rules.filter((r: any) => r.enabled).length;
  const isEmpty = !loading && rules.length === 0;

  return (
    <CollapsibleCard title="CUSTOM CORRELATION RULES" accent="#fbbf24" defaultOpen={false}>
      {/* Intro / framing */}
      <div style={{ marginBottom: 10, padding: 10, background: `${C.srf}`, borderRadius: 6, border: `1px solid ${C.glassBorderSubtle}` }}>
        <div style={{ fontSize: 12, color: C.txS, lineHeight: 1.55 }}>
          Define weighted detection patterns that fire when enough conditions co-occur within a time window.
        </div>
        <ul style={{ margin: '6px 0 0 0', paddingLeft: 16, fontSize: 11, color: C.txG, lineHeight: 1.5 }}>
          <li><strong style={{ color: C.txS }}>Weighted conditions</strong> — each condition adds its <code style={{ fontFamily: F.mono }}>weight</code> to the event&apos;s score when matched.</li>
          <li><strong style={{ color: C.txS }}>Threshold</strong> — minimum weighted score an event must reach to count as a match.</li>
          <li><strong style={{ color: C.txS }}>Min event count</strong> — minimum number of matching events inside the window for the rule to trigger.</li>
        </ul>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: C.txT }}>
          {rules.length} rule{rules.length === 1 ? '' : 's'} &middot; {enabledCount} enabled
        </div>
        <Tooltip placement="left" variant="detail" content={<span>Run every enabled rule against the recent event window right now, instead of waiting for the next scheduled evaluation. Updates the trigger count + last-triggered timestamp on each rule and shows a quick result summary.</span>}>
          <button onClick={evaluateAll} style={{ padding: '4px 10px', background: `${C.brand}18`, color: C.brand, border: `1px solid ${C.brand}40`, borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>Evaluate Now</button>
        </Tooltip>
      </div>

      {evalResults && (
        <div style={{ padding: 8, background: evalResults.triggered > 0 ? `${sevColors.high}10` : `${C.brand}10`, borderRadius: 6, marginBottom: 8, fontSize: 11 }}>
          <span style={{ fontWeight: 700, color: evalResults.triggered > 0 ? sevColors.high : C.brand }}>{evalResults.triggered} rule(s) triggered</span>
          {evalResults.results?.map((r: any, i: number) => (
            <div key={i} style={{ color: C.txS, marginTop: 4 }}>{r.rule.name}: {r.matchCount} events matched (score: {r.weightedScore})</div>
          ))}
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: 12, color: C.txT, fontSize: 12 }}>Loading...</div>}

      {/* Starter templates — shown only when the rule list is empty */}
      {isEmpty && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.txS, marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Starter templates</div>
          <div style={{ fontSize: 11, color: C.txG, marginBottom: 8 }}>Clone a template to pre-fill the create form. Review and save to persist — nothing is written until you click Create Rule.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {CORRELATION_STARTER_TEMPLATES.map(tpl => (
              <div key={tpl.key} style={{ padding: 10, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6, background: C.srf }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, fontWeight: 700, fontFamily: F.mono, color: sevColors[tpl.severity], background: `${sevColors[tpl.severity]}18`, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{tpl.severity}</span>
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: C.tx }}>{tpl.name}</span>
                  <button onClick={() => cloneTemplate(tpl)} style={{ padding: '4px 10px', background: `${C.brand}18`, color: C.brand, border: `1px solid ${C.brand}40`, borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>Clone</button>
                </div>
                <div style={{ fontSize: 11, color: C.txG, lineHeight: 1.45 }}>{tpl.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {rules.map((rule: any) => (
        <div key={rule.id} style={{ padding: '8px 0', borderBottom: `1px solid ${C.glassBorderSubtle}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => toggleRule(rule.id, !rule.enabled)} aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'} title={rule.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'} style={{
              width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
              background: rule.enabled ? C.brand : C.glassSurfTrans, position: 'relative', transition: 'background 0.2s', flexShrink: 0,
            }}>
              <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: rule.enabled ? 18 : 2, transition: 'left 0.2s' }} />
            </button>
            <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 3, fontWeight: 700, fontFamily: F.mono, color: sevColors[rule.severity] || C.txS, background: `${sevColors[rule.severity] || C.txS}18`, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{rule.severity}</span>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: rule.enabled ? C.tx : C.txT }}>{rule.name}</span>
            <span style={{ fontSize: 10, color: rule.enabled ? C.brand : C.txG, fontFamily: F.mono, fontWeight: 600 }}>{rule.enabled ? 'ENABLED' : 'DISABLED'}</span>
            <button onClick={() => deleteRuleById(rule.id)} aria-label="Delete rule" style={{ background: 'none', border: 'none', color: C.danger, cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>×</button>
          </div>
          {rule.description && <div style={{ fontSize: 10, color: C.txG, marginTop: 2, marginLeft: 46 }}>{rule.description}</div>}
          <div style={{ marginTop: 4, marginLeft: 46, display: 'flex', gap: 14, fontSize: 10, color: C.txG, flexWrap: 'wrap' }}>
            <span>{rule.conditions?.length || 0} condition{(rule.conditions?.length || 0) === 1 ? '' : 's'}</span>
            <span>Triggered: <span style={{ color: (rule.trigger_count || 0) > 0 ? C.txS : C.txG, fontWeight: 600 }}>{rule.trigger_count || 0}</span></span>
            <span>
              Last triggered: <span style={{ color: rule.last_triggered ? C.txS : C.txG, fontWeight: 600 }}>
                {rule.last_triggered ? formatTimeAgo(rule.last_triggered) : 'never triggered'}
              </span>
            </span>
          </div>
        </div>
      ))}

      {showAdd ? (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, padding: 12, background: `${C.srf}`, borderRadius: 8, border: `1px solid ${C.glassBorderSubtle}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.tx }}>New Correlation Rule</div>
          <input placeholder="Rule name" value={newRule.name} onChange={e => setNewRule({ ...newRule, name: e.target.value })} style={inputStyle} />
          <input placeholder="Description (optional)" value={newRule.description} onChange={e => setNewRule({ ...newRule, description: e.target.value })} style={inputStyle} />
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={newRule.severity} onChange={e => setNewRule({ ...newRule, severity: e.target.value })} style={{ ...selectStyle, flex: 1 }}>
              <option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="info">Info</option>
            </select>
            <input type="number" placeholder="Threshold" value={newRule.threshold} onChange={e => setNewRule({ ...newRule, threshold: parseInt(e.target.value) || 5 })} style={{ ...inputStyle, width: 80 }} />
            <input type="number" placeholder="Window (min)" value={newRule.time_window_minutes} onChange={e => setNewRule({ ...newRule, time_window_minutes: parseInt(e.target.value) || 15 })} style={{ ...inputStyle, width: 80 }} />
            <input type="number" placeholder="Min events" value={newRule.min_event_count} onChange={e => setNewRule({ ...newRule, min_event_count: parseInt(e.target.value) || 3 })} style={{ ...inputStyle, width: 80 }} />
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.txS, marginTop: 4 }}>Conditions</div>
          {newRule.conditions.map((cond: any, idx: number) => (
            <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select value={cond.field} onChange={e => updateCondition(idx, 'field', e.target.value)} style={{ ...selectStyle, flex: 2 }}>
                {fields.map((f: any) => <option key={f.field} value={f.field}>{f.label}</option>)}
              </select>
              <select value={cond.operator} onChange={e => updateCondition(idx, 'operator', e.target.value)} style={{ ...selectStyle, flex: 1 }}>
                <option value="eq">=</option><option value="neq">≠</option><option value="gt">&gt;</option><option value="lt">&lt;</option><option value="gte">≥</option><option value="lte">≤</option><option value="contains">contains</option><option value="not_contains">!contains</option>
              </select>
              <input value={cond.value} onChange={e => updateCondition(idx, 'value', e.target.value)} placeholder="Value" style={{ ...inputStyle, flex: 2 }} />
              <input type="number" value={cond.weight} onChange={e => updateCondition(idx, 'weight', parseInt(e.target.value) || 1)} style={{ ...inputStyle, width: 50 }} title="Weight (1-10)" />
              <button onClick={() => removeCondition(idx)} style={{ background: 'none', border: 'none', color: C.danger, cursor: 'pointer', fontSize: 14 }}>×</button>
            </div>
          ))}
          <button onClick={addCondition} style={{ padding: '4px 10px', background: 'none', color: C.brand, border: `1px solid ${C.brand}40`, borderRadius: 4, fontSize: 10, cursor: 'pointer' }}>+ Add Condition</button>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={createRule} style={{ flex: 1, padding: '6px 12px', background: C.brand, color: C.bg, border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Create Rule</button>
            <button onClick={() => { setShowAdd(false); setNewRule(emptyRule()); }} style={{ padding: '6px 12px', background: 'none', color: C.txT, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)} style={{ marginTop: 8, padding: '6px 12px', background: 'none', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: 'pointer', width: '100%' }}>+ Create Correlation Rule</button>
      )}
    </CollapsibleCard>
  );
}

// ---------------------------------------------------------------------------
// Threat Score Weights Card
// ---------------------------------------------------------------------------
// Surfaces `risk_weight_*` keys that feed `calculateThreatScore()` and the
// `/api/correlations/evaluate` scoring pipeline. Keys MUST match the backend
// constants in `src/lib/services/threat-score.ts` and
// `src/app/api/correlations/evaluate/route.ts`.

const RISK_WEIGHT_FIELDS: Array<{ key: string; label: string; help: string; default: number }> = [
  { key: 'risk_weight_shield',     label: 'Shield blocks & detections',    help: 'Inbound prompt injection, PII, credential, and malicious-intent detections from the Shield.', default: 1.0 },
  { key: 'risk_weight_infra',      label: 'Infrastructure health signals', help: 'CPU, memory, and service-down snapshots from the metrics collector.',                  default: 1.0 },
  { key: 'risk_weight_token',      label: 'Token & cost anomalies',        help: 'Traffic volume spikes, cost-per-request outliers, token burn anomalies.',              default: 0.8 },
  { key: 'risk_weight_access',     label: 'Access list & RBAC violations', help: 'Deny-list hits, RBAC-forbidden requests, unauthorized route attempts.',               default: 1.0 },
  { key: 'risk_weight_breakglass', label: 'Break-glass activations',       help: 'Emergency override sessions are high-risk by definition.',                            default: 1.5 },
  { key: 'risk_weight_audit',      label: 'Audit-log volume anomalies',    help: 'Sudden bursts of audit events relative to baseline.',                                 default: 1.2 },
  { key: 'risk_weight_alerts',     label: 'Open alert volume',             help: 'Unresolved alerts in the last 24 hours — especially CRITICAL.',                       default: 1.0 },
];

function ThreatScoreWeightsCard() {
  const defaultsMap: Record<string, number> = Object.fromEntries(RISK_WEIGHT_FIELDS.map(f => [f.key, f.default]));
  const [values, setValues] = useState<Record<string, number>>(defaultsMap);
  const [initial, setInitial] = useState<Record<string, number>>(defaultsMap);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/config/defaults');
      if (res.ok) {
        const data = await res.json();
        const settings: Record<string, string> = data.settings || {};
        const next: Record<string, number> = { ...defaultsMap };
        for (const f of RISK_WEIGHT_FIELDS) {
          const raw = settings[f.key];
          if (raw !== undefined && raw !== null && raw !== '') {
            const parsed = parseFloat(raw);
            if (!Number.isNaN(parsed)) next[f.key] = parsed;
          }
        }
        setValues(next);
        setInitial(next);
      }
    } catch {} finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const dirty = RISK_WEIGHT_FIELDS.some(f => values[f.key] !== initial[f.key]);

  const clamp = (n: number) => Math.max(0, Math.min(5, Math.round(n * 10) / 10));

  const setVal = (key: string, v: number) => {
    if (Number.isNaN(v)) return;
    setValues({ ...values, [key]: clamp(v) });
    setSavedMsg(null);
    setErrorMsg(null);
  };

  const save = async () => {
    setSaving(true);
    setSavedMsg(null);
    setErrorMsg(null);
    try {
      // No batch PATCH endpoint exists; existing PUT takes one key/value
      // per request. Issue them in parallel.
      const puts = RISK_WEIGHT_FIELDS.map(f =>
        fetch('/api/config/defaults', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: f.key, value: String(values[f.key]) }),
        }).then(r => ({ key: f.key, ok: r.ok }))
      );
      const outcomes = await Promise.all(puts);
      const failed = outcomes.filter(o => !o.ok);
      if (failed.length > 0) {
        setErrorMsg(`Failed to save ${failed.length} weight${failed.length === 1 ? '' : 's'}. Check permissions.`);
      } else {
        setInitial({ ...values });
        setSavedMsg('Saved. Next evaluation will use updated weights.');
        // Fire a recompute so the user can see the breakdown shift. Ignore the body.
        try { fetch('/api/correlations/evaluate', { method: 'POST' }); } catch {}
      }
    } catch {
      setErrorMsg('Unexpected error while saving.');
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = async () => {
    setSaving(true);
    setSavedMsg(null);
    setErrorMsg(null);
    try {
      // Clear persisted overrides by writing an empty string — getSetting()
      // returns falsy and the engine falls back to code defaults.
      const puts = RISK_WEIGHT_FIELDS.map(f =>
        fetch('/api/config/defaults', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: f.key, value: '' }),
        })
      );
      await Promise.all(puts);
      setValues({ ...defaultsMap });
      setInitial({ ...defaultsMap });
      setSavedMsg('Reset to defaults. Next evaluation will use built-in weights.');
    } catch {
      setErrorMsg('Unexpected error while resetting.');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = { padding: '6px 10px', background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, color: C.tx, fontSize: 12, fontFamily: F.mono, outline: 'none', width: 80, textAlign: 'right' as const };

  return (
    <CollapsibleCard title="THREAT SCORE WEIGHTS" accent="#fb923c" defaultOpen={false}>
      <div style={{ marginBottom: 10, padding: 10, background: `${C.srf}`, borderRadius: 6, border: `1px solid ${C.glassBorderSubtle}` }}>
        <div style={{ fontSize: 12, color: C.txS, lineHeight: 1.55 }}>
          Adjust how much each security source contributes to the overall threat score. Higher weight = more influence on the score.
        </div>
        <div style={{ fontSize: 11, color: C.txG, marginTop: 6 }}>
          Range: 0.0 – 5.0, in 0.1 steps. Changes take effect on the next threat score evaluation.
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 12, color: C.txT, fontSize: 12 }}>Loading...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {RISK_WEIGHT_FIELDS.map(f => {
            const v = values[f.key] ?? f.default;
            const modified = v !== f.default;
            return (
              <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.tx, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {f.label}
                    {modified && (
                      <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: `${C.brand}22`, color: C.brand, fontFamily: F.mono, fontWeight: 700, letterSpacing: '0.05em' }}>CUSTOM</span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: C.txG, marginTop: 2 }}>{f.help}</div>
                  <div style={{ fontSize: 10, color: C.txT, marginTop: 2, fontFamily: F.mono }}>
                    <code>{f.key}</code> &middot; default {f.default.toFixed(1)}
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={0.1}
                  value={v}
                  onChange={e => setVal(f.key, parseFloat(e.target.value))}
                  style={{ width: 120, accentColor: '#fb923c' }}
                  aria-label={`${f.label} weight slider`}
                />
                <input
                  type="number"
                  min={0}
                  max={5}
                  step={0.1}
                  value={v}
                  onChange={e => setVal(f.key, parseFloat(e.target.value))}
                  style={inputStyle}
                  aria-label={`${f.label} weight value`}
                />
              </div>
            );
          })}
        </div>
      )}

      {savedMsg && (
        <div style={{ marginTop: 10, padding: 8, background: `${C.brand}18`, border: `1px solid ${C.brand}40`, borderRadius: 4, color: C.brand, fontSize: 11, fontWeight: 600 }}>
          {savedMsg}
        </div>
      )}
      {errorMsg && (
        <div style={{ marginTop: 10, padding: 8, background: `${C.danger}18`, border: `1px solid ${C.danger}40`, borderRadius: 4, color: C.danger, fontSize: 11, fontWeight: 600 }}>
          {errorMsg}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Tooltip placement="top" variant="detail" content={<span>Persist all weight changes and trigger an immediate threat-score recompute so the new contribution mix is visible right away in the Correlations panel.</span>}>
          <button
            onClick={save}
            disabled={saving || loading || !dirty}
            style={{
              flex: 1, padding: '8px 14px',
              background: dirty && !saving ? '#fb923c' : C.glassSurfTrans,
              color: dirty && !saving ? C.bg : C.txT,
              border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 700,
              cursor: dirty && !saving ? 'pointer' : 'not-allowed',
            }}
          >
            {saving ? 'Saving...' : dirty ? 'Save Weights' : 'No changes'}
          </button>
        </Tooltip>
        <Tooltip placement="top" variant="detail" content={<span>Clear every stored override so the engine falls back to built-in defaults (the values shown in grey under each row). Affects the next evaluation cycle.</span>}>
          <button
            onClick={resetDefaults}
            disabled={saving || loading}
            style={{
              padding: '8px 14px', background: 'none', color: C.txS,
              border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, fontSize: 12, fontWeight: 600,
              cursor: saving || loading ? 'not-allowed' : 'pointer',
            }}
          >
            Reset to defaults
          </button>
        </Tooltip>
      </div>
    </CollapsibleCard>
  );
}

// ---------------------------------------------------------------------------
// HTTPS / Caddy Card
// ---------------------------------------------------------------------------

function HttpsCard({ focusedCard }: { focusedCard?: string | null }) {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [domain, setDomain] = useState('');
  const [configResult, setConfigResult] = useState<any>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/system/https');
      const data = await res.json();
      setStatus(data);
      if (data.domain) setDomain(data.domain);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const configureDomain = async () => {
    if (!domain) return;
    const res = await fetch('/api/system/https', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain }) });
    const data = await res.json();
    setConfigResult(data);
    fetchStatus();
  };

  const inputStyle: React.CSSProperties = { padding: '6px 10px', background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, color: C.tx, fontSize: 12, fontFamily: F.mono, outline: 'none', flex: 1 };

  return (
    <CollapsibleCard title="HTTPS / TLS" accent="#38bdf8" defaultOpen={false} focusKey="https" focusedCard={focusedCard}>
      {loading && <div style={{ textAlign: 'center', padding: 12, color: C.txT, fontSize: 12 }}>Checking...</div>}

      {status && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
            <span><Dot color={status.installed ? C.brand : C.danger} size={6} /> Caddy: {status.installed ? `Installed (${status.version})` : 'Not installed'}</span>
            <span><Dot color={status.running ? C.brand : C.txG} size={6} /> {status.running ? 'Running' : 'Stopped'}</span>
            <span><Dot color={status.httpsEnabled ? C.brand : C.txG} size={6} /> HTTPS: {status.httpsEnabled ? 'Active' : 'Inactive'}</span>
          </div>

          {status.certExpiry && (
            <div style={{ fontSize: 11, color: C.txS }}>Certificate expires: {status.certExpiry}</div>
          )}

          {!status.installed && (
            <div style={{ padding: 10, background: `${C.warn}10`, borderRadius: 6, fontSize: 11, color: C.txS }}>
              <div style={{ fontWeight: 700, color: C.warn, marginBottom: 4 }}>Caddy not installed</div>
              <code style={{ fontSize: 10, fontFamily: F.mono, color: C.brand, display: 'block', padding: '4px 8px', background: C.srf, borderRadius: 4 }}>
                {status.installInstructions}
              </code>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
            <Tooltip placement="top" variant="detail" content={<span>Public hostname pointed at this server&apos;s IP. <strong>DNS has to resolve before this works</strong> — the cert handshake fails otherwise. Use a subdomain you control (e.g. <strong>clawnex.example.com</strong>).</span>}>
              <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="Domain (e.g. clawnexai.com)" style={inputStyle} />
            </Tooltip>
            <Tooltip placement="left" variant="detail" content={<span>Set up the public HTTPS endpoint on this server. Writes the web-server config and reloads it. The first request to <strong>https://&lt;your domain&gt;</strong> after this triggers the cert handshake — takes about 5–15 seconds the first time, then it&apos;s cached.</span>}>
              <button onClick={configureDomain} style={{ padding: '6px 14px', background: '#38bdf8', color: C.bg, border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {status.caddyfilePath ? 'Update' : 'Configure'}
              </button>
            </Tooltip>
          </div>

          {configResult && (
            <div style={{ padding: 8, background: `${C.brand}10`, borderRadius: 6, fontSize: 11, color: C.txS }}>
              <div style={{ fontWeight: 700, color: C.brand, marginBottom: 4 }}>{configResult.message}</div>
              {configResult.nextSteps && <div>{configResult.nextSteps}</div>}
            </div>
          )}
        </div>
      )}
    </CollapsibleCard>
  );
}

// ---------------------------------------------------------------------------
// Configuration Panel (main export)
// ---------------------------------------------------------------------------

export function ConfigurationPanel({ focusCard, onNavigate, incomingFromMissionControl, onMissionControlBackConsumed }: { focusCard?: string | null; onNavigate?: (tab: TabId, focus?: string) => void; incomingFromMissionControl?: boolean; onMissionControlBackConsumed?: () => void } = {}) {
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [gateways, setGateways] = useState<GatewayInstance[]>([]);
  const [defaultModel, setDefaultModel] = useState("qwen/qwen3.5-35b-a3b");
  const [defaultProvider, setDefaultProvider] = useState("lmstudio-fleet");
  const [loading, setLoading] = useState(true);
  // 2026-05-09 (internal reviewer conditional sign-off): provider save / delete now syncs
  // litellm/config.yaml but does NOT auto-restart LiteLLM (rapid sequential
  // saves were producing per-save restart cycles). The trade-off is a UX
  // window where providers appear in the list but LiteLLM still routes via
  // the old config until manual Restart. Surface that contract explicitly
  // via this banner — the reviewer's required pre-Docker condition.
  const [restartHintVisible, setRestartHintVisible] = useState(false);
  const [newProviderName, setNewProviderName] = useState("");
  const [newProviderUrl, setNewProviderUrl] = useState("");
  const [newProviderType, setNewProviderType] = useState<string>("lmstudio");
  // 2026-05-09: search-as-filter for the model discovery list. Operator
  // types "gemini" / "moonshot" / "claude" / etc. to narrow ~365 catalog
  // models down to matches. Empty string = default top-25 view.
  const [modelSearch, setModelSearch] = useState("");
  const [newProviderKey, setNewProviderKey] = useState("");
  const [newGatewayName, setNewGatewayName] = useState("");
  const [newGatewayUrl, setNewGatewayUrl] = useState("");
  const [newGatewayToken, setNewGatewayToken] = useState("");
  const [newGatewayClient, setNewGatewayClient] = useState("");
  const [testResult, setTestResult] = useState<{ id: string; status: string; models?: string[]; totalCount?: number } | null>(null);

  // Themed confirm dialog — replaces window.confirm() for destructive actions
  // (remove provider, remove model). Holds the title + body + the action to
  // run on confirm. Cleared on cancel or after the action resolves.
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    body: React.ReactNode;
    confirmLabel?: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  // Hermes instance state
  const [hermesInstances, setHermesInstances] = useState<HermesInstanceConfig[]>([]);
  const [hermesStatus, setHermesStatus] = useState<HermesDiagnostics | null>(null);
  const [hermesTestResult, setHermesTestResult] = useState<string | null>(null);
  const [newHermesName, setNewHermesName] = useState("");
  const [newHermesPath, setNewHermesPath] = useState("");
  // Fleet Connector sub-section toggles. Persisted across reloads via
  // localStorage so an operator who never uses Hermes (or Paperclip etc.)
  // can collapse it once and have it stay collapsed. the operator's use case
  // 2026-05-01: "I never use Hermes, hide it."
  const [fcOpenClaw, setFcOpenClaw] = useStickyBoolean("clawnex_fc_openclaw", true);
  const [fcHermes, setFcHermes] = useStickyBoolean("clawnex_fc_hermes", true);

  // Operator management state (RBAC)
  const [rbacOperators, setRbacOperators] = useState<Array<{
    id: string; username: string; display_name: string | null; email: string | null; role: string;
    is_active: number; last_login_at: string | null; login_count: number;
    failed_login_count: number; created_at: string;
  }>>([]);
  const [rbacEnabled, setRbacEnabled] = useState(false);
  const [rbacCurrentOperator, setRbacCurrentOperator] = useState<{ id: string; role: string } | null>(null);
  const [newOperatorUsername, setNewOperatorUsername] = useState("");
  const [newOperatorPassword, setNewOperatorPassword] = useState("");
  const [newOperatorRole, setNewOperatorRole] = useState("viewer");
  const [newOperatorDisplayName, setNewOperatorDisplayName] = useState("");
  const [newOperatorEmail, setNewOperatorEmail] = useState("");
  const [editingOperatorId, setEditingOperatorId] = useState<string | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [resetPasswordId, setResetPasswordId] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [sessionTimeoutHours, setSessionTimeoutHours] = useState(24);
  const [sessionTimeoutSaving, setSessionTimeoutSaving] = useState(false);

  // My Sessions state
  const [mySessions, setMySessions] = useState<Array<{
    id: string; ipAddress: string | null; userAgent: string | null;
    createdAt: string; lastUsedAt: string | null; expiresAt: string; isCurrent: boolean;
  }>>([]);
  const [mySessionsLoading, setMySessionsLoading] = useState(false);

  const fetchMySessions = useCallback(async () => {
    setMySessionsLoading(true);
    try {
      const res = await fetch("/api/auth/sessions");
      if (res.ok) {
        const data = await res.json();
        setMySessions(data.sessions || []);
      }
    } catch {}
    setMySessionsLoading(false);
  }, []);

  // Fetch sessions on mount when RBAC is active
  useEffect(() => {
    if (rbacEnabled && rbacCurrentOperator) fetchMySessions();
  }, [rbacEnabled, rbacCurrentOperator, fetchMySessions]);

  // Fetch all config from API — fully parallelized
  const fetchConfig = useCallback(async () => {
    try {
      const [provRes, gwRes, defRes, hermesRes, healthRes, meRes] = await Promise.allSettled([
        fetch("/api/config/providers"),
        fetch("/api/config/gateways"),
        fetch("/api/config/defaults"),
        fetch("/api/config/hermes-instances"),
        // /api/health/detailed — authenticated endpoint carrying the
        // hermesWatcher fields this panel surfaces. Public /api/health
        // deliberately omits them per review finding #A4.
        fetch("/api/health/detailed"),
        fetch("/api/auth/me"),
      ]);

      // Providers
      if (provRes.status === "fulfilled" && provRes.value.ok) {
        const data = await provRes.value.json();
        setProviders((data.providers || []).map((p: { id: string; name: string; type: string; base_url: string; api_key: string; is_default: number; models?: Array<{ model_id: string }> }) => ({
          id: p.id, name: p.name, type: p.type as ModelProvider["type"], baseUrl: p.base_url, apiKey: p.api_key || "",
          models: (p.models || []).map((m: { model_id: string }) => m.model_id),
          isDefault: p.is_default === 1,
        })));
      }

      // Gateways
      if (gwRes.status === "fulfilled" && gwRes.value.ok) {
        const data = await gwRes.value.json();
        setGateways((data.gateways || []).map((g: { id: string; name: string; url: string; token: string; status: string; is_primary: number; last_error: string | null; client_name?: string }) => ({
          id: g.id, name: g.name, url: g.url, token: g.token || "",
          status: g.status as GatewayInstance["status"], isPrimary: g.is_primary === 1, lastError: g.last_error,
          clientName: g.client_name || "",
        })));
      }

      // Defaults (includes session_ttl_hours, default_model, default_provider)
      let settings: Record<string, string> = {};
      if (defRes.status === "fulfilled" && defRes.value.ok) {
        const data = await defRes.value.json();
        settings = data.settings || {};
        if (settings.default_model) setDefaultModel(settings.default_model);
        if (settings.default_provider) setDefaultProvider(settings.default_provider);
        const ttl = parseInt(settings.session_ttl_hours || "24", 10);
        if (!isNaN(ttl) && ttl > 0) setSessionTimeoutHours(ttl);
      }

      // Hermes instances
      if (hermesRes.status === "fulfilled" && hermesRes.value.ok) {
        const data = await hermesRes.value.json();
        setHermesInstances(data.instances || []);
      }

      // Hermes status from health
      if (healthRes.status === "fulfilled" && healthRes.value.ok) {
        const h = await healthRes.value.json();
        const hw = h.hermesWatcher || {};
        setHermesStatus(hw.diagnostics || null);
      }

      // RBAC operator info
      if (meRes.status === "fulfilled" && meRes.value.ok) {
        const meData = await meRes.value.json();
        if (meData.id && meData.id !== "system") {
          setRbacEnabled(true);
          setRbacCurrentOperator({ id: meData.id, role: meData.role });
          if (meData.role === "admin") {
            try {
              const opRes = await fetch("/api/config/operators");
              if (opRes.ok) {
                const opData = await opRes.json();
                setRbacOperators(opData.operators || []);
              }
            } catch {}
          }
        } else {
          setRbacEnabled(false);
        }
      }
    } catch { /* silent */ }

    setLoading(false);
  }, []);

  useEffect(() => { fetchConfig(); const iv = setInterval(fetchConfig, 30000); return () => clearInterval(iv); }, [fetchConfig]);

  const [defaultSaved, setDefaultSaved] = useState<string | null>(null);
  const saveDefault = useCallback(async (model: string, provider: string) => {
    setDefaultModel(model); setDefaultProvider(provider); setDefaultSaved("Saving...");
    // Retry up to 2 times on 502 (dev server compilation race)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch("/api/config/models/default", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerId: provider, modelId: model }) });
        if (res.ok) { setDefaultSaved("Saved"); setTimeout(() => setDefaultSaved(null), 2000); return; }
        if (res.status === 502 && attempt === 0) { await new Promise(r => setTimeout(r, 2000)); continue; }
        const err = await res.json().catch(() => ({}));
        setDefaultSaved(`Failed: ${(err as { error?: string }).error || res.status}`); setTimeout(() => setDefaultSaved(null), 3000); return;
      } catch {
        if (attempt === 0) { await new Promise(r => setTimeout(r, 2000)); continue; }
        setDefaultSaved("Network error"); setTimeout(() => setDefaultSaved(null), 3000); return;
      }
    }
  }, []);

  const testProvider = useCallback(async (p: ModelProvider) => {
    setTestResult({ id: p.id, status: "testing..." });
    try {
      const res = await fetch(`/api/config/providers/${p.id}/test`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "connected") {
          setTestResult({ id: p.id, status: "connected", models: data.models, totalCount: data.totalCount });
          // Refresh providers to pick up discovered models
          fetchConfig();
        } else {
          setTestResult({ id: p.id, status: data.error ? `${data.status}: ${data.error}` : data.status });
        }
      } else {
        setTestResult({ id: p.id, status: "error: API call failed" });
      }
    } catch (err) {
      setTestResult({ id: p.id, status: `offline: ${err instanceof Error ? err.message : "unreachable"}` });
    }
  }, [fetchConfig]);

  const addProvider = useCallback(async () => {
    if (!newProviderName.trim() || !newProviderUrl.trim()) return;
    try {
      const res = await fetch("/api/config/providers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProviderName.trim(), type: newProviderType, baseUrl: newProviderUrl.trim(), apiKey: newProviderKey }),
      });
      if (res.ok) {
        setNewProviderName(""); setNewProviderUrl(""); setNewProviderKey("");
        fetchConfig();
        // Surface the manual-Restart contract — see comment on
        // restartHintVisible state for the full reasoning.
        setRestartHintVisible(true);
        const data = await res.json();
        if (data.provider) testProvider({ ...data.provider, baseUrl: data.provider.base_url, apiKey: data.provider.api_key || "", models: [] });
      }
    } catch { /* silent */ }
  }, [newProviderName, newProviderUrl, newProviderType, newProviderKey, fetchConfig, testProvider]);

  const removeProvider = useCallback((id: string) => {
    // v0.7.3: confirm before removing — single accidental click would drop
    // the provider AND all its models from litellm config.yaml at once.
    // v0.9.1: themed ConfirmDialog replaces window.confirm() — same gate,
    // dashboard-native UI.
    const provider = providers.find((p) => p.id === id);
    if (!provider) return;
    setPendingConfirm({
      title: "Remove provider",
      body: (
        <>
          Remove provider <b style={{ color: "#fff" }}>&ldquo;{provider.name}&rdquo;</b>{" "}
          ({provider.models.length} model{provider.models.length === 1 ? "" : "s"})?
          <br /><br />
          This updates <code style={{ fontFamily: F.mono }}>litellm config.yaml</code> immediately and will drop every model under this provider. Any active sessions routed through it will fail until the provider is re-added.
        </>
      ),
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/config/providers/${id}`, { method: "DELETE" });
          if (res.ok) {
            fetchConfig();
            // Same restart contract as add — see restartHintVisible comment.
            setRestartHintVisible(true);
          }
        } catch { /* silent */ }
      },
    });
  }, [fetchConfig, providers]);

  const addGateway = useCallback(async () => {
    if (!newGatewayName.trim() || !newGatewayUrl.trim()) return;
    try {
      const res = await fetch("/api/config/gateways", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newGatewayName.trim(), url: newGatewayUrl.trim(), token: newGatewayToken, clientName: newGatewayClient.trim() || undefined }),
      });
      if (res.ok) {
        setNewGatewayName(""); setNewGatewayUrl(""); setNewGatewayToken(""); setNewGatewayClient("");
        fetchConfig();
      }
    } catch { /* silent */ }
  }, [newGatewayName, newGatewayUrl, newGatewayToken, newGatewayClient, fetchConfig]);

  const removeGateway = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/config/gateways/${id}`, { method: "DELETE" });
      if (res.ok) fetchConfig();
    } catch { /* silent */ }
  }, [fetchConfig]);

  const testGateway = useCallback(async (g: GatewayInstance) => {
    try {
      const res = await fetch(`/api/config/gateways/${g.id}/test`, { method: "POST" });
      if (res.ok) {
        const result = await res.json();
        // Update gateway state immediately without waiting for full refetch
        setGateways(prev => prev.map(gw =>
          gw.id === g.id ? { ...gw, status: result.status as GatewayInstance["status"], lastError: result.error || null } : gw
        ));
      }
      fetchConfig();
    } catch { /* silent */ }
  }, [fetchConfig]);

  const inputStyle = { width: "100%", padding: "8px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6, color: C.tx, fontFamily: F.mono, fontSize: 13, outline: "none", boxSizing: "border-box" as const };
  const btnStyle = { padding: "8px 16px", borderRadius: 6, border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer" };
  const autoHermesSaved = !!hermesStatus && hermesInstances.some(inst => hermesInstanceMatchesDiagnostics(inst, hermesStatus));
  const showAutoDetectedHermes = !!hermesStatus?.available && !autoHermesSaved;
  const hermesConnectorCount = hermesInstances.length + (showAutoDetectedHermes ? 1 : 0);
  const renderHermesChecks = (diag: HermesDiagnostics | null | undefined) => {
    if (!diag) return null;
    const checks = [
      { label: "Home", ok: diag.installed, value: diag.home },
      { label: "State DB", ok: diag.stateDbExists && diag.stateDbReadable, value: diag.stateDbPath },
      { label: "Schema", ok: diag.schemaOk, value: diag.schemaOk ? "sessions + messages" : "missing expected tables" },
      { label: "Profile", ok: !!diag.activeProfile, value: diag.activeProfile || "not selected" },
      { label: "Channels", ok: diag.channels.configured.length + diag.channels.observed.length > 0, value: `${diag.channels.configured.length} configured · ${diag.channels.observed.length} observed` },
      { label: "Skills", ok: diag.skills.count > 0, value: `${diag.skills.count} skill file${diag.skills.count === 1 ? "" : "s"}` },
      { label: "Tools", ok: diag.tools.count > 0, value: `${diag.tools.count} extracted · ${diag.tools.names.slice(0, 3).join(", ") || "none"}` },
      { label: "Watcher", ok: diag.watcher.enabled, value: `${diag.watcher.enabled ? "enabled" : "disabled"} · ${Math.round(diag.watcher.pollIntervalMs / 1000)}s poll` },
      { label: "Shield", ok: diag.shieldVisibility.enabled, value: diag.shieldVisibility.mode },
    ];
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6, marginTop: 10 }}>
        {checks.map(check => (
          <div key={check.label} style={{ padding: "7px 8px", borderRadius: 6, background: C.bg, border: `1px solid ${check.ok ? C.green : C.orange}33` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <Dot color={check.ok ? C.green : C.orange} size={5} />
              <span style={{ fontSize: 10, color: C.txT, fontWeight: 800, letterSpacing: "0.04em" }}>{check.label.toUpperCase()}</span>
            </div>
            <div title={check.value} style={{ fontSize: 11, color: C.txS, fontFamily: F.mono, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{check.value}</div>
          </div>
        ))}
      </div>
    );
  };

  // --- Updates state ---
  const [updateStatus, setUpdateStatus] = useState<{
    defenseclaw: { name: string; currentVersion: string; ruleCount: number; lastUpdate: string; latestCommitDate: string | null; updateAvailable: boolean };
    clawkeeper: { name: string; installedVersion: string; latestVersion: string | null; latestDate: string | null; releaseUrl: string | null; updateAvailable: boolean };
    openclaw?: { name: string; installedVersion: string; latestVersion: string | null; latestDate: string | null; releaseUrl: string | null; updateAvailable: boolean };
    lastChecked: string;
  } | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [checkingHostSecurity, setCheckingHostSecurity] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);

  const checkForUpdates = useCallback(async () => {
    setCheckingUpdates(true); setUpdateMessage(null);
    try {
      // Clear cache first
      await fetch("/api/config/updates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check" }) });
      const res = await fetch("/api/config/updates");
      if (res.ok) setUpdateStatus(await res.json());
      // Tell the header UpdateBadge to re-poll. Otherwise it stays stale on
      // its 15-min schedule and operators see a count for an update they
      // just performed.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("clawnex:updates-refreshed"));
      }
    } catch (err) { setUpdateMessage("Failed to check for updates"); }
    setCheckingUpdates(false);
  }, []);

  const refreshHostSecurity = useCallback(async () => {
    setCheckingHostSecurity(true); setUpdateMessage(null);
    try {
      const res = await fetch("/api/config/updates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clawkeeper" }) });
      const data = await res.json();
      if (data.status === "updated") { setUpdateMessage(`Host security scanner ready (${data.newVersion})`); checkForUpdates(); }
      else { setUpdateMessage(data.error || "Scanner check failed"); }
    } catch { setUpdateMessage("Scanner check failed"); }
    setCheckingHostSecurity(false);
  }, [checkForUpdates]);

  // Fetch updates on mount
  useEffect(() => {
    fetch("/api/config/updates").then(r => r.ok ? r.json() : null).then(d => { if (d) setUpdateStatus(d); }).catch(() => {});
  }, []);


  if (loading) return <div style={{ padding: 20, textAlign: "center", color: C.txT }}>Loading configuration...</div>;

  // ═══════════════════════════════════════════════════════════════════════
  // Category groupings (operator-approved 2026-04-24). The six big inline cards
  // (UPDATES, DEFAULT AI MODEL, MODEL PROVIDERS, FLEET CONNECTORS, OPERATOR
  // MANAGEMENT, MY SESSIONS) are bound to local consts below so the
  // categorized return stays readable. Every body is identical to what
  // shipped before — only the outer grouping moved. Collapse state of
  // each CategorySection persists per-user via localStorage.
  // ═══════════════════════════════════════════════════════════════════════

  const updatesCard = (
      <CollapsibleCard title="UPDATES" accent={C.brand} defaultOpen={false} focusKey="updates" focusedCard={focusCard}>
        <div style={{ fontSize: 13, color: C.txS, marginBottom: 12 }}>Check ClawNex Shield Rules drift, bundled host security scanner, OpenClaw, and model pricing.</div>

        {/* ClawNex Shield Rules */}
        <div style={{ padding: "12px 14px", marginBottom: 8, background: C.glassSurfTrans, borderRadius: 8, border: `1px solid ${C.glassBorderSubtle}`, borderLeft: `3px solid ${C.cyan}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Tooltip placement="right" variant="detail" content={<span><strong>ClawNex Shield Rules</strong> — the bundled rule engine behind Prompt Shield. 163+ built-in patterns cover jailbreaks, leaked secrets, command injection, data exfiltration, steganography, encoding tricks, financial PII, and Pliny-family attacks. Rules are versioned, reviewed, and shipped with ClawNex releases. <strong>Check All</strong> polls upstream sources only for informational drift; rule changes are not downloaded or applied at runtime.</span>}>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.tx, borderBottom: `1px dotted ${C.txT}`, cursor: "help" }}>ClawNex Shield Rules</span>
              </Tooltip>
              {updateStatus && (
                <span style={{ fontSize: 12, color: C.txT, fontFamily: F.mono }}>
                  {updateStatus.defenseclaw.currentVersion} &middot; {updateStatus.defenseclaw.ruleCount} rules
                </span>
              )}
            </div>
            {/* No "Update Available" badge here — ClawNex Shield Rules ship bundled
                with ClawNex versions, so the only update path is "update ClawNex
                itself". Surfacing that as a per-row badge with no click target
                was a false affordance (operators clicked it expecting an
                in-product update). The status-bar update notifier is the
                honest place for "ClawNex update available, includes new rules". */}
          </div>
        </div>

        {/* Host Security Scanner */}
        <div style={{ padding: "12px 14px", marginBottom: 8, background: C.glassSurfTrans, borderRadius: 8, border: `1px solid ${C.glassBorderSubtle}`, borderLeft: `3px solid ${C.purp}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Tooltip placement="right" variant="detail" content={<span><strong>Host Security Scanner</strong> — the bundled host-hardening scanner. Audits prerequisites, installation hygiene, host hardening, network posture, and compliance checks, then assigns an A–F grade you&apos;ll see on the <strong>Security Posture</strong> tab. Optional but strongly recommended — without it, the Security Posture grade can&apos;t be computed.</span>}>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.tx, borderBottom: `1px dotted ${C.txT}`, cursor: "help" }}>Host Security Scanner</span>
              </Tooltip>
              {updateStatus && (
                <span style={{ fontSize: 12, color: C.txT, fontFamily: F.mono }}>
                  {updateStatus.clawkeeper.installedVersion}
                  {updateStatus.clawkeeper.latestVersion && updateStatus.clawkeeper.updateAvailable && (
                    <span style={{ color: C.brand }}> (latest: {updateStatus.clawkeeper.latestVersion})</span>
                  )}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {updateStatus?.clawkeeper.installedVersion === "not installed" ? (
                <Tooltip placement="left" variant="detail" content={<span>Verify that the bundled scanner is available on this host. The <strong>Security Posture</strong> grade appears after the first scan runs.</span>}>
                  <button onClick={async () => {
                    try {
                      const res = await fetch("/api/system/install-clawkeeper", { method: "POST" });
                      if (res.ok) { checkForUpdates(); }
                    } catch {}
                  }} style={{
                    padding: "4px 12px", background: C.green, color: C.bg, border: "none", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: "pointer",
                  }}>
                    Verify
                  </button>
                </Tooltip>
              ) : updateStatus?.clawkeeper.updateAvailable ? (
                <Tooltip placement="left" variant="compact" content="Refresh the bundled scanner state. No service restart needed.">
                  <button onClick={refreshHostSecurity} disabled={checkingHostSecurity} style={{
                    padding: "4px 12px", background: C.brand, color: C.bg, border: "none", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: checkingHostSecurity ? "wait" : "pointer",
                  }}>
                    {checkingHostSecurity ? "Checking..." : "Refresh"}
                  </button>
                </Tooltip>
              ) : (
                <Badge label="Ready" color={C.txT} />
              )}
            </div>
          </div>
        </div>

        {/* Model Pricing — DB-backed, refreshable from LiteLLM GitHub */}
        <ModelPricingRow />

        {/* OpenClaw */}
        {updateStatus?.openclaw && (
          <div style={{ padding: "12px 14px", marginBottom: 8, background: C.glassSurfTrans, borderRadius: 8, border: `1px solid ${C.glassBorderSubtle}`, borderLeft: `3px solid ${C.brand}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Tooltip placement="right" variant="detail" content={<span><strong>OpenClaw</strong> — the upstream agent runtime ClawNex pairs with. It owns agent identity, session storage, and (when configured) routes LLM traffic through the LiteLLM proxy that ClawNex scans. Updates here just check the latest GitHub release; <strong>actual upgrades happen in OpenClaw&apos;s own install</strong> (ClawNex doesn&apos;t modify OpenClaw — see the &quot;never touch OpenClaw&quot; rule).</span>}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.tx, borderBottom: `1px dotted ${C.txT}`, cursor: "help" }}>OpenClaw</span>
                </Tooltip>
                <span style={{ fontSize: 12, color: C.txT, fontFamily: F.mono }}>
                  {updateStatus.openclaw.installedVersion}
                  {updateStatus.openclaw.latestVersion && updateStatus.openclaw.updateAvailable && (
                    <span style={{ color: C.brand }}> (latest: {updateStatus.openclaw.latestVersion})</span>
                  )}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {updateStatus.openclaw.updateAvailable && updateStatus.openclaw.releaseUrl ? (
                  <a href={updateStatus.openclaw.releaseUrl} target="_blank" rel="noopener noreferrer" style={{
                    padding: "4px 12px", background: C.brand, color: C.bg, border: "none", borderRadius: 4, fontSize: 11, fontWeight: 700, textDecoration: "none",
                  }}>View Release</a>
                ) : (
                  <Badge label="Up to date" color={C.txT} />
                )}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.glassBorderSubtle}` }}>
          <span style={{ fontSize: 12, color: C.txT, fontFamily: F.mono }}>
            Last checked: {updateStatus?.lastChecked ? timeAgo(updateStatus.lastChecked) : "never"}
          </span>
          {updateMessage && <span style={{ fontSize: 12, color: updateMessage.includes("failed") || updateMessage.includes("Failed") ? C.danger : C.brand, fontFamily: F.mono }}>{updateMessage}</span>}
          <Tooltip placement="left" variant="detail" content={<span>Re-poll for ClawNex Shield Rules upstream drift, OpenClaw releases, and Model Pricing versions; host scanner availability is checked locally. Bypasses the local cache so you always see the latest source state. Result populates the rows above.</span>}>
            <button onClick={checkForUpdates} disabled={checkingUpdates} style={{
              padding: "5px 14px", background: checkingUpdates ? C.glassSurfTrans : `${C.brand}18`, border: `1px solid ${C.brand}44`, borderRadius: 6,
              color: C.brand, fontSize: 12, fontWeight: 600, cursor: checkingUpdates ? "wait" : "pointer", fontFamily: F.sans,
            }}>
              {checkingUpdates ? "Checking..." : "Check All"}
            </button>
          </Tooltip>
        </div>
      </CollapsibleCard>
  );

  const defaultAiModelCard = (
      <CollapsibleCard title="DEFAULT AI MODEL" accent={C.brand} defaultOpen={false}>
        <div style={{ fontSize: 13, color: C.txS, marginBottom: 10 }}>Select the default model for AI chat and analysis. This can be overridden per-session in the chat panel.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <div style={{ fontSize: 12, color: C.txT, marginBottom: 4, fontWeight: 600 }}>PROVIDER</div>
            <Tooltip placement="top" variant="detail" content={<span>Which configured Model Provider to use for AI chat by default. Switching here re-selects the first model under that provider — pick the model below if you want a specific one.</span>}>
              <select value={defaultProvider} onChange={e => { const prov = e.target.value; setDefaultProvider(prov); const firstModel = providers.find(p => p.id === prov)?.models[0]; if (firstModel) saveDefault(firstModel, prov); }} style={{ ...inputStyle, cursor: "pointer" }}>
                {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Tooltip>
          </div>
          <div>
            <div style={{ fontSize: 12, color: C.txT, marginBottom: 4, fontWeight: 600 }}>MODEL</div>
            <Tooltip placement="top" variant="detail" content={<span>The specific model used for AI chat and generated analysis. Saves immediately on change. Operators can override per-session in the chat panel — this is just the default landing.</span>}>
              <select value={defaultModel} onChange={e => saveDefault(e.target.value, defaultProvider)} style={{ ...inputStyle, cursor: "pointer" }}>
                {providers.find(p => p.id === defaultProvider)?.models.map(m => <option key={m} value={m}>{m}</option>) || <option>No models</option>}
              </select>
            </Tooltip>
          </div>
        </div>
        {defaultSaved && <div style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: defaultSaved === "Saved" ? C.green : C.danger, fontFamily: F.mono }}>{defaultSaved === "Saved" ? "\u2713" : "\u2717"} {defaultSaved}</div>}
        <div style={{ marginTop: 10, padding: "8px 12px", background: `${C.brand}0c`, borderRadius: 6, border: `1px solid ${C.brand}22` }}>
          <span style={{ fontSize: 12, color: C.brand, fontFamily: F.mono }}>Active: {defaultModel} via {providers.find(p => p.id === defaultProvider)?.name || defaultProvider}</span>
        </div>
      </CollapsibleCard>
  );

  const modelProvidersCard = (
      <CollapsibleCard title="MODEL PROVIDERS" accent={C.cyan} count={providers.length} defaultOpen={false} focusKey="modelProviders" focusedCard={focusCard}>
        <div style={{ fontSize: 13, color: C.txS, marginBottom: 12 }}>Manage LM Studio instances and OpenAI-compatible API endpoints.</div>
        {/* Restart-required banner — surfaces the manual-Restart contract
            after provider add/remove. Per the reviewer's 2026-05-09 conditional
            sign-off: provider save syncs config.yaml but does NOT auto-
            restart LiteLLM. Operator must click Restart in Infrastructure
            for the new routing to take effect. */}
        {restartHintVisible && (
          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "10px 14px", marginBottom: 12,
            background: `${C.warn}15`,
            border: `1px solid ${C.warn}55`,
            borderLeft: `4px solid ${C.warn}`,
            borderRadius: 8,
          }}>
            <span style={{ fontSize: 14, color: C.warn }}>⟳</span>
            <div style={{ flex: 1, fontSize: 12, color: C.tx, lineHeight: 1.5 }}>
              <strong>Provider saved. LiteLLM config synced.</strong>{" "}
              <span style={{ color: C.txS }}>
                Click Restart in Infrastructure Health to apply routing changes — until you do, LiteLLM still serves the old model list.
              </span>
            </div>
            {onNavigate && (
              <button
                onClick={() => { setRestartHintVisible(false); onNavigate("infrastructure"); }}
                style={{
                  padding: "4px 10px", fontSize: 11, fontWeight: 700, fontFamily: F.mono,
                  background: C.warn, color: "#06121f", border: 0, borderRadius: 6,
                  cursor: "pointer", flexShrink: 0,
                  textTransform: "uppercase" as const, letterSpacing: "0.05em",
                }}
              >
                Open Infrastructure ▸
              </button>
            )}
            <button
              onClick={() => setRestartHintVisible(false)}
              title="Dismiss"
              style={{
                padding: "2px 6px", fontSize: 14, color: C.txT,
                background: "transparent", border: 0, cursor: "pointer", flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
        )}
        {providers.map(p => (
          <div key={p.id} style={{ padding: "12px 14px", marginBottom: 8, background: C.glassSurfTrans, borderRadius: 8, border: `1px solid ${C.glassBorderSubtle}`, borderLeft: `3px solid ${p.type === "openclaw" ? C.brand : p.type === "lmstudio" ? C.cyan : C.purp}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.tx }}>{p.name}</span>
                <Badge color={p.type === "openclaw" ? C.brand : p.type === "lmstudio" ? C.cyan : C.purp} label={p.type} />
                {p.isDefault && <Badge color={C.brand} label="default" />}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <Tooltip placement="left" variant="detail" content={<span>Ask the provider what models it offers, using the saved base URL + key. Discovered models get added to this provider so they show up in the Default AI Model dropdown.</span>}>
                  <button onClick={() => testProvider(p)} style={{ ...btnStyle, background: C.info, color: "#fff", padding: "4px 10px", fontSize: 12 }}>Test</button>
                </Tooltip>
                {!p.isDefault && (
                  <Tooltip placement="left" variant="detail" content={<span>Delete this provider and every model under it. A confirm dialog appears first. <strong>Heads-up:</strong> any active session routed through it will fail until you re-add the provider.</span>}>
                    <button onClick={() => removeProvider(p.id)} style={{ ...btnStyle, background: C.danger, color: "#fff", padding: "4px 10px", fontSize: 12 }}>Remove</button>
                  </Tooltip>
                )}
              </div>
            </div>
            <div style={{ fontSize: 12, color: C.txT, fontFamily: F.mono, marginBottom: 4 }}>{p.baseUrl}</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {p.models.map(m => (
                <button key={m} onClick={() => {
                  // v0.7.3 / v0.9.1: themed ConfirmDialog gate before removal.
                  // Single accidental click would mutate litellm config.yaml
                  // and could disrupt active sessions routed through this
                  // provider/model.
                  setPendingConfirm({
                    title: "Remove model",
                    body: (
                      <>
                        Remove model <b style={{ color: "#fff" }}>&ldquo;{m}&rdquo;</b>{" "}
                        from provider <b style={{ color: "#fff" }}>&ldquo;{p.name}&rdquo;</b>?
                        <br /><br />
                        This updates <code style={{ fontFamily: F.mono }}>litellm config.yaml</code> immediately. Any active sessions routed through <code style={{ fontFamily: F.mono }}>{p.name}/{m}</code> will fail until the model is re-added or routed elsewhere.
                      </>
                    ),
                    onConfirm: async () => {
                      try {
                        await fetch(`/api/config/models?providerId=${encodeURIComponent(p.id)}&modelId=${encodeURIComponent(m)}`, { method: "DELETE" });
                        fetchConfig();
                      } catch {}
                    },
                  });
                }} title={`Click to remove ${m} (you'll be asked to confirm)`} style={{
                  display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, fontFamily: F.mono,
                  background: `${C.warn}14`, color: C.warn, border: `1px solid ${C.warn}28`, textTransform: "uppercase", letterSpacing: "0.05em",
                  cursor: "pointer", whiteSpace: "nowrap",
                }}>{m} ✕</button>
              ))}
              {p.models.length === 0 && <span style={{ fontSize: 12, color: C.txT }}>No models — click Test to discover</span>}
            </div>
            {testResult?.id === p.id && (
              <div style={{ marginTop: 6, padding: "6px 10px", borderRadius: 4, background: testResult.status === "connected" ? `${C.brand}0c` : `${C.danger}0c`, border: `1px solid ${testResult.status === "connected" ? C.brand : C.danger}22` }}>
                <span style={{ fontSize: 12, color: testResult.status === "connected" ? C.brand : C.danger, fontFamily: F.mono }}>
                  {testResult.status === "connected" ? (() => {
                    const allModels = testResult.models || [];
                    const total = testResult.totalCount ?? allModels.length;
                    const search = modelSearch.trim().toLowerCase();
                    if (search) {
                      const matches = allModels.filter(m => m.toLowerCase().includes(search));
                      return `\u2713 Connected — ${matches.length} match${matches.length === 1 ? "" : "es"} for "${modelSearch.trim()}" (of ${total} total) — click to add/remove`;
                    }
                    const shown = Math.min(allModels.length, 25);
                    return `\u2713 Connected — top ${shown} of ${total} models — search by name/provider, click to add/remove`;
                  })() : testResult.status}
                </span>
                {testResult.models && testResult.models.length > 0 && (
                  <input
                    value={modelSearch}
                    onChange={e => setModelSearch(e.target.value)}
                    placeholder="Search models — gemini, moonshot, claude, gpt-oss…"
                    style={{
                      marginTop: 6, width: "100%",
                      padding: "4px 8px", fontSize: 11, fontFamily: F.mono,
                      background: C.glassSurfTrans,
                      border: `1px solid ${C.glassSurfBorder}`,
                      borderRadius: 4, color: C.tx, outline: "none",
                    }}
                  />
                )}
                {testResult.models && testResult.models.length > 0 && (() => {
                  const search = modelSearch.trim().toLowerCase();
                  const visible = search
                    ? testResult.models.filter(m => m.toLowerCase().includes(search))
                    : testResult.models.slice(0, 25);
                  return (
                  <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {visible.map(m => {
                      const isConfigured = p.models.some(cm => cm.toLowerCase() === m.toLowerCase());
                      return (
                        <button key={m} onClick={async () => {
                          // v0.7.3 / v0.9.1: themed ConfirmDialog gate only
                          // on the destructive branch. Adding a model is
                          // reversible; removing it from config.yaml is the
                          // disruption risk.
                          if (isConfigured) {
                            setPendingConfirm({
                              title: "Remove model",
                              body: (
                                <>
                                  Remove model <b style={{ color: "#fff" }}>&ldquo;{m}&rdquo;</b>{" "}
                                  from provider <b style={{ color: "#fff" }}>&ldquo;{p.name}&rdquo;</b>?
                                  <br /><br />
                                  This updates <code style={{ fontFamily: F.mono }}>litellm config.yaml</code> immediately. Any active sessions routed through <code style={{ fontFamily: F.mono }}>{p.name}/{m}</code> will fail until the model is re-added or routed elsewhere.
                                </>
                              ),
                              onConfirm: async () => {
                                try {
                                  await fetch(`/api/config/models?providerId=${encodeURIComponent(p.id)}&modelId=${encodeURIComponent(m)}`, { method: "DELETE" });
                                  fetchConfig();
                                } catch {}
                              },
                            });
                            return;
                          }
                          // Additive branch — no confirmation needed.
                          try {
                            await fetch("/api/config/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider_id: p.id, model_id: m }) });
                            fetchConfig();
                          } catch {}
                        }} title={isConfigured ? `Click to remove ${m} (you'll be asked to confirm)` : `Click to add ${m}`} style={{
                          display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, fontFamily: F.mono,
                          background: isConfigured ? `${C.warn}14` : `${C.brand}14`,
                          color: isConfigured ? C.warn : C.brand,
                          border: `1px solid ${isConfigured ? C.warn : C.brand}28`,
                          textTransform: "uppercase", letterSpacing: "0.05em",
                          cursor: "pointer", whiteSpace: "nowrap",
                        }}>{isConfigured ? `${m} ✕` : `+ ${m}`}</button>
                      );
                    })}
                  </div>
                  );
                })()}
              </div>
            )}
          </div>
        ))}

        {/* Add new provider */}
        <div style={{ padding: "14px", background: `${C.cyan}06`, borderRadius: 8, border: `1px dashed ${C.cyan}33`, marginTop: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.cyan, marginBottom: 10 }}>Add Model Provider</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 11, color: C.txT, marginBottom: 3 }}>NAME</div>
              <input value={newProviderName} onChange={e => setNewProviderName(e.target.value)} placeholder="e.g., LM Studio, OpenRouter" style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.txT, marginBottom: 3 }}>TYPE</div>
              <Tooltip placement="top" variant="detail" content={<span>The provider family — drives the LiteLLM routing prefix and auth shape. Choosing a known type also auto-fills the base URL with that provider&apos;s default endpoint, which you can override below if needed.</span>}>
              <select value={newProviderType} onChange={e => {
                const val = e.target.value;
                setNewProviderType(val as string);
                // Auto-fill base URL and name based on provider type
                const providerDefaults: Record<string, { url: string; name: string }> = {
                  "lmstudio": { url: "http://localhost:1234/v1", name: "LM Studio" },
                  "openai-compatible": { url: "http://localhost:8080/v1", name: "" },
                  "openrouter": { url: "https://openrouter.ai/api/v1", name: "OpenRouter" },
                  "anthropic": { url: "https://api.anthropic.com/v1", name: "Anthropic (Claude)" },
                  "openai": { url: "https://api.openai.com/v1", name: "OpenAI (GPT)" },
                  "google-gemini": { url: "https://generativelanguage.googleapis.com/v1beta", name: "Google Gemini" },
                  "azure-openai": { url: "https://YOUR_RESOURCE.openai.azure.com", name: "Azure OpenAI" },
                  "groq": { url: "https://api.groq.com/openai/v1", name: "Groq" },
                  "together": { url: "https://api.together.xyz/v1", name: "Together AI" },
                  "mistral": { url: "https://api.mistral.ai/v1", name: "Mistral AI" },
                  "cohere": { url: "https://api.cohere.ai/v1", name: "Cohere" },
                  "nvidia-nim": { url: "https://integrate.api.nvidia.com/v1", name: "NVIDIA NIM" },
                  "ollama": { url: "http://localhost:11434/v1", name: "Ollama" },
                  "fireworks": { url: "https://api.fireworks.ai/inference/v1", name: "Fireworks AI" },
                  "deepseek": { url: "https://api.deepseek.com/v1", name: "DeepSeek" },
                  "perplexity": { url: "https://api.perplexity.ai", name: "Perplexity" },
                };
                const defaults = providerDefaults[val];
                if (defaults) {
                  setNewProviderUrl(defaults.url);
                  if (defaults.name && !newProviderName) setNewProviderName(defaults.name);
                }
              }} style={{ ...inputStyle, cursor: "pointer" }}>
                <optgroup label="Local">
                  <option value="lmstudio">LM Studio</option>
                  <option value="ollama">Ollama</option>
                </optgroup>
                <optgroup label="Cloud APIs">
                  <option value="openrouter">OpenRouter</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="openai">OpenAI (GPT)</option>
                  <option value="google-gemini">Google Gemini</option>
                  <option value="azure-openai">Azure OpenAI</option>
                  <option value="groq">Groq</option>
                  <option value="together">Together AI</option>
                  <option value="mistral">Mistral AI</option>
                  <option value="cohere">Cohere</option>
                  <option value="nvidia-nim">NVIDIA NIM</option>
                  <option value="fireworks">Fireworks AI</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="perplexity">Perplexity</option>
                </optgroup>
                <optgroup label="Other">
                  <option value="openai-compatible">OpenAI Compatible</option>
                </optgroup>
              </select>
              </Tooltip>
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: C.txT, marginBottom: 3 }}>BASE URL</div>
            <Tooltip placement="top" variant="detail" content={<span>The provider&apos;s API root URL. Most OpenAI-compatible providers use a path ending in <strong>/v1</strong>. This is auto-filled when you pick a known TYPE above — only edit it if you self-host or need a regional/private endpoint (e.g. Azure, NVIDIA NIM, an internal mirror).</span>}>
              <input value={newProviderUrl} onChange={e => setNewProviderUrl(e.target.value)} placeholder="http://localhost:1234/v1" style={inputStyle} />
            </Tooltip>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: C.txT, marginBottom: 3 }}>API KEY (optional)</div>
            <Tooltip placement="top" variant="detail" content={<span>The provider&apos;s API key — what ClawNex sends to authenticate each request. Stored encrypted. Leave blank for local servers (LM Studio, Ollama, vLLM) that don&apos;t require auth.</span>}>
              <input value={newProviderKey} onChange={e => setNewProviderKey(e.target.value)} placeholder="Leave empty for local servers" type="password" style={inputStyle} />
            </Tooltip>
          </div>
          <Tooltip placement="top" variant="detail" content={<span>Save the provider, then immediately test connectivity by asking it for its model list. Any models it returns are added so you can pick one in Default AI Model right away.</span>}>
            <button onClick={addProvider} disabled={!newProviderName.trim() || !newProviderUrl.trim()} style={{ ...btnStyle, background: !newProviderName.trim() || !newProviderUrl.trim() ? C.glassSurfTrans : C.cyan, color: "#fff", width: "100%" }}>
              + Add Provider
            </button>
          </Tooltip>
        </div>
      </CollapsibleCard>
  );

  const fleetConnectorsCard = (
      <CollapsibleCard title={<span style={{ display: "flex", alignItems: "center", gap: 8 }}>FLEET CONNECTORS <span style={{ fontSize: 10, color: C.txT, fontFamily: F.mono }}>4 frameworks &middot; {(gateways.length > 0 ? 1 : 0) + hermesConnectorCount} connected</span></span>} accent={C.brand} defaultOpen={false}>
        <div style={{ fontSize: 13, color: C.txS, marginBottom: 16 }}>Manage connections to agent frameworks. Each connector enables ClawNex to monitor, scan, and protect traffic from that framework.</div>

        {/* --- OpenClaw --- */}
        <div style={{ marginBottom: 20 }}>
          <div onClick={() => setFcOpenClaw(!fcOpenClaw)} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: fcOpenClaw ? 10 : 0, paddingBottom: 6, borderBottom: `1px solid ${C.glassBorderSubtle}`, cursor: "pointer" }}>
            <span style={{ fontSize: 10, color: C.txT, display: "inline-block", transform: fcOpenClaw ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>{"\u25B6"}</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.orange, letterSpacing: "0.04em" }}>OPENCLAW</span>
            <Badge color={gateways.length > 0 ? C.green : C.txT} label={gateways.length > 0 ? "LIVE" : "NOT CONFIGURED"} />
            {!fcOpenClaw && <span style={{ fontSize: 10, color: C.txT, fontFamily: F.mono }}>{gateways.length} instance{gateways.length !== 1 ? "s" : ""}</span>}
          </div>
          {fcOpenClaw && <div>
          {gateways.map(g => (
            <div key={g.id} style={{ padding: "12px 14px", marginBottom: 8, background: C.glassSurfTrans, borderRadius: 8, border: `1px solid ${C.glassBorderSubtle}`, borderLeft: `3px solid ${g.status === "connected" ? C.brand : C.orange}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Dot color={g.status === "connected" ? C.green : g.status === "error" ? C.danger : C.orange} glow size={8} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.tx }}>{g.name}</span>
                  <Badge color={g.status === "connected" ? C.brand : g.status === "error" ? C.danger : C.orange} label={g.status} />
                  {g.isPrimary && <Badge color={C.brand} label="primary" />}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <Tooltip placement="left" variant="detail" content={<span>Open a WebSocket handshake against the gateway URL with the saved auth token. Updates the connection badge inline. <strong>Connected</strong> = OpenClaw is reachable and ClawNex can subscribe to its events.</span>}>
                    <button onClick={() => testGateway(g)} style={{ ...btnStyle, background: C.info, color: "#fff", padding: "4px 10px", fontSize: 12 }}>Test</button>
                  </Tooltip>
                  {!g.isPrimary && (
                    <Tooltip placement="left" variant="compact" content="Disconnect from this gateway. Sessions routed through it stop showing up in fleet view.">
                      <button onClick={() => removeGateway(g.id)} style={{ ...btnStyle, background: C.danger, color: "#fff", padding: "4px 10px", fontSize: 12 }}>Remove</button>
                    </Tooltip>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 12, color: C.txT, fontFamily: F.mono }}>{g.url}</div>
              {g.clientName && <div style={{ fontSize: 11, color: C.cyan, fontFamily: F.mono, marginTop: 2 }}>Client: {g.clientName}</div>}
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                <span style={{ fontSize: 10, color: C.txT, minWidth: 45 }}>TOKEN:</span>
                <input defaultValue={g.token || ""} placeholder="Enter gateway auth token" type="password" onBlur={async (e) => { const newToken = e.target.value; if (newToken === g.token) return; try { await fetch(`/api/config/gateways/${g.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: newToken }) }); await fetch("/api/config/defaults", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "openclaw_gateway_token", value: newToken }) }); fetchConfig(); } catch {} }} style={{ flex: 1, padding: "3px 6px", fontSize: 10, fontFamily: F.mono, background: C.bg, border: `1px solid ${g.token ? C.green : C.danger}44`, borderRadius: 3, color: C.tx, outline: "none" }} />
              </div>
              {g.lastError && <div style={{ fontSize: 11, color: C.danger, fontFamily: F.mono, marginTop: 2 }}>Error: {g.lastError}</div>}
            </div>
          ))}
          <div style={{ padding: "14px", background: `${C.orange}06`, borderRadius: 8, border: `1px dashed ${C.orange}33`, marginTop: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <div><div style={{ fontSize: 11, color: C.txT, marginBottom: 3 }}>NAME</div><input value={newGatewayName} onChange={e => setNewGatewayName(e.target.value)} placeholder="Production Gateway" style={inputStyle} /></div>
              <div><div style={{ fontSize: 11, color: C.txT, marginBottom: 3 }}>WEBSOCKET URL</div><input value={newGatewayUrl} onChange={e => setNewGatewayUrl(e.target.value)} placeholder="ws://your-host-ip:18789" style={inputStyle} /></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <div><div style={{ fontSize: 11, color: C.txT, marginBottom: 3 }}>AUTH TOKEN</div><input value={newGatewayToken} onChange={e => setNewGatewayToken(e.target.value)} placeholder="Gateway authentication token" type="password" style={inputStyle} /></div>
              <div><div style={{ fontSize: 11, color: C.txT, marginBottom: 3 }}>CLIENT NAME</div><input value={newGatewayClient} onChange={e => setNewGatewayClient(e.target.value)} placeholder="e.g., ACME Corp" style={inputStyle} /></div>
            </div>
            <button onClick={addGateway} disabled={!newGatewayName.trim() || !newGatewayUrl.trim()} style={{ ...btnStyle, background: !newGatewayName.trim() || !newGatewayUrl.trim() ? C.glassSurfTrans : C.orange, color: "#fff", width: "100%" }}>+ Add Gateway</button>
          </div>
          </div>}
        </div>

        {/* --- Hermes --- */}
        <div style={{ marginBottom: 20 }}>
          <div onClick={() => setFcHermes(!fcHermes)} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: fcHermes ? 10 : 0, paddingBottom: 6, borderBottom: `1px solid ${C.glassBorderSubtle}`, cursor: "pointer" }}>
            <span style={{ fontSize: 10, color: C.txT, display: "inline-block", transform: fcHermes ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>{"\u25B6"}</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.purp, letterSpacing: "0.04em" }}>HERMES AGENT</span>
            <Badge color={hermesStatus?.available ? C.green : C.txT} label={hermesStatus?.available ? "LIVE" : "NOT CONFIGURED"} />
          </div>
          {fcHermes && <div>
          {showAutoDetectedHermes && (
            <div style={{ padding: "12px 14px", marginBottom: 8, background: C.glassSurfTrans, borderRadius: 8, border: `1px solid ${C.glassBorderSubtle}`, borderLeft: `3px solid ${C.green}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Dot color={C.green} glow size={8} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.tx }}>Hermes Agent</span>
                  <Badge color={hermesStatus.status === "live" ? C.green : C.orange} label={hermesStatus.status.toUpperCase()} />
                  <Badge color={C.purp} label="AUTO-DETECTED" />
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {!autoHermesSaved && (
                    <button onClick={async () => { try { const res = await fetch("/api/config/hermes-instances", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: hermesStatus.activeProfile ? `Hermes ${hermesStatus.activeProfile}` : "Hermes Local", homePath: hermesStatus.home }) }); setHermesTestResult(res.ok ? "SAVED — detected Hermes connection recorded" : "FAIL — could not save detected Hermes"); fetchConfig(); } catch { setHermesTestResult("FAIL — connection error"); } setTimeout(() => setHermesTestResult(null), 5000); }} style={{ padding: "4px 10px", background: C.purp, color: "#fff", border: "none", borderRadius: 4, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Save</button>
                  )}
                  <button onClick={async () => { setHermesTestResult("Testing..."); try { const res = await fetch("/api/health/detailed"); if (res.ok) { const d = await res.json(); const diag = d.hermesWatcher?.diagnostics as HermesDiagnostics | undefined; setHermesTestResult(diag?.available ? `${diag.status.toUpperCase()} — ${diag.messages.last24h} messages / ${diag.sessions.last24h} sessions in 24h` : `FAIL — ${diag?.statusDetail || "state.db not accessible"}`); if (diag) setHermesStatus(diag); } else { setHermesTestResult("FAIL — health endpoint error"); } } catch { setHermesTestResult("FAIL — connection error"); } setTimeout(() => setHermesTestResult(null), 5000); }} style={{ padding: "4px 10px", background: C.info, color: "#fff", border: "none", borderRadius: 4, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Test</button>
                </div>
              </div>
              <div style={{ fontSize: 12, color: C.txT, fontFamily: F.mono }}>{hermesStatus.stateDbPath}</div>
              <div style={{ fontSize: 11, color: C.txS, marginTop: 4 }}>
                Last activity: {hermesStatus.lastActivity ? timeAgo(hermesStatus.lastActivity) : "none"} · {hermesStatus.sessions.last24h} sessions · {hermesStatus.messages.last24h} messages in 24h
              </div>
              {renderHermesChecks(hermesStatus)}
              {hermesStatus.statusDetail && <div style={{ fontSize: 11, color: hermesStatus.available ? C.txT : C.danger, fontFamily: F.mono, marginTop: 6 }}>{hermesStatus.statusDetail}</div>}
              {hermesTestResult && <div style={{ fontSize: 11, fontFamily: F.mono, color: hermesTestResult.startsWith("FAIL") ? C.danger : C.green, marginTop: 6, padding: "4px 8px", background: `${hermesTestResult.startsWith("FAIL") ? C.danger : C.green}08`, borderRadius: 4 }}>{hermesTestResult}</div>}
            </div>
          )}
          {hermesInstances.map(inst => (
            <div key={inst.id} style={{ padding: "12px 14px", marginBottom: 8, background: C.glassSurfTrans, borderRadius: 8, border: `1px solid ${C.glassBorderSubtle}`, borderLeft: `3px solid ${inst.available ? C.green : C.danger}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Dot color={inst.available ? C.green : C.danger} glow={inst.available} size={8} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.tx }}>{inst.name}</span>
                  <Badge color={inst.available ? C.green : C.danger} label={inst.available ? "CONNECTED" : "ERROR"} />
                </div>
                <button onClick={async () => { try { await fetch(`/api/config/hermes-instances?id=${encodeURIComponent(inst.id)}`, { method: "DELETE" }); fetchConfig(); } catch {} }} style={{ padding: "4px 10px", background: C.danger, color: "#fff", border: "none", borderRadius: 4, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Remove</button>
              </div>
              <div style={{ fontSize: 12, color: C.txT, fontFamily: F.mono }}>{inst.home_path}/state.db</div>
              {renderHermesChecks(inst.diagnostics)}
              {inst.statusDetail && <div style={{ fontSize: 11, color: C.danger, fontFamily: F.mono, marginTop: 2 }}>Error: {inst.statusDetail}</div>}
            </div>
          ))}
          <div style={{ padding: "14px", background: `${C.purp}06`, borderRadius: 8, border: `1px dashed ${C.purp}33`, marginTop: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <div><div style={{ fontSize: 11, color: C.txT, marginBottom: 3 }}>NAME</div><input value={newHermesName} onChange={e => setNewHermesName(e.target.value)} placeholder="Hermes Production" style={inputStyle} /></div>
              <div><div style={{ fontSize: 11, color: C.txT, marginBottom: 3 }}>HOME PATH</div><input value={newHermesPath} onChange={e => setNewHermesPath(e.target.value)} placeholder="~/.hermes or /path/to/.hermes" style={inputStyle} /></div>
            </div>
            <button onClick={async () => { if (!newHermesName.trim() || !newHermesPath.trim()) return; try { await fetch("/api/config/hermes-instances", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newHermesName.trim(), homePath: newHermesPath.trim() }) }); setNewHermesName(""); setNewHermesPath(""); fetchConfig(); } catch {} }} disabled={!newHermesName.trim() || !newHermesPath.trim()} style={{ padding: "8px 16px", background: !newHermesName.trim() || !newHermesPath.trim() ? C.glassSurfTrans : C.purp, color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: !newHermesName.trim() || !newHermesPath.trim() ? "not-allowed" : "pointer", width: "100%" }}>+ Add Hermes Instance</button>
          </div>
        </div>}
        </div>

        <div style={{ fontSize: 12, color: C.txT, lineHeight: 1.5 }}>
          Additional fleet connectors are managed through released integrations only.
          ClawNex does not show disabled connector cards until an adapter is available.
        </div>
      </CollapsibleCard>
  );

  const operatorManagementCard = (
        <CollapsibleCard title="OPERATOR MANAGEMENT" accent={C.purp} count={rbacOperators.length} defaultOpen={false} focusKey="operatorManagement" focusedCard={focusCard}>
          <div style={{ fontSize: 13, color: C.txS, marginBottom: 12 }}>Manage operator accounts. Operators authenticate to the dashboard when RBAC is enabled.</div>

          {/* Existing operators */}
          {rbacOperators.map(op => (
            <div key={op.id} style={{ padding: "12px 14px", marginBottom: 8, background: C.glassSurfTrans, borderRadius: 8, border: `1px solid ${C.glassBorderSubtle}`, borderLeft: `3px solid ${op.is_active ? C.green : C.danger}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Dot color={op.is_active ? C.green : C.danger} glow={!!op.is_active} size={8} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.tx }}>{op.username}</span>
                  {op.display_name && <span style={{ fontSize: 12, color: C.txT }}>({op.display_name})</span>}
                  <Badge color={C.purp} label={op.role.replace("_", " ").toUpperCase()} />
                  <Badge color={op.is_active ? C.green : C.danger} label={op.is_active ? "ACTIVE" : "LOCKED"} />
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {/* Role dropdown */}
                  <Tooltip placement="left" variant="detail" content={<span>RBAC role gates what this operator can do. <strong>Admin</strong> = everything. <strong>Security Manager</strong> = shield + correlations + alerts (no operator/provider edits). <strong>Operator</strong> = day-to-day investigation, no config writes. <strong>Viewer</strong> = read-only. <strong>Auditor</strong> = audit log + evidence export only. You can&apos;t change <em>your own</em> role.</span>}>
                    <select
                      value={op.role}
                      onChange={async (e) => {
                        try {
                          await fetch(`/api/config/operators/${encodeURIComponent(op.id)}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ role: e.target.value }),
                          });
                          fetchConfig();
                        } catch {}
                      }}
                      disabled={op.id === rbacCurrentOperator?.id}
                      style={{
                        padding: "3px 6px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4,
                        color: C.txS, fontSize: 11, fontFamily: F.mono, outline: "none",
                        cursor: op.id === rbacCurrentOperator?.id ? "not-allowed" : "pointer",
                        opacity: op.id === rbacCurrentOperator?.id ? 0.5 : 1,
                      }}
                    >
                      <option value="admin">Admin</option>
                      <option value="security_manager">Security Manager</option>
                      <option value="operator">Operator</option>
                      <option value="viewer">Viewer</option>
                      <option value="auditor">Auditor</option>
                    </select>
                  </Tooltip>
                  {/* Unlock button — only when locked (failed logins) */}
                  {!op.is_active && op.id !== rbacCurrentOperator?.id && (
                    <Tooltip placement="left" variant="detail" content={<span>Reset the failed-login counter and re-activate the account. Use this when an operator forgot their password and locked themselves out — better than deleting + recreating, since their audit history stays intact.</span>}>
                      <button onClick={async () => {
                        try {
                          await fetch(`/api/config/operators/${encodeURIComponent(op.id)}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ unlock: true }),
                          });
                          fetchConfig();
                        } catch {}
                      }} style={{ padding: "4px 10px", background: C.warn, color: "#000", border: "none", borderRadius: 4, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Unlock</button>
                    </Tooltip>
                  )}
                  {/* Deactivate / Activate toggle (can't deactivate yourself) */}
                  {op.id !== rbacCurrentOperator?.id && (
                    <Tooltip placement="left" variant="detail" content={<span>Toggle whether this operator can sign in. <strong>Deactivate</strong> kills active sessions and refuses new logins (good for offboarding without losing audit history). <strong>Activate</strong> restores access. Reversible at any time.</span>}>
                      <button onClick={async () => {
                        try {
                          await fetch(`/api/config/operators/${encodeURIComponent(op.id)}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ is_active: !op.is_active }),
                          });
                          fetchConfig();
                        } catch {}
                      }} style={{ padding: "4px 10px", background: op.is_active ? `${C.warn}22` : `${C.green}22`, color: op.is_active ? C.warn : C.green, border: `1px solid ${op.is_active ? C.warn : C.green}44`, borderRadius: 4, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{op.is_active ? "Deactivate" : "Activate"}</button>
                    </Tooltip>
                  )}
                  {/* Remove button (can't remove yourself) */}
                  {op.id !== rbacCurrentOperator?.id && (
                    <Tooltip placement="left" variant="detail" content={<span><strong style={{ color: C.danger }}>Permanent.</strong> Deletes the operator row and revokes every session. Their audit log entries stay (RBAC actions are append-only). Prefer <strong>Deactivate</strong> for offboarding so you don&apos;t lose the lookup; use Remove only when you&apos;re sure.</span>}>
                      <button onClick={async () => {
                        try {
                          await fetch(`/api/config/operators/${encodeURIComponent(op.id)}`, { method: "DELETE" });
                          fetchConfig();
                        } catch {}
                      }} style={{ padding: "4px 10px", background: C.danger, color: "#fff", border: "none", borderRadius: 4, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Remove</button>
                    </Tooltip>
                  )}
                </div>
              </div>
              {/* Email display */}
              {op.email && editingOperatorId !== op.id && (
                <div style={{ fontSize: 12, color: C.txS, marginBottom: 4, paddingLeft: 20 }}>{op.email}</div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 4 }}>
                <div style={{ fontSize: 11, color: C.txS }}><span style={{ color: C.txT }}>Last login:</span> {op.last_login_at ? timeAgo(op.last_login_at) : "Never"}</div>
                <div style={{ fontSize: 11, color: C.txS }}><span style={{ color: C.txT }}>Logins:</span> {op.login_count}</div>
                <div style={{ fontSize: 11, color: C.txS }}><span style={{ color: C.txT }}>Created:</span> {timeAgo(op.created_at)}</div>
              </div>
              {/* Inline edit and reset password controls */}
              <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                {editingOperatorId === op.id ? (
                  <>
                    <input
                      value={editDisplayName}
                      onChange={e => setEditDisplayName(e.target.value)}
                      placeholder="Display Name"
                      style={{ padding: "4px 8px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, color: C.tx, fontFamily: F.mono, fontSize: 11, outline: "none", width: 140 }}
                    />
                    <input
                      value={editEmail}
                      onChange={e => setEditEmail(e.target.value)}
                      placeholder="Email"
                      style={{ padding: "4px 8px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, color: C.tx, fontFamily: F.mono, fontSize: 11, outline: "none", width: 180 }}
                    />
                    <button onClick={async () => {
                      try {
                        await fetch(`/api/config/operators/${encodeURIComponent(op.id)}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ display_name: editDisplayName, email: editEmail }),
                        });
                        setEditingOperatorId(null);
                        fetchConfig();
                      } catch {}
                    }} style={{ padding: "4px 10px", background: C.green, color: "#fff", border: "none", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Save</button>
                    <button onClick={() => setEditingOperatorId(null)} style={{ padding: "4px 10px", background: C.srf, color: C.txS, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Cancel</button>
                  </>
                ) : (
                  <button onClick={() => { setEditingOperatorId(op.id); setEditDisplayName(op.display_name || ""); setEditEmail(op.email || ""); setResetPasswordId(null); }} style={{ padding: "4px 10px", background: C.srf, color: C.txS, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Edit Name / Email</button>
                )}
                {resetPasswordId === op.id ? (
                  <>
                    <input
                      type="password"
                      value={resetPasswordValue}
                      onChange={e => setResetPasswordValue(e.target.value)}
                      placeholder="New password (min 8)"
                      style={{ padding: "4px 8px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, color: C.tx, fontFamily: F.mono, fontSize: 11, outline: "none", width: 160 }}
                    />
                    <button onClick={async () => {
                      if (resetPasswordValue.length < 8) return;
                      try {
                        await fetch(`/api/config/operators/${encodeURIComponent(op.id)}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ password: resetPasswordValue }),
                        });
                        setResetPasswordId(null);
                        setResetPasswordValue("");
                        fetchConfig();
                      } catch {}
                    }} disabled={resetPasswordValue.length < 8} style={{ padding: "4px 10px", background: resetPasswordValue.length < 8 ? C.glassSurfTrans : C.purp, color: "#fff", border: "none", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: resetPasswordValue.length < 8 ? "not-allowed" : "pointer" }}>Set</button>
                    <button onClick={() => { setResetPasswordId(null); setResetPasswordValue(""); }} style={{ padding: "4px 10px", background: C.srf, color: C.txS, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Cancel</button>
                  </>
                ) : (
                  <button onClick={() => { setResetPasswordId(op.id); setResetPasswordValue(""); setEditingOperatorId(null); }} style={{ padding: "4px 10px", background: C.srf, color: C.txS, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Reset Password</button>
                )}
              </div>
            </div>
          ))}

          {rbacOperators.length === 0 && (
            <div style={{ padding: "16px", textAlign: "center", color: C.txT, fontSize: 12, fontStyle: "italic" }}>No operators found.</div>
          )}

          {/* Add new operator form */}
          <div style={{ padding: "14px", background: `${C.purp}06`, borderRadius: 8, border: `1px dashed ${C.purp}33`, marginTop: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.purp, marginBottom: 10 }}>Add Operator</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 11, color: C.txT, marginBottom: 3 }}>USERNAME</div>
                <Tooltip placement="top" variant="detail" content={<span>Login identifier. Lowercase, no spaces. Shown in audit log entries — keep it short and recognizable. Cannot be changed after creation.</span>}>
                  <input value={newOperatorUsername} onChange={e => setNewOperatorUsername(e.target.value)} placeholder="jdoe"
                    style={{ width: "100%", padding: "8px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6, color: C.tx, fontFamily: F.mono, fontSize: 13, outline: "none", boxSizing: "border-box" as const }} />
                </Tooltip>
              </div>
              <div>
                <div style={{ fontSize: 11, color: C.txT, marginBottom: 3 }}>DISPLAY NAME</div>
                <input value={newOperatorDisplayName} onChange={e => setNewOperatorDisplayName(e.target.value)} placeholder="Jane Doe"
                  style={{ width: "100%", padding: "8px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6, color: C.tx, fontFamily: F.mono, fontSize: 13, outline: "none", boxSizing: "border-box" as const }} />
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: C.txT, marginBottom: 3 }}>EMAIL</div>
              <input value={newOperatorEmail} onChange={e => setNewOperatorEmail(e.target.value)} placeholder="jane@example.com"
                style={{ width: "100%", padding: "8px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6, color: C.tx, fontFamily: F.mono, fontSize: 13, outline: "none", boxSizing: "border-box" as const }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 11, color: C.txT, marginBottom: 3 }}>PASSWORD</div>
                <Tooltip placement="top" variant="detail" content={<span>Initial password — minimum 8 characters. The strength meter below shows entropy at a glance. This is a <strong>break-glass</strong> credential; recommend the operator add a passkey or Magic Link as their primary login after first sign-in.</span>}>
                  <input type="password" value={newOperatorPassword} onChange={e => setNewOperatorPassword(e.target.value)} placeholder="Min 8 characters"
                    style={{ width: "100%", padding: "8px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6, color: C.tx, fontFamily: F.mono, fontSize: 13, outline: "none", boxSizing: "border-box" as const }} />
                </Tooltip>
                {newOperatorPassword && (() => {
                  const strength = getPasswordStrength(newOperatorPassword);
                  return (
                    <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1, height: 3, background: '#14213d', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${(strength.score / 5) * 100}%`, height: '100%', background: strength.color, borderRadius: 2, transition: 'width 0.3s, background 0.3s' }} />
                      </div>
                      <span style={{ fontSize: 9, color: strength.color, fontWeight: 600, minWidth: 32 }}>{strength.label}</span>
                    </div>
                  );
                })()}
              </div>
              <div>
                <div style={{ fontSize: 11, color: C.txT, marginBottom: 3, display: "flex", alignItems: "center", gap: 6 }}>ROLE</div>
                <select value={newOperatorRole} onChange={e => setNewOperatorRole(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 6, color: C.tx, fontFamily: F.mono, fontSize: 13, outline: "none", boxSizing: "border-box" as const }}>
                  <option value="admin">Admin</option>
                  <option value="security_manager">Security Manager</option>
                  <option value="operator">Operator</option>
                  <option value="viewer">Viewer</option>
                  <option value="auditor">Auditor</option>
                </select>
              </div>
            </div>
            <Tooltip placement="top" variant="detail" content={<span>Create the operator account. They can sign in right away with the username and password above. <strong>The audit log records who created the account, when, and from where.</strong></span>}>
              <button onClick={async () => {
                if (!newOperatorUsername.trim() || !newOperatorPassword.trim()) return;
                try {
                  const res = await fetch("/api/config/operators", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      username: newOperatorUsername.trim(),
                      password: newOperatorPassword,
                      role: newOperatorRole,
                      display_name: newOperatorDisplayName.trim() || undefined,
                      email: newOperatorEmail.trim() || undefined,
                    }),
                  });
                  if (res.ok) {
                    setNewOperatorUsername(""); setNewOperatorPassword(""); setNewOperatorRole("viewer"); setNewOperatorDisplayName(""); setNewOperatorEmail("");
                    fetchConfig();
                  }
                } catch {}
              }} disabled={!newOperatorUsername.trim() || newOperatorPassword.length < 8}
                style={{
                  padding: "8px 16px", width: "100%", borderRadius: 6, border: "none", fontSize: 13, fontWeight: 700, cursor: !newOperatorUsername.trim() || newOperatorPassword.length < 8 ? "not-allowed" : "pointer",
                  background: !newOperatorUsername.trim() || newOperatorPassword.length < 8 ? C.glassSurfTrans : C.purp, color: "#fff",
                }}>
                + Add Operator
              </button>
            </Tooltip>
          </div>

          {/* Session Timeout Setting */}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.glassBorderSubtle}` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.txS, marginBottom: 8 }}>Session Settings</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: C.txT, minWidth: 120 }}>Session timeout:</span>
              <input
                type="number"
                min={1}
                max={720}
                value={sessionTimeoutHours}
                onChange={e => setSessionTimeoutHours(Math.max(1, Math.min(720, parseInt(e.target.value) || 24)))}
                style={{ width: 60, padding: "4px 8px", fontSize: 12, fontFamily: F.mono, background: C.glassSurfTrans, border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, color: C.tx, textAlign: "center" }}
              />
              <span style={{ fontSize: 11, color: C.txT }}>hours</span>
              <Tooltip placement="left" variant="detail" content={<span>Persist the session lifetime. Existing sessions keep their original expiry — only sessions created after this point use the new value.</span>}>
                <button
                  onClick={async () => {
                    setSessionTimeoutSaving(true);
                    try {
                      await fetch("/api/config/defaults", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ key: "session_ttl_hours", value: String(sessionTimeoutHours) }),
                      });
                    } catch {}
                    setSessionTimeoutSaving(false);
                  }}
                  disabled={sessionTimeoutSaving}
                  style={{ padding: "4px 12px", background: C.brand, color: C.bg, border: "none", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                >
                  {sessionTimeoutSaving ? "Saving..." : "Save"}
                </button>
              </Tooltip>
            </div>
            <div style={{ fontSize: 10, color: C.txT, marginTop: 4 }}>
              How long an operator stays logged in before needing to re-authenticate. Range: 1–720 hours (30 days). Takes effect on next login.
            </div>
          </div>
        </CollapsibleCard>
  );

  const mySessionsCard = (
        <CollapsibleCard title="MY SESSIONS" accent={C.purp} defaultOpen={false} focusKey="mySessions" focusedCard={focusCard}>
          <div style={{ fontSize: 11, color: C.txT, marginBottom: 10 }}>
            Active login sessions for your account. Revoke any session you don&apos;t recognize.
          </div>
          {mySessionsLoading && <div style={{ textAlign: "center", padding: 12, color: C.txT, fontSize: 12 }}>Loading...</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <button onClick={fetchMySessions} style={{ padding: "3px 10px", background: "transparent", border: `1px solid ${C.glassBorderSubtle}`, borderRadius: 4, color: C.txS, fontSize: 10, cursor: "pointer" }}>Refresh</button>
          </div>
          {mySessions.map(s => (
            <div key={s.id} style={{ padding: "10px 12px", background: s.isCurrent ? `${C.brand}08` : C.srf, border: `1px solid ${s.isCurrent ? `${C.brand}40` : C.glassBorderSubtle}`, borderRadius: 8, marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: C.tx, fontFamily: F.mono }}>{s.ipAddress || "unknown"}</span>
                    {s.isCurrent && <span style={{ fontSize: 9, fontWeight: 700, color: C.brand, background: `${C.brand}18`, padding: "1px 6px", borderRadius: 8 }}>CURRENT</span>}
                  </div>
                  <div style={{ fontSize: 10, color: C.txT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.userAgent ? s.userAgent.substring(0, 80) : "Unknown client"}
                  </div>
                  <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                    <span style={{ fontSize: 10, color: C.txS }}>Created: {timeAgo(s.createdAt)}</span>
                    <span style={{ fontSize: 10, color: C.txS }}>Last used: {s.lastUsedAt ? timeAgo(s.lastUsedAt) : "Never"}</span>
                  </div>
                </div>
                {!s.isCurrent && (
                  <Tooltip placement="left" variant="detail" content={<span>Sign this session out remotely. The next request from that browser/device gets bounced back to login. Useful when you spot a session you don&apos;t recognize, or when you forgot to log out on a shared machine.</span>}>
                    <button onClick={async () => {
                      try {
                        const res = await fetch("/api/auth/sessions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: s.id }) });
                        if (res.ok) fetchMySessions();
                      } catch {}
                    }} style={{ padding: "4px 10px", background: C.danger, color: "#fff", border: "none", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>Revoke</button>
                  </Tooltip>
                )}
              </div>
            </div>
          ))}
          {!mySessionsLoading && mySessions.length === 0 && (
            <div style={{ textAlign: "center", padding: 16, color: C.txT, fontSize: 12, fontStyle: "italic" }}>No active sessions found.</div>
          )}
        </CollapsibleCard>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* v0.12.0+: Mission Control return breadcrumb. */}
      <MissionControlBreadcrumb
        visible={!!incomingFromMissionControl}
        onClick={() => onMissionControlBackConsumed?.()}
      />

      {/* ── AI & MODELS ──────────────────────────────────────────────── */}
      <CategorySection title="AI & MODELS" accent={C.brand} storageKey="aiModels" focusCard={focusCard}
        focusKeys={["modelProviders", "voiceAvatar"]}>
        {defaultAiModelCard}
        {modelProvidersCard}
        <LocalModelCostsCard />
        <VoiceAvatarCard focusedCard={focusCard} />
      </CategorySection>

      {/* ── FLEET & ROUTING ──────────────────────────────────────────── */}
      <CategorySection title="FLEET & ROUTING" accent={C.cyan} storageKey="fleetRouting" focusCard={focusCard}
        focusKeys={["openclawRouting", "hermesRouting"]}>
        {fleetConnectorsCard}
        <OpenClawRoutingGuide focusedCard={focusCard} />
        <McpServerCard />
      </CategorySection>

      {/* ── SHIELD & DETECTION ───────────────────────────────────────── */}
      <CategorySection title="SHIELD & DETECTION" accent={C.info} storageKey="shieldDetection" focusCard={focusCard}
        focusKeys={["shieldSettings", "policiesAndRules"]}>
        <ProxySettingsCard focusedCard={focusCard} />
        <PoliciesAndRulesCard focusedCard={focusCard} />
        <CorrelationRulesCard />
        <ThreatScoreWeightsCard />
        <AgentIgnoreCard />
      </CategorySection>

      {/* ── ACCESS CONTROL (RBAC-gated content) ──────────────────────── */}
      <CategorySection title="ACCESS CONTROL" accent={C.purp} storageKey="accessControl" focusCard={focusCard}
        focusKeys={["operatorManagement", "authMethods", "authDevices", "mySessions", "apiKeys"]}>
        {rbacEnabled && rbacCurrentOperator?.role === "admin" && operatorManagementCard}
        {rbacEnabled && rbacCurrentOperator?.role === "admin" && <AuthMethodsCard focusedCard={focusCard} />}
        {rbacEnabled && rbacCurrentOperator && <AuthDevicesCard focusedCard={focusCard} />}
        {rbacEnabled && rbacCurrentOperator && mySessionsCard}
        <ApiKeysCard focusedCard={focusCard} />
      </CategorySection>

      {/* ── INTEGRATIONS ─────────────────────────────────────────────── */}
      <CategorySection title="INTEGRATIONS" accent={C.warn} storageKey="integrations" focusCard={focusCard}
        focusKeys={["mailConfig", "modules"]}>
        <MailConfigCard focusedCard={focusCard} />
        <ScheduledReportsCard />
        <ModuleTogglesCard focusedCard={focusCard} />
      </CategorySection>

      {/* ── SYSTEM ───────────────────────────────────────────────────── */}
      <CategorySection title="SYSTEM" accent={C.txT} storageKey="system" focusCard={focusCard}
        focusKeys={["updates", "uiPreferences", "developerTools"]}>
        {updatesCard}
        <DataRetentionCard />
        <UIPreferencesCard onNavigate={onNavigate} focusedCard={focusCard} />
        <HttpsCard focusedCard={focusCard} />
        <DeveloperToolsCard focusedCard={focusCard} />
        <SystemManagementCard />
      </CategorySection>

      {/* Themed confirmation dialog for destructive panel actions
       *  (provider remove, model remove). Replaces window.confirm(). */}
      <ConfirmDialog
        open={pendingConfirm !== null}
        title={pendingConfirm?.title ?? ""}
        body={pendingConfirm?.body ?? ""}
        confirmLabel={pendingConfirm?.confirmLabel ?? "Remove"}
        danger
        onConfirm={async () => {
          const action = pendingConfirm?.onConfirm;
          // Clear immediately so the dialog disappears even if the action
          // throws or hangs — operator stays in control.
          setPendingConfirm(null);
          if (action) await action();
        }}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}
