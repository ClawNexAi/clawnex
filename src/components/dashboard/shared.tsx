"use client";

/**
 * Dashboard Shared UI Components — reusable primitives used across all panels.
 *
 * Implements the ClawNex design system with soft-skill treatment:
 * - Spring-physics transitions (cubic-bezier 0.32, 0.72, 0, 1)
 * - Ambient shadow on hover for depth
 * - Subtle inset highlights on cards
 * - Theme-aware (dark + light mode)
 *
 * @module dashboard/shared
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Tooltip } from "./tooltip";
import { C, F, G, blur } from "./constants";

/** Detect light mode by checking if the background color is light. */
function isLightMode(): boolean {
  try { return C.bg.charAt(1) >= 'a'; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Spring-physics transition — used universally
// ---------------------------------------------------------------------------

const spring = "cubic-bezier(0.32, 0.72, 0, 1)";
const springT = (props = "all", ms = 400) => `${props} ${ms}ms ${spring}`;

// ---------------------------------------------------------------------------
// Sticky boolean — useState that persists across reloads via localStorage
// ---------------------------------------------------------------------------
//
// Used for collapse-state preferences ("I never use Hermes, hide it"). Hydrates
// from localStorage on first paint when the key has a stored value, otherwise
// uses the provided default. SSR-safe: localStorage access is guarded by
// `typeof window !== "undefined"`. Storage failures (quota, private mode)
// degrade silently — the component falls back to in-memory state.
//
// Naming convention: prefix keys with `clawnex_` so a single localStorage scan
// can identify ClawNex's own preferences without colliding with other apps.
export function useStickyBoolean(
  storageKey: string,
  defaultValue: boolean,
): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    if (typeof window === "undefined") return defaultValue;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw !== null) return raw === "1";
    } catch { /* ignore */ }
    return defaultValue;
  });
  const setAndPersist = useCallback((next: boolean) => {
    setValue(next);
    try { localStorage.setItem(storageKey, next ? "1" : "0"); } catch { /* ignore */ }
  }, [storageKey]);
  return [value, setAndPersist];
}

// ---------------------------------------------------------------------------
// Status Indicators
// ---------------------------------------------------------------------------

/** Colored dot indicator — used for service status, severity badges, etc. */
export function Dot({ color, size = 8, glow = false, pulse: shouldPulse = false }: { color: string; size?: number; glow?: boolean; pulse?: boolean }) {
  return (
    <span style={{
      display: "inline-block", width: size, height: size, borderRadius: "50%", background: color, flexShrink: 0,
      boxShadow: glow ? `0 0 6px ${color}, 0 0 14px ${color}66, 0 0 24px ${color}22` : undefined,
      ...(shouldPulse ? { animation: "pulseDot 5s ease-in-out infinite" } : {}),
    }} />
  );
}

/**
 * Auto-tooltip lookup for known constrained-vocabulary badges. When a Badge's
 * label matches a known semantic (severity, verdict, integration status,
 * confidence level), wrap it in a Tooltip so operators get a definition on
 * hover without every caller site needing to opt in. Unknown labels render
 * bare — explicit tooltips can still be added by the caller via Phase 1-5
 * style wrapping.
 */
function autoBadgeTip(label: string): React.ReactNode | null {
  const u = label.toUpperCase();
  // Severity ladder (CRITICAL/HIGH/MEDIUM/LOW/INFO) deliberately omitted —
  // operators already understand them and on the row-level density seen in
  // alert/correlation/trust-audit lists they're noise. Aggregate "Overall
  // Severity" surfaces explain themselves explicitly at the call site.
  // Shield verdicts (also matched by VBadge below)
  if (u === "BLOCK") return <span><strong>BLOCK</strong> — shield refused the request. When block-mode is on, returns HTTP 403 to the agent. Always logged.</span>;
  if (u === "REVIEW") return <span><strong>REVIEW</strong> — shield flagged the request but didn&apos;t block. Score landed in the 30–70 band. Worth a human look.</span>;
  if (u === "ALLOW") return <span><strong>ALLOW</strong> — clean. No detections fired, score below 30.</span>;
  if (u === "BYPASSED") return <span><strong>BYPASSED</strong> — request skipped the shield entirely. Only happens during a break-glass window. Surfaces in Audit &amp; Evidence with the operator who triggered it.</span>;
  // Integration / connection status
  if (u === "ROUTED" || u === "LIVE") return <span><strong>{u}</strong> — flowing through ClawNex. Real-time scanning is on for this provider/connector.</span>;
  if (u === "DIRECT") return <span><strong>DIRECT</strong> — bypasses LiteLLM (often OAuth-bound providers like Claude.ai or ChatGPT Pro). Captured retroactively by Session Watcher.</span>;
  if (u === "CONNECTED") return <span><strong>CONNECTED</strong> — handshake succeeded, traffic / events flowing.</span>;
  if (u === "ERROR") return <span><strong>ERROR</strong> — last connection attempt failed. Hover the row for the error message.</span>;
  // Trust audit confidence pills
  if (u === "VERIFIED" || u === "VERIFIED_RUNTIME") return <span><strong>VERIFIED</strong> — confirmed at runtime. Treat as fact.</span>;
  if (u === "CONFIG" || u === "VERIFIED_CONFIG") return <span><strong>CONFIG</strong> — verified against the live config file. High confidence.</span>;
  if (u === "FILESYSTEM" || u === "VERIFIED_FILESYSTEM") return <span><strong>FILESYSTEM</strong> — derived from on-disk file inspection. High confidence.</span>;
  if (u === "INFERRED" || u === "HEURISTIC_INFERENCE") return <span><strong>INFERRED</strong> — advisory hypothesis based on heuristics. Verify before acting.</span>;
  if (u === "UNKNOWN") return <span><strong>UNKNOWN</strong> — at least one input couldn&apos;t be verified. The whole claim collapses to unknown rather than guessing.</span>;
  // Operator-status pills
  if (u === "ACTIVE") return <span><strong>ACTIVE</strong> — account can sign in normally.</span>;
  if (u === "LOCKED") return <span><strong>LOCKED</strong> — too many failed sign-ins, or admin-deactivated. Use Unlock / Activate to restore.</span>;
  return null;
}

