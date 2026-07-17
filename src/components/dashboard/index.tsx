"use client";

/**
 * ClawNex Dashboard — Main Orchestrator
 *
 * This is the root component that renders the entire dashboard layout:
 * status bar, context bar, sidebar navigation, main content area,
 * help drawer, AI chat panel, and floating avatar.
 *
 * State management: 16+ useState hooks manage global dashboard state.
 * Panels receive state via explicit props (no React Context).
 * Polling intervals: health (30s), infra (60s), fleet (30s), badges (15s).
 *
 * @module dashboard/index
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSetupComplete } from "./useSetupComplete";

// Foundation
import type { TabId, DashboardFilters, HealthData, InfraData, FleetInstance, NavItem } from "./types";
import { useHashState, pushHashState, type NavigateOpts, type UrlState } from "./url-state";
import { C, F, G, NAV, PANEL_HELP, setPerfMode, setTheme, applyHighContrast } from "./constants";
import { getTimeSince, sevColor } from "./utils";
import { INST } from "./mock-data";
import { Dot, CountBadge, Fresh, EmptyState, Badge } from "./shared";
import { BrandWordmark } from "./BrandWordmark";
import { Tooltip, TooltipsProvider, useTooltipsEnabled } from "./tooltip";
import { CLAWNEX_VERSION_SHORT, CLAWNEX_CHANNEL } from "@/lib/version";
import { UpdateBadge } from "./UpdateBadge";
import { GlobalFilterSelect, type GlobalFilterOption } from "./GlobalFilterSelect";

// Panels
import { FleetCommandPanel } from "./panels/FleetCommandPanel";
import { InstanceDetailPanel } from "./panels/InstanceDetailPanel";
import { CorrelationsPanel } from "./panels/CorrelationsPanel";
import { BlastRadiusPanel } from "./panels/BlastRadiusPanel";
import { SecurityPosturePanel } from "./panels/SecurityPosturePanel";
import { TrustAuditPanel } from "./panels/TrustAuditPanel";
import { PromptShieldPanel } from "./panels/PromptShieldPanel";
import { ShieldTestsPanel } from "./panels/ShieldTestsPanel";
import { AccessControlPanel } from "./panels/AccessControlPanel";
import { AgentsSessionsPanel } from "./panels/AgentsSessionsPanel";
import { AgentWorkspacePanel } from "./panels/AgentWorkspacePanel";
import { TokenCostPanel } from "./panels/TokenCostPanel";
import { ToolsAccessPanel } from "./panels/ToolsAccessPanel";
import { ModelsCostPanel } from "./panels/ModelsCostPanel";
import { InfrastructurePanel } from "./panels/InfrastructurePanel";
import { AlertsIncidentsPanel } from "./panels/AlertsIncidentsPanel";
import { MissionControlPanel } from "./panels/MissionControlPanel";
import type { TimeRange as MCTimeRange } from "./panels/mission-control/types";
import { AuditEvidencePanel } from "./panels/AuditEvidencePanel";
import { ExecutiveReportsPanel } from "./panels/ExecutiveReportsPanel";
import { AccessListsPanel } from "./panels/AccessListsPanel";
import { GovernancePanel } from "./panels/GovernancePanel";
import { RiskAcceptancePanel } from "./panels/RiskAcceptancePanel";
import { TrafficMonitorPanel } from "./panels/TrafficMonitorPanel";
import { ConfigurationPanel, BreakGlassBanner } from "./panels/ConfigurationPanel";
import { HelpPanel } from "./panels/HelpPanel";
import { AboutPanel } from "./panels/AboutPanel";
import { FloatingAvatar } from "./panels/FloatingAvatar";
import { ChatPanel } from "./panels/ChatPanel";
import { DemoGuide } from "./panels/DemoGuide";

const FONT_SIZE_MIN = -1;
const FONT_SIZE_MAX = 3;
const FONT_SIZE_DEFAULT = 1;
const SIDEBAR_WIDTH_AT_DEFAULT_TEXT = 184;
const SIDEBAR_WIDTH_PER_TEXT_STEP = 6;
const FONT_SIZE_CLASSES = [
  "clawnex-font-size-minus-1",
  "clawnex-font-size-0",
  "clawnex-font-size-1",
  "clawnex-font-size-2",
  "clawnex-font-size-3",
];

function clampFontSizeStep(value: number): number {
  return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(value)));
}

function applyFontSizeStep(value: number): void {
  const step = clampFontSizeStep(value);
  document.documentElement.classList.remove(...FONT_SIZE_CLASSES);
  document.documentElement.classList.add(step < 0 ? "clawnex-font-size-minus-1" : `clawnex-font-size-${step}`);
}

const FAVORITE_TABS_KEY_PREFIX = "clawnex_favorite_tabs";
const RECENT_TABS_KEY_PREFIX = "clawnex_recent_tabs";
const MAX_FAVORITE_TABS = 5;
const MAX_RECENT_TABS = 3;
const ROLE_HIDDEN_TABS: Record<string, TabId[]> = {
  viewer: ["shield", "shieldTests", "trafficMonitor", "accessControl", "accessLists", "workspace", "auditEvidence", "executiveReports", "configuration"],
  auditor: ["instance", "correlations", "securityPosture", "shield", "shieldTests", "trafficMonitor", "accessControl", "accessLists", "agents", "workspace", "toolsAccess", "modelsCost", "infrastructure", "alertsIncidents", "configuration"],
};

function FavoriteStarButton({
  label,
  favorite,
  onToggle,
  placement = "right",
  size = 24,
}: {
  label: string;
  favorite: boolean;
  onToggle: () => void;
  placement?: "top" | "right" | "bottom" | "left";
  size?: number;
}) {
  const actionLabel = favorite
    ? `Remove ${label} from Favorites`
    : `Add ${label} to Favorites`;

  return (
    <Tooltip placement={placement} variant="compact" content={actionLabel}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={actionLabel}
        aria-pressed={favorite}
        style={{
          width: size,
          height: size,
          minWidth: size,
          display: "grid",
          placeItems: "center",
          padding: 0,
          border: "1px solid transparent",
          borderRadius: 4,
          background: favorite ? `${C.warn}14` : "transparent",
          color: favorite ? C.warn : C.txG,
          cursor: "pointer",
          fontSize: size >= 28 ? 17 : 13,
          lineHeight: 1,
        }}
      >
        <span aria-hidden="true">{favorite ? "\u2605" : "\u2606"}</span>
      </button>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Global Tooltip Toggle Button — lives in the dashboard header, next to the
// help (?) and Tour buttons. Always visible. Click to flip tooltips on/off
// globally; the flag is persisted to config_defaults.tooltips_enabled.
// ---------------------------------------------------------------------------

function TipsToggleButton() {
  const { enabled, setEnabled, loaded } = useTooltipsEnabled();
  const label = enabled ? "ON" : "OFF";
  return (
    <Tooltip
      placement="bottom"
      variant="compact"
      content={
        <span>
          Toggle contextual tooltips throughout the dashboard. Currently <strong style={{ color: enabled ? C.brand : C.txT }}>{label}</strong>. Click to turn them {enabled ? "off" : "on"}.
        </span>
      }
    >
      <button
        onClick={() => setEnabled(!enabled)}
        disabled={!loaded}
        aria-label={`Tooltips currently ${label}, click to toggle`}
        aria-pressed={enabled}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "3px 9px",
          borderRadius: 12,
          fontSize: 10,
          fontWeight: 700,
          fontFamily: F.mono,
          letterSpacing: "0.04em",
          background: enabled ? `${C.brand}18` : "transparent",
          border: `1px solid ${enabled ? C.brand : C.brd}`,
          color: enabled ? C.brand : C.txT,
          cursor: loaded ? "pointer" : "wait",
          opacity: loaded ? 1 : 0.5,
          transition: "background 200ms ease, border-color 200ms ease, color 200ms ease",
        }}
      >
        <span style={{ fontSize: 11, lineHeight: 1 }}>{"\u2139"}</span>
        <span>TIPS</span>
      </button>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard Component
// ---------------------------------------------------------------------------

function SentinelDashboardInner() {
  // --- Global state ---
  // v0.8.2+: tab + filter + deep-link state lives in window.location.hash so
  // refresh, back-button, and share-via-paste all work.
  const [urlState] = useHashState();
  const activeTab: TabId = (urlState.tab as TabId | undefined) ?? "missionControl";
  // Ref to the main content scroll container — reset scrollTop on tab
  // change below so panels always open at the top, not inheriting the
  // previous panel's scroll offset.
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (contentScrollRef.current) contentScrollRef.current.scrollTop = 0;
  }, [activeTab]);
  const setActiveTab = useCallback((tab: TabId) => {
    // Sidebar nav: clear filter params (sidebar click = deliberate reset).
    pushHashState({ tab }, { clearOthers: true });
  }, []);
  const [configFocus, setConfigFocus] = useState<string | null>(null);
  // Audit & Evidence row focus. Set by `navigate("auditEvidence", { id })`
  // when an operator clicks "View Evidence" on an alert (or any future
  // backlink to an exact audit row). The AuditEvidencePanel reads this via
  // its `focusedAuditId` prop, opens the row's detail, scrolls it into view,
  // and calls `onConsumed` so we reset to null — preventing stale focus on
  // the next visit. The cache-busting `#${Date.now()}` suffix used by
  // configFocus is unnecessary here because the panel keys its effect on
  // the id itself + clears via the consumer callback.
  const [auditFocus, setAuditFocus] = useState<string | null>(null);
  // v0.11.3+: "Back to Incident" breadcrumb support. When the operator clicks
  // "View Evidence" on an alert, the AlertsIncidentsPanel passes
  // `fromAlert: alert.id` in the navigate opts. We capture that into
  // `incomingFromAlert` so the AuditEvidencePanel can render a breadcrumb that
  // navigates back to Alerts & Incidents pre-focused on the originating alert
  // (highlighting / scrolling / expanding via `alertFocus`).
  const [incomingFromAlert, setIncomingFromAlert] = useState<string | null>(null);
  // Drives the "scroll into view + pulse + expand" effect on
  // AlertsIncidentsPanel when the operator returns from EVD detail. The
  // AlertsIncidentsPanel already has a URL-driven `highlight` mechanism, but
  // this lives in component state because the back-from-EVD path is an
  // imperative jump — not a URL navigation that should be persisted.
  const [alertFocus, setAlertFocus] = useState<string | null>(null);
  // v0.12.0+: Mission Control return path. Set by navigate(<tab>, { fromMissionControl: true }).
  // Destination panels read incomingFromMissionControl and render the breadcrumb;
  // when the operator clicks it, the destination calls
  // onMissionControlBackConsumed which navigates back to "missionControl".
  const [incomingFromMissionControl, setIncomingFromMissionControl] = useState<boolean>(false);
  // Navigate to a tab. Optional opts can pre-apply filters (carried by deep-
  // links from one panel to another) and request a row highlight pulse on
  // arrival.
  const navigate = useCallback((tab: TabId, focusOrOpts?: NavigateOpts) => {
    if (typeof focusOrOpts === "string" || typeof focusOrOpts === "undefined") {
      // Back-compat path: callers passing a focus string only.
      pushHashState({ tab }, { clearOthers: true });
      const focus = focusOrOpts;
      if (focus !== undefined) {
        setConfigFocus(focus ? `${focus}#${Date.now()}` : null);
      }
      return;
    }
    // Opts path: cross-panel deep-link with filters / id / highlight.
    const patch: Partial<UrlState> = { tab, ...(focusOrOpts.filter ?? {}) };
    if (focusOrOpts.id) patch.id = focusOrOpts.id;
    if (focusOrOpts.highlight) patch.highlight = focusOrOpts.highlight;
    pushHashState(patch, { clearOthers: true });
    if (focusOrOpts.focus !== undefined) {
      setConfigFocus(focusOrOpts.focus ? `${focusOrOpts.focus}#${Date.now()}` : null);
    }
    // Audit & Evidence row-deep-link: when navigating to that tab with an
    // explicit id, ask the panel to open that exact row. Mirrors the
    // configFocus contract but lives in a separate state slot because it
    // targets a different panel + has a different consumption pattern
    // (panel-driven onConsumed reset vs. timestamp-suffix re-trigger).
    if (tab === "auditEvidence" && focusOrOpts.id) {
      setAuditFocus(focusOrOpts.id);
      // v0.11.3+: forward the originating alert id so EVD detail can render a
      // "Back to Incident" breadcrumb. Cleared when the operator either uses
      // the breadcrumb or dismisses the focus.
      if (focusOrOpts.fromAlert) {
        setIncomingFromAlert(focusOrOpts.fromAlert);
      } else {
        // Direct landing on EVD without a backlink: clear any stale value so
        // a previous alert origin doesn't bleed into this visit.
        setIncomingFromAlert(null);
      }
    }
    // v0.11.3+: "Back to Incident" path — AuditEvidencePanel calls this with
    // `focusAlertId` to ask the AlertsIncidentsPanel to scroll/expand/highlight
    // the originating alert.
    if (tab === "alertsIncidents" && focusOrOpts.focusAlertId) {
      setAlertFocus(focusOrOpts.focusAlertId);
      // Outbound from EVD → consume the breadcrumb state so a future
      // EVD landing without a backlink doesn't show a stale breadcrumb.
      setIncomingFromAlert(null);
    }
    // v0.12.0+: Mission Control drill-down. Set the return breadcrumb state so
    // destination panels can render "← Back to Mission Control".
    if (focusOrOpts.fromMissionControl) {
      setIncomingFromMissionControl(true);
    } else if (tab !== "missionControl") {
      // If navigating to any destination tab WITHOUT fromMissionControl (i.e.
      // a direct sidebar click), clear the breadcrumb so it doesn't bleed
      // into the new panel. Mirrors the v0.11.3 incomingFromAlert clearing
      // pattern. The missionControl tab itself is excluded — navigating back
      // to the cockpit preserves the flag so re-entering a destination still
      // sees it (though typically onMissionControlBackConsumed clears it first).
      setIncomingFromMissionControl(false);
    }
  }, []);
  // v0.12.0+: clears the Mission Control breadcrumb state and returns to the
  // missionControl tab. Passed to destination panels so they can wire the
  // MissionControlBreadcrumb's onClick without knowing about navigate().
  const onMissionControlBackConsumed = useCallback(() => {
    setIncomingFromMissionControl(false);
    navigate("missionControl");
  }, [navigate]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [infra, setInfra] = useState<InfraData | null>(null);
  const [fleet, setFleet] = useState<FleetInstance[] | null>(null);
  const [clock, setClock] = useState("");
  // alertCount = open + CRITICAL severity (the header pill's specific scope).
  // The sidebar Alerts & Incidents red badge was retired 2026-05-07 per operator
  // ("we do not need it any more") — its `activeAlertCount` state + the
  // `/api/alerts?scope=active` fetch were removed alongside the badge render.
  const [alertCount, setAlertCount] = useState(0);
  const [shieldBlocked, setShieldBlocked] = useState(0);
  // Shield posture must drive the header label, not just the count, because
  // a raw "N SHIELD BLOCKS" reads as a lie in OBSERVE mode where rows are
  // flagged-and-allowed, not blocked. The pill + count are read together:
  //   block   → "BLOCKING" + "N BLOCKED"
  //   observe → "OBSERVE"  + "N WOULD-BLOCK"
  // Source of truth: GET /api/proxy/block-mode. blockMode==='on' → block;
  // anything else (including unset on a fresh install) → observe.
  const [shieldMode, setShieldMode] = useState<'block' | 'observe'>('observe');
  // Wire status of the OpenClaw → LiteLLM bridge (header chip).
  // 'wired'    = sidecar present AND litellm provider routed (Prompt Shield in path).
  // 'manual'   = litellm provider exists but no ClawNex sidecar (operator wired it manually).
  // 'bypassed' = openclaw.json found, no litellm provider entry. Shield is NOT in path on a fresh install.
  // 'unknown'  = openclaw.json not found yet (fresh install pre-wizard) — chip hidden.
  // Source: GET /api/openclaw/routing (low rate; refreshed alongside other badges).
  const [wireBadge, setWireBadge] = useState<'wired' | 'manual' | 'bypassed' | 'unknown'>('unknown');
  // v0.9.3+ Developer Tools header ribbon. When active simulation
  // runs exist on the fleet (seeded by Configuration -> Developer
  // Tools or via the CLI fixture), surface an amber strip below the
  // header so an operator who seeded and forgot can't quietly leave
  // simulation data in place. Polled on the same tick as the other
  // badges. activeSimRunCount=0 hides the ribbon entirely.
  //
  // internal reviewer follow-up 2026-04-29: when any Mode B run is active (rows
  // tagged origin='production' so default counters light up), the
  // ribbon escalates to a stronger danger-tinted treatment so operators
  // know their counters are reflecting synthetic data. Mode A only =
  // amber; any Mode B = danger-red.
  const [activeSimRunCount, setActiveSimRunCount] = useState<number>(0);
  const [activeModeBRunCount, setActiveModeBRunCount] = useState<number>(0);
  // Policy framework v1 — header ribbon for disabled vendor (curated/system)
  // policies. Task 21 added a typed-phrase confirmation flow for disabling
  // vendor-shipped policies (ClawNex Default = inbound, Generic Egress
  // Starter = outbound). When an operator disables one, this ribbon makes
  // the resulting protection gap impossible to miss from the header. Polled
  // alongside the other badges (no separate setInterval). Click jumps to
  // Configuration → Policies & Rules card via the focusKey contract used by
  // the dev-tools ribbon. Spec §3.8.
  const [disabledVendorPolicies, setDisabledVendorPolicies] = useState<string[]>([]);
  const [demoMode, setDemoMode] = useState(false);
  // operator 2026-05-07: empty Mission Control on a fresh install reads as "all
  // clear" (every tile is 0). Sidebar surfaces a tiny warn dot next to the
  // Mission Control nav item until the operator dismisses the wizard, so the
  // empty cockpit isn't mistaken for a green one. Hook short-circuits to
  // "complete" in demo mode so demos don't show the indicator.
  const setupComplete = useSetupComplete(demoMode);
  // v0.7.3: AI chat panel closed by default per direct user feedback. Operators
  // who want it open can set ai_panel_default="open" in config_defaults, or
  // toggle it via the AI button in the header (preference is per-session, not
  // persisted unless the operator changes the default setting).
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDefaultLoaded, setChatDefaultLoaded] = useState(false);
  const [performanceMode, setPerformanceMode] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tourMode, setTourMode] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [floatingAvatarVisible, setFloatingAvatarVisible] = useState(false);
  const sharedHeygenRef = useRef<{ session: unknown } | null>(null);
  const [sharedHeygenConnected, setSharedHeygenConnected] = useState(false);
  const [demoPayload, setDemoPayload] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState("24h");
  const [selectedInstance, setSelectedInstance] = useState("all");
  const [selectedClient, setSelectedClient] = useState("all");
  const [selectedSeverity, setSelectedSeverity] = useState("all");
  const [enabledModules, setEnabledModules] = useState<Record<string, boolean>>({});
  const [theme, setThemeState] = useState<"dark" | "light">("dark");
  const [highContrast, setHighContrastState] = useState(false);
  const [fontSizeStep, setFontSizeStep] = useState(FONT_SIZE_DEFAULT);
  const [mounted, setMounted] = useState(false);
  const themeStyleRef = useRef<HTMLStyleElement | null>(null);

  // RBAC operator identity
  const [operator, setOperator] = useState<{ username: string; role: string; displayName?: string } | null>(null);
  const [navigationStorageScope, setNavigationStorageScope] = useState<string | null>(null);

  // Apply saved theme + high contrast after mount (client-only) to avoid hydration mismatch
  useEffect(() => {
    try {
      const saved = localStorage.getItem("clawnex_theme");
      if (saved === "light") { setTheme("light"); setThemeState("light"); }
      const hc = localStorage.getItem("clawnex_high_contrast");
      if (hc === "1") { applyHighContrast(true); setHighContrastState(true); }
      const storedFontSize = Number(localStorage.getItem("clawnex_font_size_step"));
      const nextFontSize = Number.isFinite(storedFontSize) && localStorage.getItem("clawnex_font_size_step") !== null
        ? clampFontSizeStep(storedFontSize)
        : FONT_SIZE_DEFAULT;
      applyFontSizeStep(nextFontSize);
      setFontSizeStep(nextFontSize);
    } catch {}
    // Also check config_defaults for server-persisted value
    (async () => {
      try {
        const res = await fetch("/api/config/defaults");
        if (res.ok) {
          const data = await res.json();
          const flag = data?.settings?.high_contrast_enabled;
          if (flag === "1" || flag === "true") {
            applyHighContrast(true);
            setHighContrastState(true);
          }
        }
      } catch {}
    })();
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
    window.requestAnimationFrame(() => window.scrollTo(0, 0));
    setMounted(true);
  }, []);

  // Fetch RBAC operator identity on mount + CSRF token
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          const storageIdentity = String(data.id || data.username || "local").trim();
          setNavigationStorageScope(storageIdentity || "local");
          // /api/auth/me returns operator fields at top level when RBAC is enabled
          // When RBAC is disabled, id will be 'system' — skip display in that case
          if (data.username && data.id !== 'system') {
            setOperator({ username: data.username, role: data.role, displayName: data.displayName || undefined });
          }
        } else {
          setNavigationStorageScope("local");
        }
      } catch {
        setNavigationStorageScope("local");
      }
      // Also fetch CSRF token for mutation requests
      try { await fetch('/api/auth/csrf'); } catch {}
    })();
  }, []);

  // Auto-inject CSRF header on mutation fetch calls when RBAC is active
  useEffect(() => {
    if (!operator) return; // Only when RBAC is active

    const originalFetch = window.fetch;
    window.fetch = function(input: RequestInfo | URL, init?: RequestInit) {
      const method = init?.method?.toUpperCase() || 'GET';
      if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        const csrfToken = document.cookie.match(/clawnex_csrf=([^;]+)/)?.[1] || '';
        if (csrfToken) {
          const headers = new Headers(init?.headers);
          if (!headers.has('x-csrf-token')) {
            headers.set('x-csrf-token', csrfToken);
          }
          init = { ...init, headers };
        }
      }
      return originalFetch.call(window, input, init);
    };

    return () => { window.fetch = originalFetch; };
  }, [operator]);

  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    window.location.href = '/login';
  }, []);

  // Session expiry detection — periodically check if session is still valid
  // Redirects to /login if the session has expired mid-use
  useEffect(() => {
    if (!operator) return; // Only check when RBAC is active and operator is set
    const checkSession = async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.status === 401) {
          window.location.href = '/login?expired=1';
        }
      } catch {}
    };
    const iv = setInterval(checkSession, 60000); // Check every 60 seconds
    return () => clearInterval(iv);
  }, [operator]);

  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeState(next);
    try { localStorage.setItem("clawnex_theme", next); } catch {}
    // Update scrollbar CSS for new theme
    if (themeStyleRef.current) {
      themeStyleRef.current.textContent = `
        * { scrollbar-width: thin; scrollbar-color: ${C.brd} transparent; }
        *::-webkit-scrollbar { width: 6px; height: 6px; }
        *::-webkit-scrollbar-track { background: transparent; }
        *::-webkit-scrollbar-thumb { background: ${C.brd}; border-radius: 3px; }
        *::-webkit-scrollbar-thumb:hover { background: ${C.brdS}; }
      `;
    }
  }, [theme]);

  const adjustFontSize = useCallback((delta: number) => {
    setFontSizeStep((current) => {
      const next = clampFontSizeStep(current + delta);
      applyFontSizeStep(next);
      try { localStorage.setItem("clawnex_font_size_step", String(next)); } catch {}
      return next;
    });
  }, []);

  // --- Derived state ---
  const since = useMemo(() => getTimeSince(timeRange), [timeRange]);

  const dashboardFilters: DashboardFilters = useMemo(() => ({
    timeRange, since, selectedInstance, selectedClient, selectedSeverity, productionOnly: urlState.productionOnly,
  }), [timeRange, since, selectedInstance, selectedClient, selectedSeverity, urlState.productionOnly]);

  const sidebarExpandedWidth =
    SIDEBAR_WIDTH_AT_DEFAULT_TEXT + (fontSizeStep * SIDEBAR_WIDTH_PER_TEXT_STEP);

  // --- Gateway instances for instance dropdown ---
  const [gatewayInstances, setGatewayInstances] = useState<Array<{ id: string; name: string; status: string; clientName: string }>>([]);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/config/gateways");
        if (res.ok) {
          const data = await res.json();
          setGatewayInstances((data.gateways || []).map((g: { id: string; name: string; status?: string; client_name?: string }) => ({
            id: g.id, name: g.name, status: g.status || "unknown", clientName: g.client_name || "",
          })));
        }
      } catch { /* silent */ }
    })();
  }, []);

  // --- Fetch enabled modules for sidebar filtering ---
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/config/modules");
        if (res.ok) {
          const data = await res.json();
          const modules = data.modules || {};
          const map: Record<string, boolean> = {};
          for (const [id, info] of Object.entries(modules)) {
            map[id] = (info as { enabled: boolean }).enabled;
          }
          setEnabledModules(map);
        }
      } catch { /* silent */ }
    })();
  }, []);

  const uniqueClients = useMemo(() => {
    const set = new Set<string>();
    if (demoMode) INST.forEach(f => set.add(f.client));
    if (fleet) fleet.forEach(f => set.add(f.client));
    gatewayInstances.forEach(g => { if (g.clientName) set.add(g.clientName); });
    return Array.from(set).sort();
  }, [demoMode, fleet, gatewayInstances]);

  const instanceFilterOptions = useMemo<GlobalFilterOption[]>(() => {
    const options = new Map<string, string>();
    if (fleet) {
      fleet.forEach((instance) => options.set(
        instance.id,
        `${instance.status === "healthy" ? "●" : "○"} ${instance.id} — ${instance.client}`,
      ));
    }
    if (demoMode) {
      INST.forEach((instance) => {
        if (!options.has(instance.id)) {
          options.set(
            instance.id,
            `${instance.status === "healthy" ? "●" : "○"} ${instance.id} — ${instance.client} (demo)`,
          );
        }
      });
    }
    return [
      { value: "all", label: "All Instances" },
      ...Array.from(options, ([value, label]) => ({ value, label })),
    ];
  }, [demoMode, fleet]);

  const clientFilterOptions = useMemo<GlobalFilterOption[]>(() => [
    { value: "all", label: "All Clients" },
    ...uniqueClients.map((client) => ({ value: client, label: client })),
  ], [uniqueClients]);

  const severityFilterOptions = useMemo<GlobalFilterOption[]>(() => [
    { value: "all", label: "All Severity" },
    { value: "CRITICAL", label: "CRITICAL" },
    { value: "HIGH", label: "HIGH" },
    { value: "MEDIUM", label: "MEDIUM" },
    { value: "LOW", label: "LOW" },
  ], []);

  // --- Data fetching ---
  const fetchHealth = useCallback(async () => {
    try { const res = await fetch("/api/health"); if (res.ok) setHealth(await res.json()); } catch {}
  }, []);

  const fetchInfra = useCallback(async () => {
    try { const res = await fetch("/api/infrastructure"); if (res.ok) setInfra(await res.json()); } catch {}
  }, []);

  const [threatTrend, setThreatTrend] = useState<number[]>([]);
  const fetchFleet = useCallback(async () => {
    try { const res = await fetch(`/api/fleet?since=${encodeURIComponent(since)}`); if (res.ok) { const data = await res.json(); setFleet(data.instances || []); if (data.threatTrend) setThreatTrend(data.threatTrend); } } catch {}
  }, [since]);

  const fetchBadges = useCallback(async () => {
    try {
      // Header pill: open + CRITICAL only. Sidebar Alerts badge: active scope
      // (open+ack+investigating) all severities. Two distinct queries because
      // the two surfaces answer two different operator questions ("anything
      // critical right now" vs "anything I need to handle").
      //
      // internal reviewer M-01 follow-up 2026-04-30: both queries pass productionOnly=true
      // so test-generated origins (shield-test/demo/qa/simulation Mode A)
      // are filtered out. Mode B simulation rows tag origin='production' and
      // ARE counted by design — that's the visible-in-default-counters
      // contract operators opt into via the second-gate phrase. Closes the
      // asymmetry where Fleet per-instance alerts filtered by origin but
      // header CRITICAL didn't, leaving Shield Tests run-all output
      // polluting the header pill on long-running fleets.
      const [aRes, sRes, rRes, dRes, mRes, pRes] = await Promise.allSettled([
        fetch(`/api/alerts?status=open&severity=CRITICAL&productionOnly=true&limit=100&since=${encodeURIComponent(since)}`),
        fetch(`/api/shield/stats?since=${since}`),
        fetch(`/api/openclaw/routing`),
        // /api/dev/status returns 404 when env-disabled (banking-prod
        // installs); the catch path keeps activeSimRunCount=0, ribbon
        // stays hidden, no information leak about the feature existing.
        fetch(`/api/dev/status`),
        fetch(`/api/proxy/block-mode`),
        // Policy framework v1: disabled vendor (curated/system) policies
        // drive the header ribbon below the dev-tools strip. Same poll
        // tick — no separate interval. Failure path leaves the previous
        // value alone (don't flicker the ribbon away on a transient
        // network glitch).
        fetch(`/api/policies`),
      ]);
      if (aRes.status === "fulfilled" && aRes.value.ok) { const d = await aRes.value.json(); setAlertCount(d.total ?? d.alerts?.length ?? 0); }
      if (sRes.status === "fulfilled" && sRes.value.ok) { const d = await sRes.value.json(); setShieldBlocked(d.blocked ?? 0); }
      if (mRes.status === "fulfilled" && mRes.value.ok) { const d = await mRes.value.json(); setShieldMode(d.blockMode === "on" ? "block" : "observe"); }
      // Wire-status header chip — same /api/openclaw/routing GET the
      // Configuration card uses, dropped into the badge fetch so the
      // header reflects current state on every refresh tick. Mapping
      // matches the card's wireState classifier:
      //   sidecar + provider present  -> wired
      //   provider present, no sidecar -> manual
      //   no provider, openclaw.json found -> bypassed (alarm state)
      //   openclaw.json missing -> unknown (chip hidden)
      if (rRes.status === "fulfilled" && rRes.value.ok) {
        const d = await rRes.value.json();
        if (!d.found) {
          setWireBadge('unknown');
        } else {
          const litellm = (d.providers || []).find((p: { id: string }) => p.id === 'litellm');
          const sidecar = d.managed?.sidecar;
          if (sidecar && litellm) setWireBadge('wired');
          else if (!sidecar && litellm) setWireBadge('manual');
          else setWireBadge('bypassed');
        }
      }
      // Developer Tools active-runs ribbon. /api/dev/status returns 404
      // (env kill-switch) on customer-prod installs -- the catch keeps
      // count at 0 and the ribbon stays hidden.
      if (dRes.status === "fulfilled" && dRes.value.ok) {
        const d = await dRes.value.json();
        setActiveSimRunCount(d.activeRunCount || 0);
        setActiveModeBRunCount(d.modeBRunCount || 0);
      } else {
        setActiveSimRunCount(0);
        setActiveModeBRunCount(0);
      }
      // Disabled vendor policies → header ribbon (Spec §3.8). Vendor =
      // curated (ClawNex Default, the operator-visible AUDIT MIRROR of
      // ALL_RULES — wire-inert in v1; the built-in Shield detections
      // still run from source even when this is OFF) OR system (Generic
      // Egress Starter, the wire-active outbound starter — disabling
      // this DOES strip outbound starter DLP/policy detection). The
      // ribbon ensures the operator who typed the disable phrase can't
      // quietly forget; the copy below distinguishes the runtime
      // semantics so we don't overstate what disabling ClawNex Default
      // costs.
      if (pRes.status === "fulfilled" && pRes.value.ok) {
        const d = await pRes.value.json();
        const names: string[] = (d.policies ?? [])
          .filter((p: { enabled: boolean; source: string }) => p.enabled === false && (p.source === "curated" || p.source === "system"))
          .map((p: { name: string }) => p.name);
        setDisabledVendorPolicies(names);
      }
    } catch {}
  }, [since]);

  // --- Initialization + polling ---
  useEffect(() => {
    // Inject CSS animations
    if (typeof document !== "undefined") {
      const style = document.createElement("style");
      style.textContent = `
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes pulseGlow { 0%, 100% { box-shadow: 0 0 4px currentColor; opacity: 1; } 50% { box-shadow: 0 0 12px currentColor; opacity: 0.6; } }
        @keyframes pulseDot { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.4); opacity: 0.4; } }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .glass-inputs select, .glass-inputs input[type="text"], .glass-inputs textarea { backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
      `;
      document.head.appendChild(style);

      // Scrollbar styles in a separate element so theme toggle can update them
      const scrollStyle = document.createElement("style");
      scrollStyle.textContent = `
        * { scrollbar-width: thin; scrollbar-color: ${C.brd} transparent; }
        *::-webkit-scrollbar { width: 6px; height: 6px; }
        *::-webkit-scrollbar-track { background: transparent; }
        *::-webkit-scrollbar-thumb { background: ${C.brd}; border-radius: 3px; }
        *::-webkit-scrollbar-thumb:hover { background: ${C.brdS}; }
      `;
      document.head.appendChild(scrollStyle);
      themeStyleRef.current = scrollStyle;
    }

    // Theme is loaded synchronously in useState initializer — no flash

    // Load AI panel preference. v0.7.3: default is closed; an operator
    // can opt-in to "open" via ai_panel_default in config_defaults. Older
    // explicit "closed" values continue to be honored as a no-op.
    if (!chatDefaultLoaded) {
      fetch("/api/config/defaults").then(r => r.ok ? r.json() : null).then(d => {
        if (d?.settings?.ai_panel_default === "open") setChatOpen(true);
        setChatDefaultLoaded(true);
      }).catch(() => setChatDefaultLoaded(true));
    }

    fetchHealth(); fetchInfra(); fetchFleet(); fetchBadges();
    const h = setInterval(fetchHealth, 30000);
    const i = setInterval(fetchInfra, 60000);
    const f = setInterval(fetchFleet, 30000);
    const b = setInterval(fetchBadges, 15000);
    setClock(new Date().toLocaleTimeString("en-US", { hour12: false, timeZone: "UTC" }));
    const c = setInterval(() => setClock(new Date().toLocaleTimeString("en-US", { hour12: false, timeZone: "UTC" })), 1000);
    return () => { clearInterval(h); clearInterval(i); clearInterval(f); clearInterval(b); clearInterval(c); };
  }, [fetchHealth, fetchInfra, fetchFleet, fetchBadges]);

  // --- Navigation ---
  const groups = useMemo(() => {
    const map = new Map<string, NavItem[]>();
    NAV.forEach(item => { if (!map.has(item.group)) map.set(item.group, []); map.get(item.group)!.push(item); });
    return map;
  }, []);
  const visibleNavItems = useMemo(() => {
    const hiddenForRole = operator ? (ROLE_HIDDEN_TABS[operator.role] || []) : [];
    return NAV.filter(item => enabledModules[item.id] !== false && !hiddenForRole.includes(item.id));
  }, [enabledModules, operator]);
  const visibleTabIds = useMemo(() => new Set(visibleNavItems.map(item => item.id)), [visibleNavItems]);
  const favoriteStorageKey = navigationStorageScope
    ? `${FAVORITE_TABS_KEY_PREFIX}:${encodeURIComponent(navigationStorageScope)}`
    : null;
  const recentStorageKey = navigationStorageScope
    ? `${RECENT_TABS_KEY_PREFIX}:${encodeURIComponent(navigationStorageScope)}`
    : null;

  const [favoriteTabs, setFavoriteTabs] = useState<TabId[]>([]);
  const [favoritesReady, setFavoritesReady] = useState(false);
  const [favoriteMessage, setFavoriteMessage] = useState("");

  useEffect(() => {
    if (!favoriteStorageKey) return;

    setFavoritesReady(false);
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(favoriteStorageKey) || "[]");
      const stored = Array.isArray(parsed) ? parsed : [];
      const uniqueTabs = stored
        .filter((tab): tab is TabId => typeof tab === "string" && NAV.some(item => item.id === tab))
        .filter((tab, index, tabs) => tabs.indexOf(tab) === index);
      const next = uniqueTabs.slice(0, MAX_FAVORITE_TABS);
      setFavoriteTabs(next);
      setFavoriteMessage(
        uniqueTabs.length > MAX_FAVORITE_TABS
          ? `Only the first ${MAX_FAVORITE_TABS} saved favorites were loaded.`
          : "",
      );
    } catch {
      setFavoriteTabs([]);
      setFavoriteMessage("Favorites could not be loaded in this browser.");
    }
    setFavoritesReady(true);
  }, [favoriteStorageKey]);

  const saveFavoriteTabs = useCallback((tabs: TabId[]) => {
    if (!favoriteStorageKey) return false;
    try {
      localStorage.setItem(favoriteStorageKey, JSON.stringify(tabs));
      return true;
    } catch {
      return false;
    }
  }, [favoriteStorageKey]);

  const toggleFavorite = useCallback((tab: TabId) => {
    if (!favoritesReady || !visibleTabIds.has(tab)) return;
    const item = NAV.find(candidate => candidate.id === tab);
    if (!item) return;

    if (favoriteTabs.includes(tab)) {
      const next = favoriteTabs.filter(candidate => candidate !== tab);
      setFavoriteTabs(next);
      setFavoriteMessage(saveFavoriteTabs(next) ? "" : "Favorites could not be saved in this browser.");
      return;
    }

    if (favoriteTabs.length >= MAX_FAVORITE_TABS) {
      setFavoriteMessage(`Favorites are full (${MAX_FAVORITE_TABS}/${MAX_FAVORITE_TABS}). Unpin one before adding ${item.label}.`);
      return;
    }

    const next = [...favoriteTabs, tab];
    setFavoriteTabs(next);
    setFavoriteMessage(saveFavoriteTabs(next) ? "" : "Favorites could not be saved in this browser.");
  }, [favoriteTabs, favoritesReady, saveFavoriteTabs, visibleTabIds]);

  const visibleFavoriteItems = useMemo(
    () => favoriteTabs
      .map(tab => visibleNavItems.find(item => item.id === tab))
      .filter((item): item is NavItem => Boolean(item)),
    [favoriteTabs, visibleNavItems],
  );
  const hiddenFavoriteCount = favoritesReady ? favoriteTabs.length - visibleFavoriteItems.length : 0;
  const unpinUnavailableFavorites = useCallback(() => {
    const next = favoriteTabs.filter(tab => visibleTabIds.has(tab));
    const removedCount = favoriteTabs.length - next.length;
    setFavoriteTabs(next);
    setFavoriteMessage(
      saveFavoriteTabs(next)
        ? `${removedCount} unavailable favorite${removedCount === 1 ? "" : "s"} unpinned.`
        : "Favorites could not be saved in this browser.",
    );
  }, [favoriteTabs, saveFavoriteTabs, visibleTabIds]);

  const [recentTabs, setRecentTabs] = useState<TabId[]>([]);
  const [recentsReady, setRecentsReady] = useState(false);
  const previousTabRef = useRef<TabId>(activeTab);

  useEffect(() => {
    if (!recentStorageKey) return;

    setRecentsReady(false);
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(recentStorageKey) || "[]");
      const stored = Array.isArray(parsed) ? parsed : [];
      const next = stored
        .filter((tab): tab is TabId => typeof tab === "string" && NAV.some(item => item.id === tab))
        .filter((tab, index, tabs) => tab !== activeTab && tabs.indexOf(tab) === index)
        .slice(0, MAX_RECENT_TABS);
      setRecentTabs(next);
    } catch {
      setRecentTabs([]);
    }
    setRecentsReady(true);
  }, [recentStorageKey]);

  useEffect(() => {
    const previousTab = previousTabRef.current;
    previousTabRef.current = activeTab;
    if (!recentsReady || !recentStorageKey || previousTab === activeTab) return;

    setRecentTabs(current => {
      const next = [
        previousTab,
        ...current.filter(tab => tab !== previousTab && tab !== activeTab),
      ].slice(0, MAX_RECENT_TABS);
      try { localStorage.setItem(recentStorageKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [activeTab, recentStorageKey, recentsReady]);

  const visibleRecentItems = useMemo(
    () => recentTabs
      .filter(tab => tab !== activeTab)
      .map(tab => visibleNavItems.find(item => item.id === tab))
      .filter((item): item is NavItem => Boolean(item))
      .slice(0, MAX_RECENT_TABS),
    [activeTab, recentTabs, visibleNavItems],
  );

  // --- Sidebar UI state (v0.8.1+) ---
  // Per-group collapse + sidebar minimize-to-rail. Both persist to localStorage
  // so an operator's layout choices survive reloads. Defaults: all groups open,
  // sidebar full-width — preserves discoverability for first-time operators.
  // Default collapsed state: every group collapsed EXCEPT COMMAND (primary
  // navigation surface — Fleet / Instance / Correlations / Blast Radius) and
  // SYSTEM (Configuration). Cuts first-load scroll fatigue. Users can expand
  // any group with a click; their choice persists via localStorage.
  // operator-specified target 2026-04-24. Empty localStorage → this default;
  // existing localStorage preferences are respected unchanged.
  const DEFAULT_COLLAPSED = [
    "SECURITY", "DEFENSE", "ACTIVITY", "GOVERNANCE",
    "PERFORMANCE", "OPERATIONS", "COMPLIANCE", "ABOUT",
  ];
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set(DEFAULT_COLLAPSED);
    try {
      const raw = localStorage.getItem("clawnex_collapsed_groups");
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch { /* ignore */ }
    return new Set(DEFAULT_COLLAPSED);
  });
  const [sidebarMinimized, setSidebarMinimized] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return localStorage.getItem("clawnex_sidebar_minimized") === "1"; } catch { return false; }
  });

  const toggleGroup = useCallback((group: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group); else next.add(group);
      try { localStorage.setItem("clawnex_collapsed_groups", JSON.stringify(Array.from(next))); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const toggleSidebarMinimized = useCallback(() => {
    setSidebarMinimized(prev => {
      const next = !prev;
      try { localStorage.setItem("clawnex_sidebar_minimized", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Auto-expand the group containing the active tab — but ONLY on navigation,
  // never on manual group-toggle. If we depended on collapsedGroups too, the
  // operator could never collapse the group containing their active tab
  // (each manual collapse would immediately get reverted by this effect).
  // The intent: after a deep-link or panel-jump, surface the destination.
  // Manual collapse of the active group is allowed and sticks.
  useEffect(() => {
    const activeItem = NAV.find(n => n.id === activeTab);
    if (!activeItem) return;
    setCollapsedGroups(prev => {
      if (!prev.has(activeItem.group)) return prev;
      const next = new Set(prev);
      next.delete(activeItem.group);
      try { localStorage.setItem("clawnex_collapsed_groups", JSON.stringify(Array.from(next))); } catch { /* ignore */ }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const healthyServices = infra?.services?.filter(s => s.status === "online").length ?? 0;
  const criticalServices = infra?.services?.filter(s => s.status === "offline").length ?? 0;

  // --- Panel renderer ---
  const renderPanel = useCallback(() => {
    switch (activeTab) {
      case "missionControl": return <MissionControlPanel demoMode={demoMode} onNavigate={navigate} operator={operator ?? undefined} range={timeRange as MCTimeRange} filters={dashboardFilters} />;
      case "fleet": return <FleetCommandPanel fleetApi={fleet} filters={dashboardFilters} demoMode={demoMode} threatTrend={threatTrend} onNavigate={navigate} />;
      case "instance": return <InstanceDetailPanel fleetApi={fleet} demoMode={demoMode} filters={dashboardFilters} onNavigate={navigate} />;
      case "correlations": return <CorrelationsPanel filters={dashboardFilters} demoMode={demoMode} onNavigate={navigate} />;
      case "blastRadius": return <BlastRadiusPanel onNavigate={navigate} demoMode={demoMode} />;
      case "securityPosture": return <SecurityPosturePanel fleetApi={fleet} demoMode={demoMode} onNavigate={navigate} filters={dashboardFilters} incomingFromMissionControl={incomingFromMissionControl} onMissionControlBackConsumed={onMissionControlBackConsumed} />;
      case "trustAudit": return <TrustAuditPanel incomingFromMissionControl={incomingFromMissionControl} onMissionControlBackConsumed={onMissionControlBackConsumed} />;
      case "shield": return <PromptShieldPanel externalPayload={demoPayload} onPayloadConsumed={() => setDemoPayload(null)} filters={dashboardFilters} demoMode={demoMode} />;
      case "shieldTests": return <ShieldTestsPanel filters={dashboardFilters} />;
      case "accessControl": return <AccessControlPanel demoMode={demoMode} onNavigate={navigate} />;
      case "agents": return <AgentsSessionsPanel filters={dashboardFilters} demoMode={demoMode} onNavigate={navigate} />;
      case "workspace": return <AgentWorkspacePanel demoMode={demoMode} filters={dashboardFilters} />;
      case "tokenCost": return <TokenCostPanel filters={dashboardFilters} demoMode={demoMode} health={health} incomingFromMissionControl={incomingFromMissionControl} onMissionControlBackConsumed={onMissionControlBackConsumed} />;
      case "toolsAccess": return <ToolsAccessPanel demoMode={demoMode} filters={dashboardFilters} />;
      case "modelsCost": return <ModelsCostPanel demoMode={demoMode} filters={dashboardFilters} />;
      case "infrastructure": return <InfrastructurePanel infra={infra} onNavigate={navigate} filters={dashboardFilters} demoMode={demoMode} incomingFromMissionControl={incomingFromMissionControl} onMissionControlBackConsumed={onMissionControlBackConsumed} />;
      case "alertsIncidents": return <AlertsIncidentsPanel filters={dashboardFilters} demoMode={demoMode} onNavigate={navigate} focusedAlertId={alertFocus} onAlertFocusConsumed={() => setAlertFocus(null)} incomingFromMissionControl={incomingFromMissionControl} onMissionControlBackConsumed={onMissionControlBackConsumed} />;
      case "auditEvidence": return <AuditEvidencePanel filters={dashboardFilters} demoMode={demoMode} operatorRole={operator?.role} focusedAuditId={auditFocus} onConsumed={() => setAuditFocus(null)} incomingFromAlert={incomingFromAlert} onBackConsumed={() => setIncomingFromAlert(null)} onNavigate={navigate} incomingFromMissionControl={incomingFromMissionControl} onMissionControlBackConsumed={onMissionControlBackConsumed} />;
      case "executiveReports": return <ExecutiveReportsPanel filters={dashboardFilters} demoMode={demoMode} />;
      case "accessLists": return <AccessListsPanel demoMode={demoMode} filters={dashboardFilters} />;
      case "governance": return <GovernancePanel />;
      case "riskAcceptance": return <RiskAcceptancePanel onNavigate={navigate} demoMode={demoMode} />;
      case "trafficMonitor": return <TrafficMonitorPanel filters={dashboardFilters} onNavigate={navigate} demoMode={demoMode} incomingFromMissionControl={incomingFromMissionControl} onMissionControlBackConsumed={onMissionControlBackConsumed} />;
      case "configuration": return <ConfigurationPanel focusCard={configFocus} onNavigate={navigate} incomingFromMissionControl={incomingFromMissionControl} onMissionControlBackConsumed={onMissionControlBackConsumed} />;
      case "help": return <HelpPanel onNavigate={navigate} />;
      case "about": return <AboutPanel />;
      default: return <EmptyState message="Panel not found" />;
    }
  }, [activeTab, fleet, infra, demoPayload, dashboardFilters, demoMode, health, threatTrend, navigate, configFocus, auditFocus, incomingFromAlert, alertFocus, operator?.role, incomingFromMissionControl, onMissionControlBackConsumed]);

  const currentLabel = NAV.find(n => n.id === activeTab)?.label || "ClawNex";
  const tourTabs = Object.keys(PANEL_HELP) as TabId[];

  // Don't render until theme is applied — prevents dark flash in light mode
  if (!mounted) {
    return <div style={{ height: "100vh" }} />;
  }

  return (
    <div style={{ fontFamily: F.sans, background: C.bg, color: C.tx, height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* ===== STATUS BAR (44px) ===== */}
      <div style={{
        height: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 16px", ...G.header,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img src={theme === "light" ? "/clawnex-icon-light.png" : "/clawnex-icon-dark.png"} alt="ClawNex" width={20} height={20} style={{ flexShrink: 0, objectFit: "contain", borderRadius: 4 }} />
            <a href="https://clawnexai.com" target="_blank" rel="noopener noreferrer" title="clawnexai.com" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              {/* SVG wordmark — see BrandWordmark.tsx for why we ditched the
                 CSS background-clip:text approach. */}
              <BrandWordmark size={13} />
            </a>
            <span style={{ fontSize: 11, color: C.txT, fontFamily: F.mono }}>v{CLAWNEX_VERSION_SHORT}</span>
            {CLAWNEX_CHANNEL && (
              <span style={{ fontSize: 9, fontWeight: 700, fontFamily: F.mono, color: C.cyan, background: `${C.cyan}18`, border: `1px solid ${C.cyan}44`, borderRadius: 3, padding: "1px 5px", letterSpacing: "0.05em" }}>{CLAWNEX_CHANNEL.toUpperCase()}</span>
            )}
            {/* Update notifier — aggregates /api/config/updates flags
                across OpenClaw, Host Security, and ClawNex Shield Rules and surfaces a
                single click target. Click expands a dropdown with
                installed→latest version pairs; "View details" deep-links
                to Configuration → Updates section. */}
            <UpdateBadge navigate={(tab, focusKey) => navigate(tab as TabId, focusKey)} />
          </div>
          <div style={{ width: 1, height: 20, background: C.brd }} />
          <div style={{ display: "flex", gap: 10, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em" }}>
            {/* Inline source/inclusion/window tooltips per the reviewer's metric-semantic discipline (v0.7.1).
                Labels match query semantics: count, source, scope. Hover any KPI for details.
                See: docs/superpowers/specs/2026-04-23-blast-radius-permissiveness-design.md (Metric Semantics §). */}
            <Tooltip as="span" placement="bottom" variant="detail" content={<span><strong>Services online</strong> — how many services in your fleet are healthy right now. A service counts as online if its last health check came back green.</span>}>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <Dot color={C.green} glow size={5} />
                <span style={{ color: C.green }}>{healthyServices} SERVICES</span>
              </span>
            </Tooltip>
            <Tooltip as="span" placement="bottom" variant="detail" content={<span><strong>Services down</strong> — how many services across your fleet are currently offline. The number pulses red when this isn&apos;t zero so you can spot a fleet-wide problem without reading the digits.</span>}>
              <span style={{ display: "flex", alignItems: "center", gap: 3, ...(criticalServices > 0 ? { animation: "pulse 5s ease-in-out infinite" } : {}) }}>
                <Dot color={criticalServices > 0 ? C.danger : C.txG} size={5} pulse={criticalServices > 0} />
                <span style={{ color: criticalServices > 0 ? C.danger : C.txT }}>{criticalServices} DOWN</span>
              </span>
            </Tooltip>
            {/* Wire status chip (v0.9.3+) — surfaces whether the OpenClaw
                gateway is actually routing traffic through ClawNex's
                LiteLLM proxy, i.e. whether the Prompt Shield is in the
                request path at all. BYPASSED is the alarm state; an
                operator on a fresh install sees it before they trust any
                other number on the page. Click jumps to the routing card.
                Hidden when openclaw.json isn't found yet (chip would be
                meaningless during pre-wizard state). */}
            {wireBadge !== 'unknown' && (
              <Tooltip as="span" placement="bottom" variant="detail" content={
                wireBadge === 'wired' ? (
                  <span><strong>Wired</strong> — OpenClaw is sending agent traffic through ClawNex&apos;s safety proxy. <strong>The Prompt Shield is scanning every agent request.</strong> Click to inspect or revert.</span>
                ) : wireBadge === 'manual' ? (
                  <span><strong>Manual</strong> — Someone routed OpenClaw through a LiteLLM proxy by hand, outside of ClawNex&apos;s setup. The Shield may or may not be scanning depending on where it points. Click to inspect, or use Force Wire to take over.</span>
                ) : (
                  <span><strong>Bypassed — the Prompt Shield is NOT scanning agent traffic.</strong> OpenClaw is talking directly to model providers, so nothing is checking inbound prompts for jailbreaks, injections, or secret leaks. Click to wire the bridge in one click.</span>
                )
              }>
                <span
                  onClick={() => navigate("configuration", "openclawRouting")}
                  style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer", ...(wireBadge === 'bypassed' ? { animation: "pulse 5s ease-in-out infinite" } : {}) }}
                >
                  <Dot color={wireBadge === 'wired' ? C.green : wireBadge === 'manual' ? C.cyan : C.warn} size={5} pulse={wireBadge === 'bypassed'} />
                  <span style={{ color: wireBadge === 'wired' ? C.green : wireBadge === 'manual' ? C.cyan : C.warn }}>
                    {wireBadge === 'wired' ? 'WIRED' : wireBadge === 'manual' ? 'MANUAL' : 'BYPASSED'}
                  </span>
                </span>
              </Tooltip>
            )}
            <Tooltip as="span" placement="bottom" variant="detail" content={
              <div style={{ lineHeight: 1.5 }}>
                <div style={{ marginBottom: 6 }}>
                  <strong>Critical alerts that nobody has touched yet</strong> — the most urgent items right now. Open status, CRITICAL severity, in the last {since}.
                </div>
                <div style={{ marginBottom: 4, opacity: 0.85 }}>What this number leaves out:</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  <li>Alerts already acknowledged, being investigated, resolved, suppressed, or marked false-positive</li>
                  <li>Lower severities (HIGH, MEDIUM, LOW)</li>
                  <li>Test, demo, and QA traffic — only real production counts here</li>
                </ul>
                <div style={{ marginTop: 6, opacity: 0.7 }}>
                  See the sidebar badge or <strong>Alerts &amp; Incidents</strong> for the broader picture across all severities and statuses.
                </div>
              </div>
            }>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <Dot color={alertCount > 0 ? C.orange : C.txG} size={5} />
                <span style={{ color: alertCount > 0 ? C.orange : C.txT }}>{alertCount} CRITICAL ALERTS</span>
              </span>
            </Tooltip>
            <Tooltip as="span" placement="bottom" variant="detail" content={
              <div style={{ lineHeight: 1.5 }}>
                <div style={{ marginBottom: 6 }}>
                  <strong>Fleet agents</strong> — the total number of agents your fleet is currently reporting, added up across every instance. Each instance includes its agent count in its heartbeat to ClawNex; this number is the sum.
                </div>
                <div style={{ opacity: 0.7 }}>
                  If an instance hasn&apos;t checked in recently, its agents won&apos;t show up here even if they still exist. The <strong>Agents &amp; Sessions</strong> panel shows the registered total, which can differ.
                </div>
              </div>
            }>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <Dot color={C.cyan} size={5} />
                <span style={{ color: C.cyan }}>{fleet && fleet.length > 0 ? fleet.reduce((s, f) => s + (f.agents || 0), 0) : 0} FLEET AGENTS</span>
              </span>
            </Tooltip>
            {/* Posture pill sits immediately before the count pill so the
                two render as a single fact ("OBSERVE — 12 WOULD-BLOCK").
                Colour encodes posture: amber=watching, red=rejecting.
                Click is a shortcut into Configuration → Shield Settings;
                without it the operator would hunt through the config tree
                to flip modes after spotting the pill. */}
            <Tooltip as="span" placement="bottom" variant="detail" content={
              <div style={{ lineHeight: 1.5 }}>
                <div style={{ marginBottom: 6 }}>
                  <strong>Shield posture</strong> — whether the Prompt Shield is actively rejecting threats or just watching them.
                </div>
                <div style={{ marginBottom: 4 }}>
                  <strong style={{ color: C.warn }}>OBSERVE</strong> — every request is scanned and logged, but threats are <em>flagged</em>, not blocked. Agents continue to receive responses. Use this to baseline traffic before tightening.
                </div>
                <div style={{ marginBottom: 4 }}>
                  <strong style={{ color: C.danger }}>BLOCKING</strong> — threats that score BLOCK are actively rejected before reaching the model. The agent receives an error.
                </div>
                <div style={{ opacity: 0.7 }}>
                  Click to jump to Configuration → Shield Settings to switch modes.
                </div>
              </div>
            }>
              <span
                onClick={() => navigate("configuration", "shieldSettings")}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("configuration", "shieldSettings"); } }}
                style={{
                  display: "flex", alignItems: "center", gap: 3,
                  padding: "1px 5px", borderRadius: 3,
                  border: `1px solid ${shieldMode === "block" ? `${C.danger}66` : `${C.warn}66`}`,
                  background: shieldMode === "block" ? `${C.danger}14` : `${C.warn}14`,
                  cursor: "pointer",
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                }}
                aria-label={shieldMode === "block" ? "Shield blocking — click to manage" : "Shield observing — click to manage"}
              >
                <Dot color={shieldMode === "block" ? C.danger : C.warn} size={5} />
                <span style={{ color: shieldMode === "block" ? C.danger : C.warn }}>
                  {shieldMode === "block" ? "BLOCKING" : "OBSERVE"}
                </span>
              </span>
            </Tooltip>
            <Tooltip as="span" placement="bottom" variant="detail" content={
              <div style={{ lineHeight: 1.5 }}>
                <div style={{ marginBottom: 6 }}>
                  <strong>{shieldMode === "block" ? "Shield blocks" : "Would-block"}</strong> — how many requests the Prompt Shield {shieldMode === "block" ? "blocked outright" : "would have blocked"} in the last {since}. Each {shieldMode === "block" ? "block" : "would-block"} is something the 163-detection built-in pack (plus operator-authored custom rules) flagged as malicious{shieldMode === "block" ? " before it could reach the model" : "; in OBSERVE mode the request still reached the model"}.
                </div>
                <div style={{ opacity: 0.7 }}>
                  Only counts shield-rule {shieldMode === "block" ? "blocks" : "would-blocks"}. Broader proxy blocks and session-watcher blocks are tracked separately — see <strong>Traffic Monitor</strong> for those.
                </div>
                {shieldMode === "observe" && (
                  <div style={{ marginTop: 4, opacity: 0.85, color: C.warn }}>
                    Switch to BLOCK mode in <strong>Configuration → Shield Settings</strong> to actually reject these.
                  </div>
                )}
                <div style={{ marginTop: 4, opacity: 0.7 }}>
                  Pulses red when non-zero so active threats are visible without reading the digit.
                </div>
              </div>
            }>
              <span style={{ display: "flex", alignItems: "center", gap: 3, ...(shieldBlocked > 0 ? { animation: "pulse 5s ease-in-out infinite" } : {}) }}>
                <Dot color={shieldBlocked > 0 ? C.danger : C.txG} size={5} pulse={shieldBlocked > 0} />
                <span style={{ color: shieldBlocked > 0 ? C.danger : C.txT }}>
                  {shieldBlocked} {shieldMode === "block" ? "BLOCKED" : "WOULD-BLOCK"}
                </span>
              </span>
            </Tooltip>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: F.mono, fontSize: 11, color: C.txT }}>{clock} UTC</span>
          <Tooltip placement="bottom" variant="compact" content={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
          {/* Theme toggle — replaced fragile Unicode glyphs with inline SVGs.
              The old text glyphs rendered inconsistently across fonts and were
              tiny relative to the button hit area. New: 16px sun (orange C.warn)
              when in dark mode → click to go light; 16px crescent moon (C.cyan)
              when in light mode → click to go dark. Aria label preserved. */}
          <button
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 28, height: 24, borderRadius: 4, padding: 0, cursor: "pointer",
              background: theme === "dark" ? `${C.warn}1c` : `${C.cyan}18`,
              border: `1px solid ${theme === "dark" ? `${C.warn}66` : `${C.cyan}55`}`,
            }}
          >
            {theme === "dark" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.warn} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4" fill={`${C.warn}33`} />
                <line x1="12" y1="2" x2="12" y2="5" />
                <line x1="12" y1="19" x2="12" y2="22" />
                <line x1="2" y1="12" x2="5" y2="12" />
                <line x1="19" y1="12" x2="22" y2="12" />
                <line x1="4.93" y1="4.93" x2="6.99" y2="6.99" />
                <line x1="17.01" y1="17.01" x2="19.07" y2="19.07" />
                <line x1="4.93" y1="19.07" x2="6.99" y2="17.01" />
                <line x1="17.01" y1="6.99" x2="19.07" y2="4.93" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill={`${C.cyan}22`} />
              </svg>
            )}
          </button>
          </Tooltip>
          <div
            role="group"
            aria-label={`Dashboard text size ${fontSizeStep >= 0 ? `plus ${fontSizeStep}` : `minus ${Math.abs(fontSizeStep)}`} pixels`}
            style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
          >
            <Tooltip placement="bottom" variant="compact" content={<span>Decrease dashboard text size. Current adjustment: <strong>{fontSizeStep >= 0 ? `+${fontSizeStep}` : fontSizeStep}px</strong>.</span>}>
              <button
                type="button"
                onClick={() => adjustFontSize(-1)}
                disabled={fontSizeStep <= FONT_SIZE_MIN}
                aria-label="Decrease dashboard text size"
                style={{
                  width: 30, height: 24, padding: 0, borderRadius: 4, cursor: fontSizeStep <= FONT_SIZE_MIN ? "not-allowed" : "pointer",
                  background: "transparent", border: `1px solid ${C.brd}`, color: C.txS,
                  fontFamily: F.sans, fontSize: 12, fontWeight: 800, opacity: fontSizeStep <= FONT_SIZE_MIN ? 0.45 : 1,
                }}
              >A−</button>
            </Tooltip>
            <Tooltip placement="bottom" variant="compact" content={<span>Increase dashboard text size. Current adjustment: <strong>{fontSizeStep >= 0 ? `+${fontSizeStep}` : fontSizeStep}px</strong>.</span>}>
              <button
                type="button"
                onClick={() => adjustFontSize(1)}
                disabled={fontSizeStep >= FONT_SIZE_MAX}
                aria-label="Increase dashboard text size"
                style={{
                  width: 30, height: 24, padding: 0, borderRadius: 4, cursor: fontSizeStep >= FONT_SIZE_MAX ? "not-allowed" : "pointer",
                  background: `${C.cyan}12`, border: `1px solid ${C.cyan}44`, color: C.cyan,
                  fontFamily: F.sans, fontSize: 12, fontWeight: 800, opacity: fontSizeStep >= FONT_SIZE_MAX ? 0.45 : 1,
                }}
              >A+</button>
            </Tooltip>
          </div>
          <Tooltip placement="bottom" variant="detail" content={<span><strong>Performance Mode</strong> — disables glass blur, gradient backdrops, and the rotating Shield avatar. Aimed at low-end hardware, remote sessions over Tailscale, and screen-sharing where heavy effects stutter. Visual fidelity drops; data fidelity is unchanged.</span>}>
          <button onClick={() => { setPerformanceMode(!performanceMode); setPerfMode(!performanceMode); }} style={{
            padding: "2px 8px", borderRadius: 3, fontSize: 11, fontWeight: 700, fontFamily: F.sans, cursor: "pointer",
            background: performanceMode ? `${C.warn}28` : "transparent", border: `1px solid ${performanceMode ? C.warn : C.brd}`, color: performanceMode ? C.warn : C.txT, letterSpacing: "0.05em",
          }}>{performanceMode ? "PERF" : "\u26A1"}</button>
          </Tooltip>
          <Tooltip placement="bottom" variant="detail" content={
            <span>
              <strong>Demo Mode</strong> overlays seeded mock data inside <strong>panel bodies</strong> only — it does <strong>not</strong> change the header counters, the Deployment Readiness banner, or the Welcome Wizard. Those stay <strong>live</strong> so you can see the real environment chrome while panels show synthetic content for screen-shares, sales demos, and onboarding new operators. Does not write to the DB. Disable for actual investigation work.
            </span>
          }>
          <button onClick={() => setDemoMode(!demoMode)} style={{
            padding: "2px 8px", borderRadius: 3, fontSize: 11, fontWeight: 700, fontFamily: F.sans, cursor: "pointer",
            background: demoMode ? `${C.orange}28` : "transparent", border: `1px solid ${demoMode ? C.orange : C.brd}`, color: demoMode ? C.orange : C.txT, letterSpacing: "0.05em",
          }}>{demoMode ? "DEMO ON" : "DEMO"}</button>
          </Tooltip>
          <Tooltip placement="bottom" variant="detail" content={<span>Open or close the right-side <strong>AI chat panel</strong>. Lets you ask questions of the dashboard data using the configured Default AI Model. Tooltip-toggle, severity filters, and instance scope all flow into the chat context.</span>}>
          <button onClick={() => setChatOpen(!chatOpen)} style={{
            padding: "2px 8px", borderRadius: 3, fontSize: 11, fontWeight: 700, fontFamily: F.sans, cursor: "pointer",
            background: chatOpen ? `${C.brand}18` : "transparent", border: `1px solid ${chatOpen ? C.brand : C.brd}`, color: chatOpen ? C.brand : C.txT, letterSpacing: "0.05em",
          }}>AI</button>
          </Tooltip>
        </div>
      </div>

      {/* ===== CONTEXT BAR (38px) ===== */}
      <div style={{ height: 38, minHeight: 38, display: "flex", alignItems: "center", gap: 8, padding: "0 16px", position: "relative", zIndex: 100, overflow: "visible", ...G.context }}>
        <Tooltip as="div" placement="bottom" variant="detail" content={
          <span>
            <strong style={{ color: C.tx }}>Global time range.</strong> Controls the window for every panel in the dashboard — threats, alerts, cost, metrics, audit events, correlations. Selecting <strong>1h</strong> narrows everything to the last hour; <strong>30d</strong> widens it to the last month. Change it here and the whole dashboard refocuses.
          </span>
        }>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {["1h", "6h", "24h", "7d", "30d"].map(t => (
              <button key={t} onClick={() => setTimeRange(t)} style={{
                padding: "3px 10px", borderRadius: 6, fontSize: 14, fontWeight: 600, fontFamily: F.mono, cursor: "pointer",
                // v0.13.0+ glass: active = cyan→green gradient + dark text (matches MC range picker).
                background: timeRange === t ? `linear-gradient(135deg, ${C.cyan}, ${C.glassGreen})` : C.glassSurfTrans,
                border: `1px solid ${timeRange === t ? "transparent" : C.glassSurfBorder}`,
                color: timeRange === t ? "#06121f" : C.txT,
              }}>{t}</button>
            ))}
          </div>
        </Tooltip>
        <div style={{ width: 1, height: 18, background: C.glassBorderSubtle }} />
        <GlobalFilterSelect
          ariaLabel="Filter dashboard by instance"
          value={selectedInstance}
          options={instanceFilterOptions}
          onChange={setSelectedInstance}
          minWidth={220}
        />
        <GlobalFilterSelect
          ariaLabel="Filter dashboard by client"
          value={selectedClient}
          options={clientFilterOptions}
          onChange={setSelectedClient}
          minWidth={150}
        />
        <GlobalFilterSelect
          ariaLabel="Filter dashboard by severity"
          value={selectedSeverity}
          options={severityFilterOptions}
          onChange={setSelectedSeverity}
          accent={selectedSeverity === "all" ? C.cyan : sevColor(selectedSeverity)}
          minWidth={150}
        />
      </div>

      {/* Developer Tools "active simulation runs" ribbon (v0.9.3+).
          When seed-traffic exists on the fleet, surface a strip so
          operators who seeded and walked away get nudged back to clean
          it up. Click navigates straight to the Developer Tools card.
          Hidden entirely on customer-prod installs (env kill switch
          makes /api/dev/status 404; the fetch sets count to 0).

          internal reviewer follow-up 2026-04-29: when ANY Mode B run is active
          (rows tagged origin='production' so default counters light
          up), the ribbon escalates from amber to danger-red. This is
          the loud version operators need to see during M-01 recording
          / demo flows so they can't forget Mode B is on. */}
      {activeSimRunCount > 0 && (() => {
        const hasModeB = activeModeBRunCount > 0;
        const accent = hasModeB ? C.danger : C.warn;
        return (
          <div
            onClick={() => navigate("configuration", "developerTools")}
            style={{
              padding: "6px 16px",
              background: `${accent}10`,
              borderTop: `1px solid ${accent}33`,
              borderBottom: `1px solid ${accent}33`,
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              fontSize: 11, fontFamily: F.sans, color: C.txS,
              cursor: "pointer",
            }}
          >
            <span style={{
              fontSize: 9, fontWeight: 800, padding: "1px 6px", borderRadius: 3,
              background: `${accent}28`, color: accent,
              letterSpacing: "0.08em", fontFamily: F.mono,
            }}>{hasModeB ? "SIMULATION LIT UP" : "SIMULATION DATA"}</span>
            {hasModeB ? (
              <span>
                <strong style={{ color: accent }}>{activeModeBRunCount} Mode B run{activeModeBRunCount === 1 ? "" : "s"}</strong>
                {activeSimRunCount > activeModeBRunCount && <> + {activeSimRunCount - activeModeBRunCount} Mode A</>} on this fleet.
                <strong style={{ color: C.tx }}> Default counters are reflecting synthetic data</strong> — rows tag <span style={{ fontFamily: F.mono, color: C.cyan }}>origin: production</span> with <span style={{ fontFamily: F.mono, color: C.cyan }}>simulation: true</span>.
                Click to reset in <strong>Configuration → Developer Tools</strong>.
              </span>
            ) : (
              <span>
                <strong style={{ color: C.tx }}>{activeSimRunCount} active simulation run{activeSimRunCount === 1 ? "" : "s"}</strong> on this fleet.
                Rows are tagged <span style={{ fontFamily: F.mono, color: C.cyan }}>origin: simulation</span> and excluded from production-grade counters by default.
                Click to manage / reset in <strong>Configuration → Developer Tools</strong>.
              </span>
            )}
          </div>
        );
      })()}

      {/* Policy framework v1 — disabled vendor policy ribbon (Spec §3.8).
          Surfaces when an operator has disabled ClawNex Default (curated,
          operator-visible AUDIT MIRROR of ALL_RULES — wire-inert in v1)
          OR Generic Egress Starter (system, wire-active outbound starter)
          via the Task 21 typed-phrase confirmation flow.

          Per-policy semantics (internal reviewer review): only Generic Egress Starter
          being disabled actually strips wire-active detection coverage.
          Disabling ClawNex Default removes the operator-visible mirror
          row from Configuration → Policies & Rules, but the same 163
          built-in detections continue to run from `src/lib/shield/rules.ts`
          on every scan. The ribbon copy below makes this distinction
          explicit so the dashboard doesn't teach operators the wrong
          architecture. Click jumps to Configuration → Policies & Rules. */}
      {disabledVendorPolicies.length > 0 && (() => {
        const accent = C.danger;
        const hasClawnexDefault = disabledVendorPolicies.includes("ClawNex Default");
        const hasGenericEgress = disabledVendorPolicies.includes("Generic Egress Starter");
        const bothDisabled = hasClawnexDefault && hasGenericEgress;
        return (
          <div
            onClick={() => navigate("configuration", "policiesAndRules")}
            style={{
              padding: "6px 16px",
              background: `${accent}10`,
              borderTop: `1px solid ${accent}33`,
              borderBottom: `1px solid ${accent}33`,
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              fontSize: 11, fontFamily: F.sans, color: C.txS,
              cursor: "pointer",
            }}
          >
            <span style={{
              fontSize: 9, fontWeight: 800, padding: "1px 6px", borderRadius: 3,
              background: `${accent}28`, color: accent,
              letterSpacing: "0.08em", fontFamily: F.mono,
            }}>VENDOR POLICY OFF</span>
            {bothDisabled ? (
              <span>
                {"⚠ "}<strong style={{ color: accent }}>Both ClawNex vendor-shipped policies are disabled.</strong>
                {" "}<strong style={{ color: C.tx }}>Outbound starter DLP/policy detection is OFF</strong>
                {" (Generic Egress Starter). The curated operator-visible mirror is also disabled, "}
                <strong>but the 163 built-in Shield detections still run from source in v1</strong>
                {" (ClawNex Default is wire-inert audit data; disabling it removes the mirror row, not the detections)."}
                {" "}Click to review in <strong>Configuration → Policies & Rules</strong>.
              </span>
            ) : hasClawnexDefault ? (
              <span>
                {"⚠ "}<strong style={{ color: accent }}>ClawNex Default is disabled.</strong>
                {" "}<strong style={{ color: C.tx }}>The curated operator-visible mirror is OFF, but the 163 built-in Shield detections still run from source in v1.</strong>
                {" Re-enable to restore the audit-visible mirror row."}
                {" "}Click to review in <strong>Configuration → Policies & Rules</strong>.
              </span>
            ) : hasGenericEgress ? (
              <span>
                {"⚠ "}<strong style={{ color: accent }}>Generic Egress Starter is disabled.</strong>
                {" "}<strong style={{ color: C.tx }}>Outbound starter DLP/policy detection is OFF</strong>
                {" — OUT-PII rules + outbound DLP starters no longer fire on the wire."}
                {" "}Click to review in <strong>Configuration → Policies & Rules</strong>.
              </span>
            ) : (() => {
              // Fall-through: unknown vendor-source policy disabled (shouldn't
              // happen in normal use — ClawNex Default + Generic Egress Starter
              // are the only vendor-shipped policies; this branch defends
              // against a future-added vendor policy that hasn't been wired
              // into the per-policy copy above yet).
              const name = disabledVendorPolicies[0];
              return (
                <span>
                  {"⚠ "}<strong style={{ color: accent }}>{name} is disabled.</strong>
                  {" "}<strong style={{ color: C.tx }}>Review runtime impact in</strong>
                  {" "}<strong>Configuration → Policies & Rules</strong>.
                </span>
              );
            })()}
          </div>
        );
      })()}

      {/* Demo-mode boundary banner. When DEMO is on, the panel bodies show
          synthetic content but the header above stays sourced from the live
          environment. Without an explicit cue, an operator demoing to a
          colleague can mistake live header counters for demo content (or
          vice versa). The banner makes the live/demo split unmissable. */}
      {demoMode && (
        <div style={{
          padding: "6px 16px",
          background: `${C.orange}10`,
          borderTop: `1px solid ${C.orange}33`,
          borderBottom: `1px solid ${C.orange}33`,
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          fontSize: 11, fontFamily: F.sans, color: C.txS,
        }}>
          <span style={{
            fontSize: 9, fontWeight: 800, padding: "1px 6px", borderRadius: 3,
            background: `${C.orange}28`, color: C.orange,
            letterSpacing: "0.08em", fontFamily: F.mono,
          }}>DEMO ON</span>
          <span>
            <strong style={{ color: C.tx }}>Header counters and Readiness Banner are LIVE</strong> (real environment).
            Panel bodies below use seeded mock data. Toggle <strong>DEMO</strong> off in the header to return to fully-live mode.
          </span>
        </div>
      )}

      {/* ===== MAIN LAYOUT ===== */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* LEFT NAV SIDEBAR — v0.8.1+ supports per-group collapse + minimize-to-rail.
            Expanded width follows the accessibility text-size preference so
            navigation labels remain readable; minimized stays a stable 48px. */}
        <nav style={{
          width: sidebarMinimized ? 48 : sidebarExpandedWidth,
          minWidth: sidebarMinimized ? 48 : sidebarExpandedWidth,
          // v0.13.0+: glass design language. Vertical gradient drops the brightness
          // toward the bottom so deep groups (SYSTEM / ABOUT) recede slightly while
          // the primary COMMAND group stays bright. backdrop-filter keeps the
          // chrome translucent against page-level radial gradients in MC mode.
          background: `linear-gradient(180deg, ${C.glassChrome}, ${C.glassPanel2})`,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderRight: `1px solid ${C.glassBorderSubtle}`,
          boxShadow: `inset -1px 0 0 ${C.glassBorderCyan}`,
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          overflowX: "hidden",
          transition: "width 0.18s ease, min-width 0.18s ease",
        }}>
          <div style={{ flex: 1, padding: "4px 0" }}>
            {!sidebarMinimized && favoritesReady && (
              <div style={{ padding: "4px 8px 8px", borderBottom: `1px solid ${C.glassBorderSubtle}` }}>
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "5px 2px 3px", color: C.txG, fontFamily: F.sans,
                  fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                }}>
                  <span>Favorites</span>
                  <span style={{ color: favoriteTabs.length >= MAX_FAVORITE_TABS ? C.warn : C.txT, fontFamily: F.mono, letterSpacing: 0 }}>
                    {favoriteTabs.length}/{MAX_FAVORITE_TABS}
                  </span>
                </div>
                {visibleFavoriteItems.length > 0 ? visibleFavoriteItems.map(item => {
                  const isActive = activeTab === item.id;
                  return (
                    <div
                      key={`favorite-${item.id}`}
                      style={{
                        display: "flex", alignItems: "center", minHeight: 30,
                        borderRadius: 4, background: isActive ? `${C.brand}12` : "transparent",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveTab(item.id)}
                        title={item.label}
                        style={{
                          minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 6,
                          padding: "5px 2px", background: "transparent", border: "none",
                          color: isActive ? C.brand : C.txS, fontFamily: F.sans,
                          fontSize: 12, fontWeight: isActive ? 600 : 400, cursor: "pointer", textAlign: "left",
                        }}
                      >
                        <span style={{ width: 14, textAlign: "center", flexShrink: 0 }}>{item.icon}</span>
                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
                      </button>
                      <FavoriteStarButton
                        label={item.label}
                        favorite
                        onToggle={() => toggleFavorite(item.id)}
                        placement="right"
                        size={24}
                      />
                    </div>
                  );
                }) : (
                  <div style={{ padding: "4px 2px", color: C.txT, fontSize: 11, lineHeight: 1.45 }}>
                    Select a star beside any panel to pin it here.
                  </div>
                )}
                {hiddenFavoriteCount > 0 && (
                  <button
                    type="button"
                    onClick={unpinUnavailableFavorites}
                    style={{
                      width: "100%", marginTop: 3, padding: "4px 2px", background: "transparent",
                      border: "none", color: C.warn, fontSize: 10, fontFamily: F.sans,
                      cursor: "pointer", textAlign: "left",
                    }}
                  >
                    Remove {hiddenFavoriteCount} unavailable favorite{hiddenFavoriteCount === 1 ? "" : "s"}
                  </button>
                )}
                {favoriteMessage && (
                  <div role="status" style={{ padding: "4px 2px 0", color: C.warn, fontSize: 10, lineHeight: 1.4 }}>
                    {favoriteMessage}
                  </div>
                )}

                <div style={{
                  padding: "9px 2px 3px", color: C.txG, fontFamily: F.sans,
                  fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                }}>
                  Recent
                </div>
                {recentsReady && visibleRecentItems.length > 0 ? visibleRecentItems.map(item => (
                  <button
                    key={`recent-${item.id}`}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    title={item.label}
                    style={{
                      width: "100%", minWidth: 0, display: "flex", alignItems: "center", gap: 6,
                      padding: "5px 2px", background: "transparent", border: "none",
                      color: C.txS, fontFamily: F.sans, fontSize: 12,
                      cursor: "pointer", textAlign: "left",
                    }}
                  >
                    <span style={{ width: 14, textAlign: "center", flexShrink: 0 }}>{item.icon}</span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
                  </button>
                )) : (
                  <div style={{ padding: "4px 2px", color: C.txT, fontSize: 11, lineHeight: 1.45 }}>
                    Previously visited panels appear here.
                  </div>
                )}
              </div>
            )}
            {Array.from(groups.entries()).map(([group, items]) => {
              const visibleItems = items.filter(item => visibleTabIds.has(item.id));
              if (visibleItems.length === 0) return null;
              const isCollapsed = collapsedGroups.has(group);
              // In rail mode, group headers shrink to a thin separator + a hover-tooltipped count.
              // Group items are always shown in rail mode (collapse is for vertical space; rail is for horizontal).
              return (
              <div key={group}>
                {sidebarMinimized ? (
                  <div
                    title={`${group} (${visibleItems.length} item${visibleItems.length === 1 ? "" : "s"})`}
                    style={{ height: 1, margin: "8px 12px 4px", background: C.brd, opacity: 0.5 }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group)}
                    title={isCollapsed ? `Expand ${group} (${visibleItems.length} items)` : `Collapse ${group}`}
                    style={{
                      display: "flex", alignItems: "center", gap: 4, width: "100%",
                      padding: "8px 10px 2px", background: "transparent", border: "none",
                      fontSize: 10, color: C.txG, textTransform: "uppercase", letterSpacing: "0.12em",
                      fontWeight: 700, fontFamily: F.sans, cursor: "pointer", textAlign: "left",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-block", fontSize: 8, width: 8,
                        transition: "transform 0.18s ease",
                        transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)",
                      }}
                    >▶</span>
                    <span>{group}</span>
                    {isCollapsed && (
                      <span style={{ marginLeft: "auto", fontSize: 10, color: C.txT, fontFamily: F.mono, fontWeight: 500, letterSpacing: 0 }}>{visibleItems.length}</span>
                    )}
                  </button>
                )}
                {(sidebarMinimized || !isCollapsed) && visibleItems.map(item => {
                  const isActive = activeTab === item.id;
                  // Sidebar count badges. The Alerts & Incidents red badge
                  // was retired 2026-05-07 per operator; the header CRITICAL pill
                  // remains the canonical "things needing immediate attention"
                  // signal. Shield's blocked-traffic badge stays.
                  const badge = item.id === "shield" ? shieldBlocked : 0;
                  // Setup-pending dot on Mission Control: until the wizard is
                  // dismissed, MC tiles are all 0 — flag visually so operators
                  // don't read "0 incidents" as "we're safe!" when the truth is
                  // "nothing has been observed yet". Demo mode short-circuits to
                  // setupComplete=true so demos don't show the dot.
                  const showSetupPending =
                    item.id === "missionControl" && setupComplete === false;
                  const setupTitle = showSetupPending
                    ? `${item.label} — Setup is still in progress; tiles will populate once the wizard is dismissed.`
                    : undefined;
                  return (
                    <div key={item.id} style={{ position: "relative" }}>
                      <button
                        type="button"
                        onClick={() => setActiveTab(item.id)}
                        title={
                          sidebarMinimized
                            ? item.label + (badge > 0 ? ` (${badge})` : "") + (showSetupPending ? " · setup pending" : "")
                            : setupTitle
                        }
                        style={{
                          display: "flex", alignItems: "center", gap: sidebarMinimized ? 0 : 6,
                          width: "100%", padding: sidebarMinimized ? "6px 0" : "5px 34px 5px 10px",
                          justifyContent: sidebarMinimized ? "center" : "flex-start",
                          background: isActive ? `${C.brand}12` : "transparent",
                          border: "none", borderLeft: isActive ? `2px solid ${C.brand}` : "2px solid transparent",
                          color: isActive ? C.brand : C.txS, fontSize: 12, fontFamily: F.sans, fontWeight: isActive ? 600 : 400,
                          cursor: "pointer", textAlign: "left", transition: "all 0.15s ease", whiteSpace: "nowrap", position: "relative",
                        }}
                      >
                        <span style={{ fontSize: sidebarMinimized ? 14 : 11, width: sidebarMinimized ? "100%" : 14, textAlign: "center", flexShrink: 0 }}>{item.icon}</span>
                        {!sidebarMinimized && (
                          <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", overflow: "hidden", gap: 6 }}>
                            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{item.label}</span>
                            {showSetupPending && (
                              <span
                                aria-label="Setup pending"
                                style={{
                                  display: "inline-block",
                                  width: 6,
                                  height: 6,
                                  borderRadius: 999,
                                  background: C.warn,
                                  boxShadow: `0 0 6px ${C.warn}88`,
                                  flexShrink: 0,
                                }}
                              />
                            )}
                            <CountBadge count={badge} color={C.orange} />
                          </span>
                        )}
                        {sidebarMinimized && showSetupPending && badge === 0 && (
                          <span
                            aria-hidden="true"
                            style={{
                              position: "absolute", top: 4, right: 6,
                              width: 6, height: 6, borderRadius: 999,
                              background: C.warn, boxShadow: `0 0 6px ${C.warn}88`,
                            }}
                          />
                        )}
                        {sidebarMinimized && badge > 0 && (
                          <span
                            style={{
                              position: "absolute", top: 2, right: 4,
                              background: C.orange,
                              color: "#fff", fontSize: 8, fontWeight: 700, fontFamily: F.mono,
                              borderRadius: 8, padding: "1px 4px", lineHeight: 1, minWidth: 12, textAlign: "center",
                            }}
                          >
                            {badge > 99 ? "99+" : badge}
                          </span>
                        )}
                      </button>
                      {!sidebarMinimized && favoritesReady && (
                        <div style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)" }}>
                          <FavoriteStarButton
                            label={item.label}
                            favorite={favoriteTabs.includes(item.id)}
                            onToggle={() => toggleFavorite(item.id)}
                            placement="right"
                            size={24}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              );
            })}
          </div>
          {/* Layout controls — Expand all / Collapse all (full-width only;
              hidden in rail mode because group items always show there).
              Each button dims when its action is a no-op (already all open
              / all closed) so operators get visual confirmation. */}
          {!sidebarMinimized && (() => {
            const allGroupNames = Array.from(groups.keys());
            const activeItem = NAV.find((n) => n.id === activeTab);
            const activeGroup = activeItem?.group ?? null;
            // "Collapse all" leaves the active group open as a UX courtesy; this
            // button is a no-op only when every group EXCEPT the active one is
            // already collapsed.
            const allCollapsed = allGroupNames
              .filter((g) => g !== activeGroup)
              .every((g) => collapsedGroups.has(g));
            const allExpanded = collapsedGroups.size === 0;
            const expandAll = () => {
              setCollapsedGroups(new Set());
              try { localStorage.setItem("clawnex_collapsed_groups", "[]"); } catch { /* ignore */ }
            };
            const collapseAll = () => {
              // Collapse every group EXCEPT the one containing the active tab —
              // operator shouldn't lose sight of "you are here" when they
              // collapse everything for focus. They can still collapse the
              // active group manually after this if they really want to.
              const next = new Set(allGroupNames);
              const activeItem = NAV.find((n) => n.id === activeTab);
              if (activeItem) next.delete(activeItem.group);
              setCollapsedGroups(next);
              try { localStorage.setItem("clawnex_collapsed_groups", JSON.stringify(Array.from(next))); } catch { /* ignore */ }
            };
            return (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "6px 10px", borderTop: `1px solid ${C.brd}`,
                fontSize: 10, fontFamily: F.mono, color: C.txT,
              }}>
                <button
                  type="button"
                  onClick={expandAll}
                  disabled={allExpanded}
                  title="Open every group"
                  style={{
                    background: "transparent", border: 0, padding: 0,
                    color: allExpanded ? C.txG : C.cyan, cursor: allExpanded ? "default" : "pointer",
                    fontSize: 10, fontFamily: F.mono, fontWeight: 600,
                    opacity: allExpanded ? 0.4 : 1,
                  }}
                >
                  Expand all
                </button>
                <span style={{ color: C.txG }}>·</span>
                <button
                  type="button"
                  onClick={collapseAll}
                  disabled={allCollapsed}
                  title={activeGroup ? `Close every group except ${activeGroup} (your active panel stays visible)` : "Close every group"}
                  style={{
                    background: "transparent", border: 0, padding: 0,
                    color: allCollapsed ? C.txG : C.cyan, cursor: allCollapsed ? "default" : "pointer",
                    fontSize: 10, fontFamily: F.mono, fontWeight: 600,
                    opacity: allCollapsed ? 0.4 : 1,
                  }}
                >
                  Collapse all
                </button>
              </div>
            );
          })()}

          {/* Minimize toggle + connection footer */}
          <button
            type="button"
            onClick={toggleSidebarMinimized}
            title={sidebarMinimized ? "Expand sidebar" : "Minimize sidebar (icons only)"}
            style={{
              padding: "6px 10px", borderTop: `1px solid ${C.brd}`,
              display: "flex", alignItems: "center", justifyContent: sidebarMinimized ? "center" : "flex-start",
              gap: 6, background: "transparent", border: 0,
              color: C.txT, fontSize: 11, fontFamily: F.sans, cursor: "pointer", width: "100%",
            }}
          >
            <span style={{ fontSize: 13 }}>{sidebarMinimized ? "›" : "‹"}</span>
            {!sidebarMinimized && <span style={{ fontSize: 10, fontFamily: F.mono }}>minimize</span>}
          </button>
          <div
            title={health?.status === "ok" ? "Fleet Connected" : "Offline"}
            style={{ padding: "8px 10px", borderTop: `1px solid ${C.brd}`, display: "flex", alignItems: "center", justifyContent: sidebarMinimized ? "center" : "flex-start", gap: 6 }}
          >
            <Dot color={health?.status === "ok" ? C.green : C.danger} glow size={5} />
            {!sidebarMinimized && <span style={{ fontSize: 10, color: C.txT, fontFamily: F.mono }}>{health?.status === "ok" ? "Fleet Connected" : "Offline"}</span>}
          </div>
          {!sidebarMinimized && (
            <a href="https://clawnexai.com" target="_blank" rel="noopener noreferrer" style={{
              padding: "6px 10px", borderTop: `1px solid ${C.brd}`, display: "block",
              fontSize: 9, color: C.txG, fontFamily: F.sans, textDecoration: "none", textAlign: "center", letterSpacing: "0.04em", transition: "color 0.2s ease",
            }} onMouseEnter={e => { (e.target as HTMLElement).style.color = C.brand; }} onMouseLeave={e => { (e.target as HTMLElement).style.color = C.txG; }}>
              ProBizSystems
            </a>
          )}
        </nav>

        {/* MAIN CONTENT */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "12px 20px", ...G.panelHeader }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, fontFamily: F.disp }}>{currentLabel}</h1>
              <Fresh />
              <div style={{ flex: 1 }} />
              {/* Global tooltip toggle — always visible next to the help button.
                  Click flips the tooltips_enabled flag in config_defaults. When OFF,
                  every <Tooltip> in the dashboard becomes a pass-through. */}
              {/* High contrast toggle — accessibility aid for low-vision operators */}
              <button
                onClick={() => {
                  const next = !highContrast;
                  applyHighContrast(next);
                  setHighContrastState(next);
                  try { localStorage.setItem("clawnex_high_contrast", next ? "1" : "0"); } catch {}
                  void fetch("/api/config/defaults", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ key: "high_contrast_enabled", value: next ? "1" : "0" }),
                  }).catch(() => {});
                }}
                title={highContrast ? "High contrast ON — click to revert" : "Boost text contrast for accessibility"}
                aria-label={`High contrast mode ${highContrast ? "on" : "off"}`}
                aria-pressed={highContrast}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "3px 9px", borderRadius: 999,
                  fontSize: 10, fontWeight: 700, fontFamily: F.mono, letterSpacing: "0.04em",
                  background: highContrast ? `${C.cyan}22` : C.glassSurfTrans,
                  border: `1px solid ${highContrast ? `${C.cyan}88` : C.glassSurfBorder}`,
                  color: highContrast ? C.cyan : C.txT,
                  cursor: "pointer",
                  transition: "background 200ms ease, border-color 200ms ease, color 200ms ease",
                }}
              >
                <span style={{ fontSize: 11, lineHeight: 1 }}>{"\u25D0"}</span>
                <span>A11Y</span>
              </button>
              {operator && (
                <>
                  <span style={{ fontSize: 11, color: C.txS, fontFamily: F.mono }}>
                    {operator.displayName || operator.username}
                  </span>
                  <Badge label={operator.role.replace('_', ' ').toUpperCase()} color={C.purp} />
                  <Tooltip placement="bottom" variant="compact" content="End your session and return to the login page. Other devices' sessions stay active.">
                    <button onClick={handleLogout} style={{
                      padding: "3px 10px", borderRadius: 999, fontSize: 10, fontWeight: 600, fontFamily: F.mono,
                      background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, color: C.txT, cursor: "pointer",
                    }}>Logout</button>
                  </Tooltip>
                </>
              )}
              <TipsToggleButton />
              <Tooltip placement="bottom" variant="detail" content={<span>Open the right-side <strong>panel help</strong> overlay for the currently active tab. Shows the panel&apos;s purpose, key metrics, available actions, and links to related panels.</span>}>
                <button onClick={() => setHelpOpen(!helpOpen)} style={{
                  width: 24, height: 24, borderRadius: 999, fontSize: 13, fontWeight: 700, fontFamily: F.mono,
                  background: helpOpen ? `${C.cyan}22` : C.glassSurfTrans,
                  border: `1px solid ${helpOpen ? `${C.cyan}88` : C.glassSurfBorder}`,
                  color: helpOpen ? C.cyan : C.txT, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                }}>?</button>
              </Tooltip>
              <Tooltip placement="bottom" variant="detail" content={<span>Toggle the floating <strong>Shield avatar</strong> in the lower-right. Used as a tour guide and a hover-target for help context. Hide it when you need the screen real estate for dense panels.</span>}>
                <button onClick={() => setFloatingAvatarVisible(!floatingAvatarVisible)} style={{
                  width: 24, height: 24, borderRadius: 999, fontSize: 13, fontFamily: F.mono,
                  background: floatingAvatarVisible ? `${C.cyan}22` : C.glassSurfTrans,
                  border: `1px solid ${floatingAvatarVisible ? `${C.cyan}88` : C.glassSurfBorder}`,
                  color: floatingAvatarVisible ? C.cyan : C.txT, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                }}>{"\u{1F6E1}"}</button>
              </Tooltip>
              {!tourMode && (
                <Tooltip placement="bottom" variant="detail" content={<span>Start the <strong>guided tour</strong> — walks through every dashboard tab in order with the help overlay open. Best for new operators or when you want a refresher on what each panel does.</span>}>
                  <button onClick={() => { setTourMode(true); setTourStep(0); setHelpOpen(true); setFloatingAvatarVisible(true); }} style={{
                    padding: "3px 10px", borderRadius: 999, fontSize: 10, fontWeight: 600, fontFamily: F.mono,
                    background: C.glassSurfTrans, border: `1px solid ${C.glassSurfBorder}`, color: C.txT, cursor: "pointer",
                  }}>Tour</button>
                </Tooltip>
              )}
            </div>
          </div>
          {/* Main content scroll container — ref lets us reset scrollTop=0
              every time activeTab changes so a panel always opens at the top.
              Without this, switching from a panel scrolled mid-list back to
              another panel inherited that scroll offset (real complaint on
              Shield Tests 2026-04-25, but the fix is universal). */}
          <div ref={contentScrollRef} style={{ flex: 1, overflow: "auto", padding: 20 }}>
            <BreakGlassBanner />
            {renderPanel()}
          </div>
        </div>

        {/* HELP DRAWER */}
        {helpOpen && (() => {
          const help = PANEL_HELP[activeTab];
          return (
            <div style={{ width: 280, minWidth: 280, background: C.bgS, borderLeft: `1px solid ${C.brd}`, display: "flex", flexDirection: "column", overflowY: "auto", padding: 16 }}>
              {tourMode && (
                <div style={{ marginBottom: 12, padding: "8px 10px", background: `${C.brand}10`, border: `1px solid ${C.brand}33`, borderRadius: 6 }}>
                  <div style={{ fontSize: 10, color: C.brand, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Guided Tour — {tourStep + 1}/{tourTabs.length}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button disabled={tourStep === 0} onClick={() => { const prev = tourStep - 1; setTourStep(prev); setActiveTab(tourTabs[prev]); }} style={{ flex: 1, padding: "4px 8px", fontSize: 11, borderRadius: 4, cursor: tourStep === 0 ? "default" : "pointer", background: "transparent", border: `1px solid ${C.brd}`, color: tourStep === 0 ? C.txT : C.brand }}>Prev</button>
                    <button onClick={() => { if (tourStep < tourTabs.length - 1) { const next = tourStep + 1; setTourStep(next); setActiveTab(tourTabs[next]); } else { setTourMode(false); setHelpOpen(false); } }} style={{ flex: 1, padding: "4px 8px", fontSize: 11, borderRadius: 4, cursor: "pointer", background: `${C.brand}18`, border: `1px solid ${C.brand}`, color: C.brand, fontWeight: 600 }}>{tourStep < tourTabs.length - 1 ? "Next" : "Finish"}</button>
                  </div>
                  <button onClick={() => { setTourMode(false); setHelpOpen(false); }} style={{ marginTop: 6, width: "100%", padding: "3px", fontSize: 10, background: "transparent", border: "none", color: C.txT, cursor: "pointer" }}>Exit Tour</button>
                </div>
              )}
              <div style={{ fontSize: 14, fontWeight: 700, color: C.brand, marginBottom: 8, fontFamily: F.disp }}>{help.title}</div>
              <div style={{ fontSize: 12, color: C.txS, lineHeight: 1.6, marginBottom: 16 }}>{help.desc}</div>
              <div style={{ fontSize: 10, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Key Metrics</div>
              {help.metrics.map((m, i) => { const [label, ...rest] = m.split(" — "); return (<div key={i} style={{ fontSize: 11, color: C.txS, padding: "3px 0", borderBottom: `1px solid ${C.brd}08` }}><span style={{ color: C.cyan, fontWeight: 600, fontFamily: F.mono }}>{label}</span>{rest.length > 0 && <span style={{ color: C.txT }}> — {rest.join(" — ")}</span>}</div>); })}
              <div style={{ fontSize: 10, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 14, marginBottom: 6 }}>Actions</div>
              {help.actions.map((a, i) => (<div key={i} style={{ fontSize: 11, color: C.txS, padding: "3px 0", display: "flex", gap: 6 }}><span style={{ color: C.brand, flexShrink: 0 }}>{"\u2022"}</span><span>{a}</span></div>))}
              <div style={{ fontSize: 10, color: C.txT, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 14, marginBottom: 6 }}>Related Panels</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {help.related.map(r => (<button key={r} onClick={() => { setActiveTab(r); if (tourMode) setTourStep(tourTabs.indexOf(r)); }} style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, fontFamily: F.mono, background: `${C.brand}10`, border: `1px solid ${C.brand}33`, color: C.brand, cursor: "pointer", fontWeight: 600 }}>{PANEL_HELP[r]?.title || r}</button>))}
              </div>
              {!tourMode && (<button onClick={() => setHelpOpen(false)} style={{ marginTop: 20, width: "100%", padding: "6px", fontSize: 11, borderRadius: 4, background: "transparent", border: `1px solid ${C.brd}`, color: C.txT, cursor: "pointer" }}>Close</button>)}
            </div>
          );
        })()}

        {/* RIGHT: AI CHAT */}
        {chatOpen && !demoMode && (
          <div style={{ width: 330, minWidth: 330, borderLeft: `1px solid ${C.brd}`, background: C.bgS }}>
            <ChatPanel onNavigate={navigate} sharedSessionRef={sharedHeygenRef} sharedConnected={sharedHeygenConnected} onSharedConnect={setSharedHeygenConnected} />
          </div>
        )}

        {/* RIGHT: DEMO GUIDE */}
        {demoMode && (
          <div style={{ width: 380, minWidth: 380, borderLeft: `1px solid ${C.brd}`, background: C.bgS }}>
            <DemoGuide onNavigate={navigate} onLoadPayload={(payload) => setDemoPayload(payload)} />
          </div>
        )}
      </div>

      {/* FLOATING AVATAR */}
      <FloatingAvatar
        activeTab={activeTab} tourMode={tourMode} tourStep={tourStep} visible={floatingAvatarVisible}
        onClose={() => { setFloatingAvatarVisible(false); if (tourMode) { setTourMode(false); setHelpOpen(false); } }}
        onTourNext={() => { if (tourStep < tourTabs.length - 1) { const next = tourStep + 1; setTourStep(next); setActiveTab(tourTabs[next]); } else { setTourMode(false); setHelpOpen(false); setFloatingAvatarVisible(false); } }}
        onTourPrev={() => { if (tourStep > 0) { const prev = tourStep - 1; setTourStep(prev); setActiveTab(tourTabs[prev]); } }}
        onTourExit={() => { setTourMode(false); setHelpOpen(false); }}
        onTourRestart={() => { setTourStep(0); setActiveTab(tourTabs[0]); }}
        sharedSessionRef={sharedHeygenRef} sharedConnected={sharedHeygenConnected} onSharedConnect={setSharedHeygenConnected}
      />
    </div>
  );
}

/**
 * Default export. Wraps the dashboard inner component with {@link TooltipsProvider}
 * so every {@link Tooltip} anywhere in the tree can read the global enabled flag
 * and dispatch toggle actions. The provider also handles the initial fetch of
 * `tooltips_enabled` from `config_defaults` on mount.
 */
export default function SentinelDashboard() {
  return (
    <TooltipsProvider>
      <SentinelDashboardInner />
    </TooltipsProvider>
  );
}