/** Text badge with colored background — used for severity, verdict, status labels. */
export function Badge({ label, color, tip }: { label: string; color: string; tip?: React.ReactNode }) {
  const auto = tip === undefined ? autoBadgeTip(label) : null;
  const finalTip = tip !== undefined ? tip : auto;
  const node = (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, fontFamily: F.mono,
      background: `${color}14`, color, border: `1px solid ${color}28`, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap",
      ...blur(8),
      transition: springT("background,border-color", 300),
    }}>
      {label}
    </span>
  );
  if (!finalTip) return node;
  return (
    <Tooltip placement="top" variant="detail" content={<>{finalTip}</>}>
      {node}
    </Tooltip>
  );
}

/** Shield verdict badge — BLOCK (red), REVIEW (amber), ALLOW (green). */
export function VBadge({ verdict }: { verdict: string }) {
  const color = verdict === "BLOCK" ? C.danger : verdict === "REVIEW" ? C.warn : C.green;
  return <Badge label={verdict} color={color} />;
}

/** Refresh indicator showing polling interval. */
export function Fresh({ seconds = 12 }: { seconds?: number }) {
  return <span style={{ fontSize: 13, color: C.txT, fontFamily: F.mono }}>{"\u21BB"}{seconds}s</span>;
}

/** Token rate badge — RUNAWAY (red), ELEVATED (amber), normal (green). */
export function TokenRateBadge({ rate }: { rate: string }) {
  const color = rate === "RUNAWAY" ? C.danger : rate === "ELEVATED" ? C.warn : C.green;
  const tip =
    rate === "RUNAWAY" ? <span><strong>RUNAWAY</strong> — token spend is 5×+ above this agent&apos;s rolling baseline. Likely a stuck loop, prompt-injection-induced infinite generation, or denial-of-wallet attack. Investigate the agent&apos;s most recent session.</span>
    : rate === "ELEVATED" ? <span><strong>ELEVATED</strong> — token spend is 2–5× above baseline. Could be legitimate heavy work, or an early signal of runaway. Worth a glance.</span>
    : <span><strong>Normal</strong> — token spend is within the agent&apos;s expected range.</span>;
  return <Badge label={rate} color={color} tip={tip} />;
}

/** Numeric count badge — used in sidebar nav for alert/shield counts. */
export function CountBadge({ count, color, pulse: shouldPulse }: { count: number; color?: string; pulse?: boolean }) {
  if (count <= 0) return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 16, height: 16, borderRadius: 8,
      fontSize: 13, fontWeight: 700, background: color || C.danger, color: "#fff", padding: "0 4px", marginLeft: 6, fontFamily: F.mono,
      ...(shouldPulse ? { animation: "pulse 5s ease-in-out infinite" } : {}),
    }}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** Inline enterprise pill — small "ENT" badge for tab buttons and labels. */
export function EnterprisePill() {
  return (
    <Tooltip placement="top" variant="detail" content={<span><strong>Enterprise feature</strong> — available in the paid ClawNex tier. The OSS edition shows the placeholder so you know what&apos;s on the roadmap; the actual surface ships with the commercial license.</span>}>
      <span style={{
        fontSize: 8, fontWeight: 700, color: C.purp, background: `${C.purp}18`,
        border: `1px solid ${C.purp}44`, borderRadius: 3, padding: "1px 4px",
        letterSpacing: "0.05em", marginLeft: 4, verticalAlign: "middle",
      }}>ENT</span>
    </Tooltip>
  );
}

/** Enterprise feature card — block-level overlay for gated features. */
export function EnterpriseCard({ feature, description }: { feature: string; description: string }) {
  return (
    <div style={{
      padding: "24px 20px", borderRadius: 10, textAlign: "center",
      background: `linear-gradient(135deg, ${C.srf}, ${C.bg})`,
      border: `1px solid ${C.purp}33`, marginBottom: 12,
    }}>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px",
        background: `${C.purp}18`, border: `1px solid ${C.purp}44`, borderRadius: 20,
        marginBottom: 10,
      }}>
        <span style={{ fontSize: 12 }}>{"\uD83D\uDD12"}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.purp, fontFamily: F.mono, letterSpacing: "0.06em" }}>ENTERPRISE</span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.tx, marginBottom: 6 }}>{feature}</div>
      <div style={{ fontSize: 12, color: C.txT, lineHeight: 1.6, maxWidth: 420, margin: "0 auto" }}>{description}</div>
    </div>
  );
}

/** SLA countdown timer with severity-colored background. */
export function SLATimer({ time, severity }: { time: string; severity: string }) {
  const color = severity === "CRITICAL" ? C.danger : severity === "HIGH" ? C.orange : C.warn;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 4,
      background: `${color}18`, border: `1px solid ${color}33`, fontSize: 14, fontFamily: F.mono, color, fontWeight: 700,
    }}>
      <span style={{ fontSize: 8 }}>{"\u23F1"}</span> {time}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Data Visualization
// ---------------------------------------------------------------------------

/** Horizontal progress bar with auto-coloring based on percentage. */
export function Bar({ value, max = 100, color, h = 6 }: { value: number; max?: number; color?: string; h?: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const barC = color || (pct > 90 ? C.danger : pct > 70 ? C.orange : C.brand);
  return (
    <div style={{ width: "100%", height: h, background: `${C.txG}33`, borderRadius: h / 2, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: barC, borderRadius: h / 2, transition: springT("width", 500) }} />
    </div>
  );
}

/** SVG sparkline chart — mini trend visualization. */
export function Spark({ data, color = C.brand, w = 80, h = 24 }: { data: number[]; color?: string; w?: number; h?: number }) {
  if (!data || data.length < 2) return null;
  const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - mn) / rng) * (h - 4) - 2}`).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Semi-circular gauge — used for threat/posture scores. */
export function Gauge({ value, label, color = C.brand }: { value: number; label: string; color?: string }) {
  const r = 54, cx = 65, cy = 65, strokeW = 10;
  const circumference = Math.PI * r;
  const offset = circumference - (value / 100) * circumference;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg width={130} height={80} viewBox="0 0 130 80">
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke={`${C.txG}33`} strokeWidth={strokeW} strokeLinecap="round" />
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke={color} strokeWidth={strokeW} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset} style={{ transition: `stroke-dashoffset 0.6s ${spring}` }} />
        <text x={cx} y={cy - 10} textAnchor="middle" fill={color} fontSize={28} fontWeight={800} fontFamily={F.mono}>{value}</text>
      </svg>
      <div style={{ fontSize: 13, color: C.txS, marginTop: -4 }}>{label}</div>
    </div>
  );
}

/** Metric stat tile with glass surface + ambient shadow hover. v0.13.0+:
 *  promoted from flat C.srf60/C.brd30 to the canonical glass treatment so
 *  the 8-stat row in InstanceDetail, the KPI rows in Correlations, and
 *  every other panel that uses <Stat> inherits the dashboard-wide glass
 *  aesthetic. Optional `tooltip` renders as a native `title` attribute so
 *  callers can attach source/inclusion/window metadata without restructuring.
 */
export function Stat({ label, value, sub, color, small, tooltip }: { label: string; value: string | number; sub?: string; color?: string; small?: boolean; tooltip?: string }) {
  const isLight = isLightMode();
  return (
    <div
      title={tooltip}
      style={{
      position: "relative",
      overflow: "hidden",
      background: `linear-gradient(180deg, ${C.glassPanelNested}, ${C.glassPanelNested2})`,
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      border: `1px solid ${C.glassBorderCyanStrong}`,
      borderRadius: 12,
      padding: small ? "6px 8px" : "10px 12px",
      flex: 1,
      minWidth: small ? 80 : 90,
      cursor: tooltip ? "help" : undefined,
      transition: springT("border-color,box-shadow,background", 400),
      boxShadow: isLight ? `0 1px 4px rgba(0,0,0,0.06)` : C.glassCardShadow,
    }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = `${color || C.cyan}55`;
        e.currentTarget.style.boxShadow = isLight
          ? `0 2px 12px ${color || C.brand}18`
          : `0 4px 22px ${color || C.cyan}24`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = C.glassBorderCyanStrong;
        e.currentTarget.style.boxShadow = isLight
          ? `0 1px 4px rgba(0,0,0,0.06)`
          : C.glassCardShadow;
      }}
    >
      {/* Subtle radial-glow overlay — same MC-signature treatment, lighter
          than the Card variant since Stat tiles are smaller and a strong
          glow would dominate the value digits. Skipped in light mode. */}
      {!isLight && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(circle at 10% 0%, rgba(34,211,238,.06), transparent 36%)",
            pointerEvents: "none",
          }}
        />
      )}
      <div style={{ position: "relative" }}>
        <div style={{ fontSize: 9, color: C.txT, marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: F.sans, fontWeight: 600, whiteSpace: "nowrap" }}>{label}</div>
        <div style={{ fontSize: small ? 16 : 20, fontWeight: 700, color: color || C.brand, fontFamily: F.mono, lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: C.txS, marginTop: 2, fontFamily: F.mono }}>{sub}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

/** Glassmorphism card with inset highlight, radial-glow overlay, and ambient
 *  shadow hover. v0.13.0+: borderRadius bumped from 10 → 14 to match the
 *  glass design language; an absolutely-positioned radial-glow overlay sits
 *  behind content for the MC-signature depth effect. Children are rendered
 *  in a position:relative wrapper so the glow doesn't intercept clicks. */
export function Card({ title, accent, children, actions, glow, dimGlow }: { title: string; accent?: string; children: React.ReactNode; actions?: React.ReactNode; glow?: string; dimGlow?: boolean }) {
  // dimGlow: opt-in dampening for full-width cards that read brighter than peers
  // (internal reviewer 2026-05-06 design-consistency P3: TrafficMonitor full-width cards).
  const accentGlow = accent ? G.glow(accent, dimGlow ? 0.035 : 0.08) : undefined;
  const isLight = isLightMode();
  const inset = isLight
    ? `inset 0 1px 0 rgba(255,255,255,0.5)`
    : `inset 0 1px 0 rgba(255,255,255,0.04)`;

  return (
    <div style={{
      ...G.card,
      position: "relative",
      overflow: "hidden",
      borderRadius: 14,
      padding: "16px 18px",
      marginBottom: 12,
      boxShadow: glow
        ? `0 0 24px ${glow}18, ${inset}`
        : `${accentGlow || (isLight ? "0 1px 6px rgba(0,0,0,0.06)" : "0 2px 12px rgba(0,0,0,0.12)")}, ${inset}`,
      transition: springT("box-shadow,background,border-color", 400),
    }}
      onMouseEnter={e => {
        if (!glow) e.currentTarget.style.boxShadow = `${isLight ? "0 3px 16px rgba(0,0,0,0.08)" : "0 4px 20px rgba(0,0,0,0.18)"}, ${inset}`;
      }}
      onMouseLeave={e => {
        if (!glow) e.currentTarget.style.boxShadow = `${accentGlow || (isLight ? "0 1px 6px rgba(0,0,0,0.06)" : "0 2px 12px rgba(0,0,0,0.12)")}, ${inset}`;
      }}
    >
      {/* Radial-glow overlay — MC's signature depth treatment. Skip in light mode where it muddies the surface. */}
      {!isLight && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(circle at 10% 0%, rgba(34,211,238,${dimGlow ? ".05" : ".10"}), transparent 36%)`,
            pointerEvents: "none",
          }}
        />
      )}
      <div style={{ position: "relative" }}>
        {accent && <div style={{ height: 2, width: 40, background: accent, borderRadius: 1, marginBottom: 12, boxShadow: `0 0 8px ${accent}${dimGlow ? "22" : "44"}` }} />}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: C.tx, fontFamily: F.sans, textTransform: "uppercase", letterSpacing: "0.08em" }}>{title}</h3>
          {actions}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Collapsible card with spring-animated expand/collapse.
 *  When `focusKey` matches `focusedCard`, the card auto-expands and scrolls into view —
 *  used by the Welcome Wizard to jump directly to a specific Configuration section.
 *
 *  When `storageKey` is provided, the open/closed state persists across reloads
 *  via localStorage. Use this for cards an operator may want to permanently
 *  collapse out of view (e.g. integrations they don't use). When `storageKey`
 *  is omitted, the card behaves as before — open/closed is in-memory only. */
export function CollapsibleCard({ title, accent, children, actions, glow, defaultOpen = true, count, focusKey, focusedCard, storageKey, dimGlow }: {
  title: React.ReactNode; accent?: string; children: React.ReactNode; actions?: React.ReactNode; glow?: string;
  defaultOpen?: boolean; count?: number;
  focusKey?: string; focusedCard?: string | null;
  storageKey?: string;
  // Per internal reviewer 2026-05-06 design-consistency P3: opt-in dampening for accented
  // cards that read louder than peers (e.g. lower CveCard with danger accent).
  // Cuts ambient accent shadow + accent-bar glow roughly in half.
  dimGlow?: boolean;
}) {
  // Two paths: persistent (when storageKey is given) or transient. Hooks
  // must be called unconditionally, so we always call useStickyBoolean and
  // pick which state to use afterward. The transient path uses an unstable
  // ad-hoc key that's never read elsewhere, so it costs only one localStorage
  // write per toggle on cards without a real key — acceptable.
  const [stickyOpen, setStickyOpen] = useStickyBoolean(
    storageKey ? `clawnex_card_${storageKey}` : "clawnex_card__transient__",
    defaultOpen,
  );
  const [transientOpen, setTransientOpen] = useState(defaultOpen);
  const open = storageKey ? stickyOpen : transientOpen;
  const setOpen = storageKey ? setStickyOpen : setTransientOpen;

  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // focusedCard may carry a "#timestamp" suffix so repeat clicks re-trigger the effect.
    const base = focusedCard ? focusedCard.split("#")[0] : null;
    if (focusKey && base === focusKey) {
      setOpen(true);
      const t = setTimeout(() => {
        try { ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch {}
      }, 150);
      return () => clearTimeout(t);
    }
    // setOpen is intentionally excluded — including it would re-run the effect
    // every render since the sticky setter is rebuilt each call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedCard, focusKey]);
  const accentGlow = accent ? G.glow(accent, dimGlow ? 0.035 : 0.08) : undefined;
  const isLight = isLightMode();
  const inset = isLight
    ? `inset 0 1px 0 rgba(255,255,255,0.5)`
    : `inset 0 1px 0 rgba(255,255,255,0.04)`;

  return (
    <div ref={ref} style={{
      ...G.card,
      position: "relative",
      overflow: "hidden",
      borderRadius: 14,
      padding: open ? "12px 18px" : "10px 18px",
      marginBottom: open ? 12 : 6,
      boxShadow: glow
        ? `0 0 24px ${glow}18, ${inset}`
        : `${accentGlow || (isLight ? "0 1px 6px rgba(0,0,0,0.06)" : "0 2px 12px rgba(0,0,0,0.12)")}, ${inset}`,
      transition: springT("box-shadow,background,border-color,padding,margin", 400),
    }}>
      {/* Radial-glow overlay for the canonical glass treatment. Light mode skips it.
          dimGlow drops cyan radial from .10 to .05 — keeps the texture, kills the loud. */}
      {!isLight && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(circle at 10% 0%, rgba(34,211,238,${dimGlow ? ".05" : ".10"}), transparent 36%)`,
            pointerEvents: "none",
          }}
        />
      )}
      <div style={{ position: "relative" }}>
        {accent && <div style={{ height: 2, width: 40, background: accent, borderRadius: 1, marginBottom: open ? 10 : 6, boxShadow: `0 0 8px ${accent}${dimGlow ? "22" : "44"}` }} />}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: open ? 12 : 0, cursor: "pointer" }} onClick={() => setOpen(!open)}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, color: C.txT, transition: springT("transform", 300), display: "inline-block", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>{"\u25B6"}</span>
            <h3 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: C.tx, fontFamily: F.sans, textTransform: "uppercase", letterSpacing: "0.08em" }}>{title}</h3>
            {/* internal reviewer 2026-05-06 contrast: card-row count is dense metadata
                operators scan — lift from 10/txT to 12/txS per T.meta. */}
            {count !== undefined && <span style={{ fontSize: 12, color: C.txS, fontFamily: F.mono }}>({count})</span>}
          </div>
          {actions}
        </div>
        {open && children}
      </div>
    </div>
  );
}

/** CategorySection — collapsible super-container for grouping CollapsibleCards.
 *
 *  Used by the Configuration panel to cut a 24-card flat scroll into 6 named
 *  groups (AI & MODELS, FLEET & ROUTING, SHIELD, ACCESS CONTROL, INTEGRATIONS,
 *  SYSTEM). Visually heavier than a CollapsibleCard so the nesting is obvious —
 *  bigger heading, accent-tinted background band, clear indent for children.
 *
 *  Default state: COLLAPSED. First-load view is just the 6 group headers.
 *  Operator's expand/collapse choice persists per-category in localStorage at
 *  `clawnex_cat_<storageKey>`.
 *
 *  Deep-link behavior: `focusCard` is the currently-focused card key (from
 *  Welcome Wizard, panel jumps, etc.) and `focusKeys` lists the card keys this
 *  category contains. If focusCard matches any of them, the category auto-
 *  expands so the deep-linked card is visible — same semantics as CollapsibleCard.
 *
 *  operator-approved 2026-04-24. */
export function CategorySection({
  title,
  accent,
  storageKey,
  focusCard,
  focusKeys = [],
  children,
}: {
  title: string;
  accent?: string;
  storageKey: string;
  focusCard?: string | null;
  focusKeys?: string[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const raw = localStorage.getItem(`clawnex_cat_${storageKey}`);
      if (raw !== null) return raw === "1";
    } catch { /* ignore */ }
    return false;
  });

  // Auto-expand when a deep-link targets any card inside this category.
  // Strips the "#timestamp" suffix (same pattern as CollapsibleCard) so
  // repeat-clicks on the same deep link re-trigger the expand effect.
  useEffect(() => {
    if (!focusCard) return;
    const base = focusCard.split("#")[0];
    if (focusKeys.includes(base)) {
      setOpen(true);
      try { localStorage.setItem(`clawnex_cat_${storageKey}`, "1"); } catch { /* ignore */ }
    }
  }, [focusCard, focusKeys, storageKey]);

  const toggle = useCallback(() => {
    setOpen(prev => {
      const next = !prev;
      try { localStorage.setItem(`clawnex_cat_${storageKey}`, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, [storageKey]);

  const tint = accent || C.brd;

  return (
    <div style={{ marginBottom: open ? 4 : 0 }}>
      <div
        onClick={toggle}
        style={{
          cursor: "pointer",
          padding: "12px 16px",
          background: `${tint}0d`,
          border: `1px solid ${tint}33`,
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          gap: 12,
          transition: springT("background,border-color", 300),
        }}
      >
        <span
          style={{
            fontSize: 12,
            color: tint,
            transition: springT("transform", 300),
            display: "inline-block",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
          }}
        >
          {"▶"}
        </span>
        <h2
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 800,
            color: tint,
            fontFamily: F.sans,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
          }}
        >
          {title}
        </h2>
      </div>
      {open && (
        <div style={{ paddingLeft: 16, paddingTop: 10 }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data Display
// ---------------------------------------------------------------------------

/** Styled data table with spring-physics row hover. */
export function Table({ headers, rows }: { headers: React.ReactNode[]; rows: React.ReactNode[][] }) {
  const isLight = isLightMode();
  const hoverBg = isLight ? "rgba(0,200,137,0.06)" : "rgba(0,229,160,0.04)";
  const altBg = isLight ? "rgba(0,0,0,0.02)" : "rgba(16,29,52,0.25)";

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{ textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.06)"}`, color: C.txT, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: F.sans }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ borderBottom: `1px solid ${isLight ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.03)"}`, background: ri % 2 === 1 ? altBg : "transparent", transition: springT("background", 250) }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = hoverBg; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ri % 2 === 1 ? altBg : "transparent"; }}
            >
              {row.map((cell, ci) => (
                <td key={ci} style={{ padding: "8px 10px", color: C.tx, fontFamily: F.mono, fontSize: 13 }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/**
 * Standard pagination footer — operator directive 2026-05-05: any panel with
 * more than 5 rows auto-paginates. Default page size 5; options
 * [5, 10, 15, 25, 50]; prev/next chevrons. The caller is responsible for
 * gating the render on `totalPages > 1` (this footer assumes there's
 * something to paginate). Mirrors the styling used historically inline in
 * AuditEvidencePanel + Cost By Session — extracted here so 8+ tables
 * across the dashboard share one source of truth.
 *
 * Usage:
 *   const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
 *   const paged = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
 *   useEffect(() => setCurrentPage(0), [...filterDeps, pageSize]);
 *   ...
 *   {totalPages > 1 && <PaginationFooter
 *     currentPage={currentPage} totalPages={totalPages}
 *     pageSize={pageSize} onPageSizeChange={setPageSize}
 *     onPageChange={setCurrentPage} totalRows={filtered.length}
 *   />}
 */
export function PaginationFooter({
  currentPage,
  totalPages,
  pageSize,
  totalRows,
  onPageSizeChange,
  onPageChange,
  pageSizeOptions = [5, 10, 15, 25, 50],
}: {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalRows: number;
  onPageSizeChange: (n: number) => void;
  onPageChange: (n: number) => void;
  pageSizeOptions?: number[];
}) {
  const atFirst = currentPage === 0;
  const atLast = currentPage >= totalPages - 1;
  // internal reviewer 2026-05-06 contrast rule applied: dense metadata = 12px / C.txS (T.meta).
  // Disabled-state buttons stay at C.txG since "disabled" is a non-decision-bearing
  // state per the reviewer's exception ("decorative, disabled, or non-critical labels OK").
  const btnStyle = (disabled: boolean) => ({
    padding: "3px 8px",
    borderRadius: 3,
    border: `1px solid ${C.brd}`,
    background: "transparent",
    color: disabled ? C.txG : C.txS,
    fontSize: 12,
    fontFamily: F.mono,
    cursor: disabled ? ("not-allowed" as const) : ("pointer" as const),
  });
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 6px", borderTop: `1px solid ${C.brd}`, fontSize: 12, color: C.txS, fontFamily: F.mono, marginTop: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span>Rows:</span>
        <select
          value={String(pageSize)}
          onChange={e => onPageSizeChange(parseInt(e.target.value))}
          style={{ fontSize: 12, padding: "2px 6px", background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 3, color: C.txS, fontFamily: F.mono, cursor: "pointer", outline: "none" }}
        >
          {pageSizeOptions.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ marginRight: 8 }}>Page {currentPage + 1} of {totalPages} ({totalRows} total)</span>
        <button onClick={() => onPageChange(0)} disabled={atFirst} style={btnStyle(atFirst)}>{"«"}</button>
        <button onClick={() => onPageChange(Math.max(0, currentPage - 1))} disabled={atFirst} style={btnStyle(atFirst)}>{"‹"} Prev</button>
        <button onClick={() => onPageChange(Math.min(totalPages - 1, currentPage + 1))} disabled={atLast} style={btnStyle(atLast)}>Next {"›"}</button>
        <button onClick={() => onPageChange(totalPages - 1)} disabled={atLast} style={btnStyle(atLast)}>{"»"}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading & Empty States
// ---------------------------------------------------------------------------

/** Centered loading spinner with brand-colored animation. */
export function LoadingSpinner() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 48, gap: 12 }}>
      <div style={{ width: 24, height: 24, border: `2px solid ${C.brd}`, borderTop: `2px solid ${C.brand}`, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <span style={{ color: C.brand, fontFamily: F.mono, fontSize: 12, letterSpacing: "0.05em" }}>Loading...</span>
    </div>
  );
}

/** Empty state placeholder with spring-animated action button. */
export function EmptyState({ message, icon, action }: { message: string; icon?: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 48, gap: 8 }}>
      {icon && <span style={{ fontSize: 28, opacity: 0.5 }}>{icon}</span>}
      {/* internal reviewer 2026-05-06 contrast: empty-state body copy is decision-bearing
          (operator reads it to know what to do next) — lift txT → txS. */}
      <span style={{ color: C.txS, fontSize: 13, fontFamily: F.sans, textAlign: "center", maxWidth: 320, lineHeight: 1.5 }}>{message}</span>
      {action && (
        <button onClick={action.onClick} style={{
          marginTop: 8, padding: "6px 16px", background: `${C.brand}18`, border: `1px solid ${C.brand}44`,
          borderRadius: 6, color: C.brand, fontSize: 12, fontWeight: 600, fontFamily: F.sans, cursor: "pointer",
          transition: springT("background,transform,box-shadow", 300),
        }}
          onMouseEnter={e => { e.currentTarget.style.background = `${C.brand}28`; e.currentTarget.style.transform = "scale(1.02)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = `${C.brand}18`; e.currentTarget.style.transform = "scale(1)"; }}
          onMouseDown={e => { e.currentTarget.style.transform = "scale(0.98)"; }}
          onMouseUp={e => { e.currentTarget.style.transform = "scale(1.02)"; }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel Data-State Primitives (Task 7 foundation)
//
// Reusable components + hook for honest per-panel state signalling. Every
// panel can be in exactly one of the states below; these primitives let each
// panel render the correct affordance (loader, empty card, error card,
// staleness badge, retry button) without duplicating boilerplate.
// ---------------------------------------------------------------------------

/**
 * PanelDataState — the finite set of states a dashboard panel can be in.
 *
 * - `idle`             — initial, not yet started
 * - `loading`          — first load in progress (no data yet)
 * - `refreshing`       — has data, fetching newer data
 * - `ready`            — has data, no active fetch, fresh
 * - `empty`            — successful response, zero results
 * - `stale`            — data present but older than the staleness threshold
 * - `disconnected`     — network/server unreachable
 * - `error`            — request failed with a non-network error
 * - `action_required`  — user intervention needed (e.g. run audit first)
 */
export type PanelDataState =
  | "idle"
  | "loading"
  | "refreshing"
  | "ready"
  | "empty"
  | "stale"
  | "disconnected"
  | "error"
  | "action_required";

/**
 * isStale — returns true if `lastUpdated` is older than `maxAgeMs`.
 *
 * Returns `false` for null/undefined/invalid inputs (we don't mark data as
 * stale when we have no timestamp to compare against).
 */
export function isStale(lastUpdated: string | Date | null | undefined, maxAgeMs: number): boolean {
  if (lastUpdated === null || lastUpdated === undefined) return false;
  const d = lastUpdated instanceof Date ? lastUpdated : new Date(lastUpdated);
  const t = d.getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t > maxAgeMs;
}

/**
 * formatTimeAgo — returns a human string describing how long ago `timestamp`
 * occurred ("just now", "2 minutes ago", "3 hours ago", "2 days ago").
 *
 * Returns `"never"` for null/undefined/invalid inputs.
 */
export function formatTimeAgo(timestamp: string | Date | null | undefined): string {
  if (timestamp === null || timestamp === undefined) return "never";
  const d = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const t = d.getTime();
  if (Number.isNaN(t)) return "never";
  const diff = Math.max(0, Date.now() - t);
  const sec = Math.floor(diff / 1000);
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec} second${sec === 1 ? "" : "s"} ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon} month${mon === 1 ? "" : "s"} ago`;
  const yr = Math.floor(day / 365);
  return `${yr} year${yr === 1 ? "" : "s"} ago`;
}

/** Internal: map a PanelDataState to its indicator color + default label. */
function panelStateVisuals(state: PanelDataState, lastUpdated?: string | Date | null): { color: string; label: string } {
  switch (state) {
    case "ready":
      return { color: C.green, label: lastUpdated ? `Updated ${formatTimeAgo(lastUpdated)}` : "Ready" };
    case "refreshing":
      return { color: C.warn, label: "Refreshing..." };
    case "stale":
      return { color: C.warn, label: lastUpdated ? `Stale - last updated ${formatTimeAgo(lastUpdated)}` : "Stale" };
    case "loading":
      return { color: C.txT, label: "Loading..." };
    case "idle":
      return { color: C.txT, label: "Idle" };
    case "empty":
      return { color: C.txT, label: "No data" };
    case "disconnected":
      return { color: C.danger, label: "Backend disconnected" };
    case "error":
      return { color: C.danger, label: "Error" };
    case "action_required":
      return { color: C.info, label: "Action required" };
    default:
      return { color: C.txT, label: "Unknown" };
  }
}

/**
 * PanelStateBar — compact inline status indicator for panel headers.
 *
 * Renders a color-coded dot, a one-line status label (e.g. "Updated 2 minutes
 * ago", "Refreshing...", "Backend disconnected"), and an optional refresh
 * icon button. Style matches the existing dashboard aesthetic (11px uppercase
 * tracked labels, low-contrast secondary text, glass-friendly color tokens).
 */
export function PanelStateBar({
  state,
  lastUpdated,
  onRefresh,
  customLabel,
  errorMessage,
}: {
  state: PanelDataState;
  lastUpdated?: string | Date | null;
  onRefresh?: () => void;
  customLabel?: string;
  errorMessage?: string;
}): JSX.Element {
  const { color, label } = panelStateVisuals(state, lastUpdated);
  const shown = customLabel
    ? customLabel
    : (state === "error" || state === "disconnected") && errorMessage
      ? errorMessage
      : label;
  const pulse = state === "loading" || state === "refreshing";
  const refreshing = state === "refreshing" || state === "loading";

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em",
      fontFamily: F.sans, color: C.txS, fontWeight: 600,
      whiteSpace: "nowrap",
    }}>
      <Dot color={color} size={8} pulse={pulse} glow={state === "ready"} />
      <span style={{ color: state === "error" || state === "disconnected" ? color : C.txS }}>{shown}</span>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh panel data"
          title="Refresh"
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 20, height: 20, padding: 0, marginLeft: 2,
            background: "transparent", border: `1px solid ${C.brd}`, borderRadius: 4,
            color: C.txS, cursor: refreshing ? "default" : "pointer",
            fontFamily: F.mono, fontSize: 11, lineHeight: 1,
            opacity: refreshing ? 0.4 : 1,
            transition: springT("background,border-color,color,transform", 250),
          }}
          onMouseEnter={e => {
            if (refreshing) return;
            e.currentTarget.style.background = `${C.brand}18`;
            e.currentTarget.style.borderColor = `${C.brand}55`;
            e.currentTarget.style.color = C.brand;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = C.brd;
            e.currentTarget.style.color = C.txS;
          }}
        >
          <span style={{ display: "inline-block", animation: refreshing ? "spin 0.8s linear infinite" : undefined }}>{"↻"}</span>
        </button>
      )}
    </span>
  );
}

/**
 * PanelEmptyState — centered card shown when a panel has no data yet.
 *
 * Use this for "first run" states like Trust Audit before any audit has been
 * executed. Provides a title, description, optional icon/emoji, and an
 * optional CTA button to kick off the required action.
 */
export function PanelEmptyState({
  title,
  description,
  icon,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  icon?: string;
  actionLabel?: string;
  onAction?: () => void;
}): JSX.Element {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "40px 24px", gap: 10, textAlign: "center",
    }}>
      {icon && <span style={{ fontSize: 32, opacity: 0.6, marginBottom: 2 }}>{icon}</span>}
      <div style={{
        fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: F.sans,
        fontWeight: 700, color: C.tx,
      }}>{title}</div>
      <div style={{
        fontSize: 13, color: C.txS, fontFamily: F.sans, lineHeight: 1.55, maxWidth: 420,
      }}>{description}</div>
      {actionLabel && onAction && (
        <button onClick={onAction} style={{
          marginTop: 10, padding: "8px 18px",
          background: `${C.brand}18`, border: `1px solid ${C.brand}44`, borderRadius: 6,
          color: C.brand, fontSize: 12, fontWeight: 600, fontFamily: F.sans, cursor: "pointer",
          textTransform: "uppercase", letterSpacing: "0.06em",
          transition: springT("background,transform,box-shadow", 300),
        }}
          onMouseEnter={e => { e.currentTarget.style.background = `${C.brand}28`; e.currentTarget.style.transform = "scale(1.02)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = `${C.brand}18`; e.currentTarget.style.transform = "scale(1)"; }}
          onMouseDown={e => { e.currentTarget.style.transform = "scale(0.98)"; }}
          onMouseUp={e => { e.currentTarget.style.transform = "scale(1.02)"; }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/**
 * PanelErrorState — centered error card with optional retry + remediation hint.
 *
 * Use this when a panel's fetch failed with a non-network error. For network
 * failures, prefer {@link PanelDisconnected} which is specialized for the
 * unreachable-backend case.
 */
export function PanelErrorState({
  title,
  error,
  onRetry,
  hint,
}: {
  title?: string;
  error: string | Error;
  onRetry?: () => void;
  hint?: string;
}): JSX.Element {
  const msg = error instanceof Error ? error.message : error;
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "32px 24px", gap: 10, textAlign: "center",
      background: `${C.danger}0c`, border: `1px solid ${C.danger}33`, borderRadius: 8,
    }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <Dot color={C.danger} size={8} glow />
        <span style={{
          fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: F.sans,
          fontWeight: 700, color: C.danger,
        }}>{title || "Error"}</span>
      </div>
      <div style={{
        fontSize: 13, color: C.tx, fontFamily: F.mono, lineHeight: 1.5, maxWidth: 480,
        wordBreak: "break-word",
      }}>{msg}</div>
      {hint && (
        <div style={{
          fontSize: 12, color: C.txS, fontFamily: F.sans, lineHeight: 1.5, maxWidth: 480,
        }}>{hint}</div>
      )}
      {onRetry && (
        <button onClick={onRetry} style={{
          marginTop: 6, padding: "6px 16px",
          background: `${C.danger}18`, border: `1px solid ${C.danger}44`, borderRadius: 6,
          color: C.danger, fontSize: 12, fontWeight: 600, fontFamily: F.sans, cursor: "pointer",
          textTransform: "uppercase", letterSpacing: "0.06em",
          transition: springT("background,transform", 300),
        }}
          onMouseEnter={e => { e.currentTarget.style.background = `${C.danger}28`; e.currentTarget.style.transform = "scale(1.02)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = `${C.danger}18`; e.currentTarget.style.transform = "scale(1)"; }}
          onMouseDown={e => { e.currentTarget.style.transform = "scale(0.98)"; }}
          onMouseUp={e => { e.currentTarget.style.transform = "scale(1.02)"; }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * PanelDisconnected — centered "backend unreachable" card with retry button.
 *
 * Specialized for network failures where the backend couldn't be reached at
 * all (as opposed to reached-but-errored, which should use
 * {@link PanelErrorState}). Optionally shows the last successful fetch time.
 */
export function PanelDisconnected({
  onRetry,
  lastSeen,
}: {
  onRetry?: () => void;
  lastSeen?: string | Date | null;
}): JSX.Element {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "32px 24px", gap: 10, textAlign: "center",
      background: `${C.danger}0c`, border: `1px solid ${C.danger}33`, borderRadius: 8,
    }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <Dot color={C.danger} size={8} pulse />
        <span style={{
          fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: F.sans,
          fontWeight: 700, color: C.danger,
        }}>Backend unreachable</span>
      </div>
      <div style={{
        fontSize: 13, color: C.tx, fontFamily: F.sans, lineHeight: 1.5, maxWidth: 420,
      }}>Couldn't reach the ClawNex backend. Check that the server is running and your network is connected.</div>
      {lastSeen && (
        <div style={{
          fontSize: 11, color: C.txT, fontFamily: F.mono, textTransform: "uppercase", letterSpacing: "0.06em",
        }}>Last successful data: {formatTimeAgo(lastSeen)}</div>
      )}
      {onRetry && (
        <button onClick={onRetry} style={{
          marginTop: 6, padding: "6px 16px",
          background: `${C.danger}18`, border: `1px solid ${C.danger}44`, borderRadius: 6,
          color: C.danger, fontSize: 12, fontWeight: 600, fontFamily: F.sans, cursor: "pointer",
          textTransform: "uppercase", letterSpacing: "0.06em",
          transition: springT("background,transform", 300),
        }}
          onMouseEnter={e => { e.currentTarget.style.background = `${C.danger}28`; e.currentTarget.style.transform = "scale(1.02)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = `${C.danger}18`; e.currentTarget.style.transform = "scale(1)"; }}
          onMouseDown={e => { e.currentTarget.style.transform = "scale(0.98)"; }}
          onMouseUp={e => { e.currentTarget.style.transform = "scale(1.02)"; }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

/** Internal: heuristic check for whether an error looks like a network failure. */
function isNetworkError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof TypeError) return true; // fetch() throws TypeError on network failure
  const msg = err instanceof Error ? err.message : String(err);
  return /network|failed to fetch|load failed|connection refused|econnrefused|timeout|offline|unreachable/i.test(msg);
}

/**
 * useDataState — React hook that manages a panel's fetch lifecycle and state.
 *
 * Runs `fetcher` on mount, tracks the PanelDataState transition (idle ->
 * loading -> ready/empty/error/disconnected; subsequent refreshes use
 * refreshing), exposes an explicit `refresh()` trigger, marks data as
 * `stale` once it's older than `staleAfterMs` (default 60s), and optionally
 * auto-refreshes on `refreshIntervalMs`.
 *
 * Dependency-free — uses only React primitives and browser fetch semantics.
 */
export function useDataState<T>(opts: {
  fetcher: () => Promise<T>;
  initialData?: T | null;
  staleAfterMs?: number;
  refreshIntervalMs?: number;
}): {
  data: T | null;
  state: PanelDataState;
  lastUpdated: Date | null;
  error: Error | null;
  refresh: () => void;
} {
  const { fetcher, initialData = null, staleAfterMs = 60_000, refreshIntervalMs } = opts;
  const [data, setData] = useState<T | null>(initialData);
  const [state, setState] = useState<PanelDataState>(initialData !== null && initialData !== undefined ? "ready" : "idle");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [stalenessTick, setStalenessTick] = useState(0);

  // Keep latest fetcher in a ref so refresh() doesn't re-create every render.
  const fetcherRef = useRef(fetcher);
  useEffect(() => { fetcherRef.current = fetcher; }, [fetcher]);

  // Track mounted state so async completions don't setState after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const hasDataRef = useRef<boolean>(initialData !== null && initialData !== undefined);

  const refresh = useCallback(() => {
    setState(hasDataRef.current ? "refreshing" : "loading");
    setError(null);
    fetcherRef.current()
      .then(result => {
        if (!mountedRef.current) return;
        setData(result);
        hasDataRef.current = true;
        setLastUpdated(new Date());
        const isEmpty = result === null
          || result === undefined
          || (Array.isArray(result) && result.length === 0);
        setState(isEmpty ? "empty" : "ready");
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setState(isNetworkError(err) ? "disconnected" : "error");
      });
  }, []);

  // Initial load.
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Optional auto-refresh.
  useEffect(() => {
    if (!refreshIntervalMs || refreshIntervalMs <= 0) return;
    const id = setInterval(() => { refresh(); }, refreshIntervalMs);
    return () => clearInterval(id);
  }, [refreshIntervalMs, refresh]);

  // Staleness watcher — transition ready -> stale after staleAfterMs.
  useEffect(() => {
    if (state !== "ready" || !lastUpdated || !staleAfterMs || staleAfterMs <= 0) return;
    const age = Date.now() - lastUpdated.getTime();
    const remaining = staleAfterMs - age;
    if (remaining <= 0) {
      setState("stale");
      return;
    }
    const id = setTimeout(() => {
      if (mountedRef.current) setStalenessTick(n => n + 1);
    }, remaining + 50);
    return () => clearTimeout(id);
  }, [state, lastUpdated, staleAfterMs, stalenessTick]);

  // Re-evaluate staleness on tick.
  useEffect(() => {
    if (state === "ready" && isStale(lastUpdated, staleAfterMs)) {
      setState("stale");
    }
  }, [stalenessTick, state, lastUpdated, staleAfterMs]);

  return { data, state, lastUpdated, error, refresh };
}
