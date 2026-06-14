"use client";

/**
 * ClawNex Tooltip System — global, accessible, visually cohesive.
 *
 * Usage:
 *   <Tooltip content="Hover text here" placement="top">
 *     <span>Anchor content</span>
 *   </Tooltip>
 *
 * Architecture:
 * - {@link TooltipsProvider} wraps the dashboard and fetches the persisted
 *   `tooltips_enabled` flag from `config_defaults`. When OFF, every <Tooltip>
 *   becomes a pass-through — no event listeners, no extra DOM, no portal work.
 * - The {@link Tooltip} component wraps its children in a span, listens for
 *   mouseenter/focus to show (after a configurable delay) and mouseleave/blur
 *   to hide immediately. Content renders through `createPortal` into the
 *   `#clawnex-tooltip-root` div defined in `src/app/layout.tsx`, so parent
 *   `overflow: hidden` containers never clip it.
 * - A module-level `activeTooltipBus` tracks the currently visible tooltip;
 *   opening a new one dismisses any predecessor. Prevents multi-tooltip clutter.
 * - Visual design matches the rest of the dashboard: glass blur + cyan hairline
 *   border + 2px accent bar at the top (same language as CollapsibleCard), with
 *   a spring-physics entry animation and a small arrow pointing at the anchor.
 * - Edge detection: if the tooltip would overflow the viewport in the requested
 *   direction, it flips to the opposite side automatically.
 *
 * Accessibility:
 * - Anchor receives `aria-describedby` pointing at the tooltip's generated id.
 * - Tooltip content has `role="tooltip"` and `pointer-events: none` so clicks
 *   still reach the anchor underneath.
 * - Keyboard focus on the anchor shows the tooltip; Escape or blur hides it.
 * - Respects `prefers-reduced-motion` — disables scale animation for users who
 *   opt out.
 *
 * @module dashboard/tooltip
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { C, F, blur } from "./constants";

// Light-mode detection — mirrors the helper in shared.tsx. A local inline copy
// avoids cross-module coupling and keeps tooltip.tsx independently importable.
function isLightMode(): boolean {
  try { return C.bg.charAt(1) >= "a"; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Global enabled-state context
// ---------------------------------------------------------------------------

interface TooltipsContextValue {
  /** True when tooltips should render. False = every Tooltip becomes a pass-through. */
  enabled: boolean;
  /** Setter used by the header toggle button. Persists to config_defaults. */
  setEnabled: (next: boolean) => void;
  /** True while the initial fetch is in flight. Prevents premature render decisions. */
  loaded: boolean;
}

const TooltipsContext = createContext<TooltipsContextValue>({
  enabled: true,
  setEnabled: () => { /* no-op default */ },
  loaded: false,
});

/**
 * Provider that loads the persisted `tooltips_enabled` flag from
 * `config_defaults` and exposes it to every {@link Tooltip} + the
 * header toggle button. Mount once at the dashboard root.
 */
export function TooltipsProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState<boolean>(true);
  const [loaded, setLoaded] = useState<boolean>(false);

  // Initial load — defaults to ON if the key isn't present.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/config/defaults");
        if (!res.ok) return;
        const data = await res.json();
        const flag = data?.settings?.tooltips_enabled;
        if (cancelled) return;
        // Default ON — only explicit "0" or "false" disables.
        setEnabledState(flag !== "0" && flag !== "false");
      } catch { /* silent — default ON */ }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Toggle handler — writes back to config_defaults and updates state.
  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    // Fire-and-forget; don't block the UI on the write.
    void fetch("/api/config/defaults", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "tooltips_enabled", value: next ? "1" : "0" }),
    }).catch(() => { /* silent — local state wins either way */ });
  }, []);

  const value = useMemo(() => ({ enabled, setEnabled, loaded }), [enabled, setEnabled, loaded]);
  return <TooltipsContext.Provider value={value}>{children}</TooltipsContext.Provider>;
}

/** Hook for reading/writing the global tooltips-enabled flag. */
export function useTooltipsEnabled(): TooltipsContextValue {
  return useContext(TooltipsContext);
}

// ---------------------------------------------------------------------------
// Active-tooltip event bus (module-level, ensures only one shows at a time)
// ---------------------------------------------------------------------------

type BusListener = (activeId: string | null) => void;
const busListeners = new Set<BusListener>();
let activeTooltipId: string | null = null;

function setActiveTooltipId(next: string | null) {
  activeTooltipId = next;
  busListeners.forEach(l => l(next));
}

function subscribeToActiveTooltip(listener: BusListener): () => void {
  busListeners.add(listener);
  return () => { busListeners.delete(listener); };
}

// ---------------------------------------------------------------------------
// Placement + edge detection
// ---------------------------------------------------------------------------

type Placement = "top" | "bottom" | "left" | "right";

interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TooltipPosition {
  top: number;
  left: number;
  placement: Placement;
}

const GAP = 10; // pixels between anchor and tooltip
const VIEWPORT_MARGIN = 12; // minimum distance from viewport edge

function computePosition(
  anchor: AnchorRect,
  tooltipWidth: number,
  tooltipHeight: number,
  preferred: Placement,
): TooltipPosition {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  const place = (p: Placement): TooltipPosition => {
    let top = 0;
    let left = 0;
    switch (p) {
      case "top":
        top = anchor.top - tooltipHeight - GAP;
        left = anchor.left + anchor.width / 2 - tooltipWidth / 2;
        break;
      case "bottom":
        top = anchor.top + anchor.height + GAP;
        left = anchor.left + anchor.width / 2 - tooltipWidth / 2;
        break;
      case "left":
        top = anchor.top + anchor.height / 2 - tooltipHeight / 2;
        left = anchor.left - tooltipWidth - GAP;
        break;
      case "right":
        top = anchor.top + anchor.height / 2 - tooltipHeight / 2;
        left = anchor.left + anchor.width + GAP;
        break;
    }
    return { top, left, placement: p };
  };

  const fits = (pos: TooltipPosition): boolean => {
    return (
      pos.top >= VIEWPORT_MARGIN &&
      pos.left >= VIEWPORT_MARGIN &&
      pos.top + tooltipHeight <= vh - VIEWPORT_MARGIN &&
      pos.left + tooltipWidth <= vw - VIEWPORT_MARGIN
    );
  };

  // Try preferred placement first, then flip to opposite, then try the other axis.
  const opposites: Record<Placement, Placement> = { top: "bottom", bottom: "top", left: "right", right: "left" };
  const order: Placement[] = [preferred, opposites[preferred], "bottom", "top", "right", "left"];

  for (const p of order) {
    const pos = place(p);
    if (fits(pos)) {
      // Also clamp horizontally/vertically within the viewport so the tooltip
      // never hangs off the edge even if its chosen placement barely fits.
      return {
        ...pos,
        top: Math.max(VIEWPORT_MARGIN, Math.min(pos.top, vh - tooltipHeight - VIEWPORT_MARGIN)),
        left: Math.max(VIEWPORT_MARGIN, Math.min(pos.left, vw - tooltipWidth - VIEWPORT_MARGIN)),
      };
    }
  }

  // Fallback — preferred with edge clamping.
  const fallback = place(preferred);
  return {
    ...fallback,
    top: Math.max(VIEWPORT_MARGIN, Math.min(fallback.top, vh - tooltipHeight - VIEWPORT_MARGIN)),
    left: Math.max(VIEWPORT_MARGIN, Math.min(fallback.left, vw - tooltipWidth - VIEWPORT_MARGIN)),
  };
}

// ---------------------------------------------------------------------------
// Reduced-motion detector
// ---------------------------------------------------------------------------

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

// ---------------------------------------------------------------------------
// Tooltip component
// ---------------------------------------------------------------------------

export interface TooltipProps {
  /** The tooltip body. Can be plain string or JSX for rich content. */
  content: React.ReactNode;
  /** The anchor element. Wrapped in a span (default) or div (when wrapping block content). */
  children: React.ReactNode;
  /** Preferred placement. Edge detection may flip this. Default "top". */
  placement?: Placement;
  /** Visual variant: compact (1-2 lines) or detail (paragraph). Default "compact". */
  variant?: "compact" | "detail";
  /** Show delay in ms. Default 300. Prevents flicker when moving the cursor across the UI. */
  delay?: number;
  /** Max width in pixels. Defaults to 240 (compact) / 340 (detail). */
  maxWidth?: number;
  /**
   * Wrapper element tag. `"span"` (default) for inline anchors — safe inside paragraphs,
   * buttons, other spans, and most flex/grid containers. Use `"div"` when the child is
   * a block element like `<Stat>`, `<div>`, or other block-level components — wrapping
   * a block inside a `<span>` is invalid HTML and causes React hydration errors. The
   * `"div"` wrapper uses `display: contents` so the child remains a direct layout
   * participant (preserves `flex:1`, grid placement, etc.). We fall back to the
   * child's `getBoundingClientRect` for positioning since contents-display boxes
   * have no frame of their own.
   */
  as?: "span" | "div";
}

export function Tooltip({
  content,
  children,
  placement = "top",
  variant = "compact",
  delay = 300,
  maxWidth,
  as = "span",
}: TooltipProps) {
  const { enabled } = useTooltipsEnabled();
  const tooltipId = useId();
  const [visible, setVisible] = useState<boolean>(false);
  // Tracked independently of `visible` so the discoverability hint (underline
  // brighten / pip brighten) can respond to cursor presence without waiting for
  // the show delay. Also flips true on keyboard focus.
  const [hovered, setHovered] = useState<boolean>(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  // HTMLElement covers both <span> and <div> wrapper variants.
  const anchorRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const resolvedMaxWidth = maxWidth ?? (variant === "detail" ? 340 : 240);
  const light = isLightMode();

  // When the wrapper is `display: contents` (as="div" case), it has no box of
  // its own — getBoundingClientRect returns zeros. Fall back to the first child
  // element's rect so positioning still works.
  const readAnchorRect = useCallback((): DOMRect | null => {
    const node = anchorRef.current;
    if (!node) return null;
    const selfRect = node.getBoundingClientRect();
    if (selfRect.width === 0 && selfRect.height === 0) {
      const child = node.firstElementChild as HTMLElement | null;
      if (child) return child.getBoundingClientRect();
    }
    return selfRect;
  }, []);

  // Show logic (with delay). `hovered` flips immediately so the discoverability
  // hint can brighten right away; `visible` waits out the configured delay.
  const show = useCallback(() => {
    if (!enabled) return;
    setHovered(true);
    if (showTimerRef.current) clearTimeout(showTimerRef.current);
    showTimerRef.current = setTimeout(() => {
      setActiveTooltipId(tooltipId);
      setVisible(true);
    }, delay);
  }, [enabled, delay, tooltipId]);

  // Hide logic (immediate).
  const hide = useCallback(() => {
    setHovered(false);
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    setVisible(false);
    if (activeTooltipId === tooltipId) setActiveTooltipId(null);
  }, [tooltipId]);

  // If another tooltip opens, close this one.
  useEffect(() => {
    return subscribeToActiveTooltip((nextId) => {
      if (nextId !== tooltipId && visible) {
        setVisible(false);
      }
    });
  }, [tooltipId, visible]);

  // Compute position after render so we know the tooltip's measured size.
  useLayoutEffect(() => {
    if (!visible || !tooltipRef.current) return;
    const anchorRect = readAnchorRect();
    if (!anchorRect) return;
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    setPosition(computePosition(
      { top: anchorRect.top, left: anchorRect.left, width: anchorRect.width, height: anchorRect.height },
      tooltipRect.width,
      tooltipRect.height,
      placement,
    ));
  }, [visible, placement, content, readAnchorRect]);

  // Reposition on window resize / scroll while visible.
  useEffect(() => {
    if (!visible) return;
    const handler = () => {
      if (!tooltipRef.current) return;
      const anchorRect = readAnchorRect();
      if (!anchorRect) return;
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      setPosition(computePosition(
        { top: anchorRect.top, left: anchorRect.left, width: anchorRect.width, height: anchorRect.height },
        tooltipRect.width,
        tooltipRect.height,
        placement,
      ));
    };
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [visible, placement, readAnchorRect]);

  // Escape key closes any visible tooltip.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, hide]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      if (activeTooltipId === tooltipId) setActiveTooltipId(null);
    };
  }, [tooltipId]);

  // Pass-through when globally disabled.
  if (!enabled) return <>{children}</>;

  // `display: contents` lets the child keep its original layout role (flex item,
  // grid cell, etc.) while still letting us attach a ref + pointer listeners via
  // the wrapper. `span` wrappers default to inline-flex so whitespace/baselines
  // behave like ordinary text. `span` anchors also get a dotted cyan underline
  // for at-rest discoverability — brightens on hover. `div` anchors cannot
  // receive a visual hint on their wrapper box (display:contents has no paint)
  // so they rely on the portal-based corner pip rendered below.
  // Underline alpha is theme-sensitive: light-mode text decoration needs more
  // saturation to read against a white substrate, dark-mode can stay softer.
  // Hover always slams to full opacity.
  const underlineColor = hovered
    ? `${C.brand}ff`
    : light
      ? `${C.brand}bb`
      : `${C.brand}88`;
  const anchorStyle: React.CSSProperties = as === "div"
    ? { display: "contents" }
    : {
        display: "inline-flex",
        alignItems: "center",
        cursor: "help",
        textDecoration: "underline",
        textDecorationStyle: "dotted",
        textDecorationColor: underlineColor,
        textDecorationThickness: "1.5px",
        textUnderlineOffset: "3px",
        transition: "text-decoration-color 150ms ease-out",
      };

  const portal = typeof document !== "undefined" ? document.getElementById("clawnex-tooltip-root") : null;

  // Arrow position based on resolved placement (set after layout effect).
  const resolvedPlacement: Placement = position?.placement ?? placement;
  // Arrow color is tinted cyan on both themes — the accent stays the same, only
  // the alpha/brightness shifts with theme so it remains legible.
  const arrowTint = light ? `${C.brand}66` : `${C.brand}55`;
  const arrowStyle: React.CSSProperties = (() => {
    const size = 8;
    const base: React.CSSProperties = {
      position: "absolute",
      width: 0,
      height: 0,
      borderStyle: "solid",
    };
    switch (resolvedPlacement) {
      case "top":
        return {
          ...base,
          bottom: -size,
          left: "50%",
          marginLeft: -size,
          borderWidth: `${size}px ${size}px 0 ${size}px`,
          borderColor: `${arrowTint} transparent transparent transparent`,
        };
      case "bottom":
        return {
          ...base,
          top: -size,
          left: "50%",
          marginLeft: -size,
          borderWidth: `0 ${size}px ${size}px ${size}px`,
          borderColor: `transparent transparent ${arrowTint} transparent`,
        };
      case "left":
        return {
          ...base,
          right: -size,
          top: "50%",
          marginTop: -size,
          borderWidth: `${size}px 0 ${size}px ${size}px`,
          borderColor: `transparent transparent transparent ${arrowTint}`,
        };
      case "right":
        return {
          ...base,
          left: -size,
          top: "50%",
          marginTop: -size,
          borderWidth: `${size}px ${size}px ${size}px 0`,
          borderColor: `transparent ${arrowTint} transparent transparent`,
        };
    }
  })();

  // Render the anchor as the configured tag. Span for inline anchors (default),
  // div when the child is block-level to avoid invalid <span><div></span> nesting
  // that causes React hydration errors + Next.js "missing required error components"
  // white-screen fallback.
  const WrapperTag = as === "div" ? "div" : "span";
  const anchorProps = {
    ref: anchorRef as React.Ref<HTMLSpanElement & HTMLDivElement>,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
    "aria-describedby": visible ? tooltipId : undefined,
    tabIndex: -1,
    style: anchorStyle,
  };

  return (
    <>
      <WrapperTag {...anchorProps}>
        {children}
      </WrapperTag>

      {/* Corner pip indicator for block anchors — span anchors use the inline
          dotted underline on their wrapper style instead. */}
      {as === "div" && (
        <BlockAnchorIndicator
          anchorRef={anchorRef}
          hovered={hovered}
          light={light}
        />
      )}

      {visible && portal && createPortal(
        <div
          ref={tooltipRef}
          role="tooltip"
          id={tooltipId}
          style={{
            position: "fixed",
            top: position?.top ?? -9999,
            left: position?.left ?? -9999,
            maxWidth: resolvedMaxWidth,
            zIndex: 9999,
            pointerEvents: "none",
            // Glass substrate — same language as CollapsibleCard, heavier blur
            // to separate from the backdrop. Theme-aware: dark mode keeps the
            // deep-space substrate; light mode flips to a frosted near-white
            // panel so the tooltip reads against a bright backdrop.
            background: light
              ? "rgba(255, 255, 255, 0.94)"
              : "rgba(10, 16, 28, 0.92)",
            ...blur(24),
            border: light
              ? `1px solid ${C.brand}44`
              : `1px solid ${C.brand}38`,
            borderRadius: 8,
            // 2px accent bar at the top — signature ClawNex card edge language.
            // Drawn via box-shadow inset so it doesn't affect layout. Shadows
            // are lighter and warmer in light mode to avoid harsh blooming.
            boxShadow: light
              ? [
                  `inset 0 2px 0 0 ${C.brand}88`,
                  `0 10px 30px rgba(12, 30, 60, 0.18)`,
                  `0 2px 8px rgba(12, 30, 60, 0.10)`,
                  `inset 0 1px 0 rgba(255,255,255,0.90)`,
                ].join(",")
              : [
                  `inset 0 2px 0 0 ${C.brand}66`,
                  `0 10px 30px rgba(0,0,0,0.55)`,
                  `0 2px 8px rgba(0,0,0,0.35)`,
                  `inset 0 1px 0 rgba(255,255,255,0.05)`,
                ].join(","),
            padding: variant === "detail" ? "12px 14px 11px" : "8px 11px 7px",
            fontFamily: F.sans,
            fontSize: variant === "detail" ? 12 : 11,
            lineHeight: variant === "detail" ? 1.55 : 1.45,
            // Darker, denser text in light mode so paragraphs don't wash out.
            color: light ? "#0b1524" : C.txS,
            letterSpacing: "0.005em",
            // Spring-physics entry (matches the dashboard's shared transition
            // language). Respects reduced-motion preferences.
            opacity: position ? 1 : 0,
            transform: reducedMotion
              ? "none"
              : position
                ? "scale(1) translateY(0)"
                : `scale(0.96) translateY(${resolvedPlacement === "top" ? "4px" : resolvedPlacement === "bottom" ? "-4px" : "0"})`,
            transition: reducedMotion
              ? "opacity 120ms ease-out"
              : "opacity 180ms cubic-bezier(0.32,0.72,0,1), transform 180ms cubic-bezier(0.32,0.72,0,1)",
          }}
        >
          {/* Arrow pointing at the anchor */}
          <div style={arrowStyle} />
          {content}
        </div>,
        portal,
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// BlockAnchorIndicator — discoverability pip for block-level anchors
// ---------------------------------------------------------------------------

/**
 * Tiny cyan corner pip rendered via portal, pinned to the top-right of a
 * block-level anchor (where the wrapper is `display: contents` and therefore
 * has no paintable box for a traditional hint). The pip uses the same
 * rect-reading logic as the tooltip itself and repositions on scroll, resize,
 * and any parent layout shift caught by a {@link ResizeObserver}. It fades
 * from ~40% alpha at rest to 100% on hover, mirroring the underline treatment
 * used on span anchors.
 */
function BlockAnchorIndicator({
  anchorRef,
  hovered,
  light,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  hovered: boolean;
  light: boolean;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    const compute = () => {
      const node = anchorRef.current;
      if (!node) return;
      let r = node.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        const child = node.firstElementChild as HTMLElement | null;
        if (child) r = child.getBoundingClientRect();
      }
      // Ignore nonsense rects (anchor unmounted / invisible).
      if (r.width > 0 && r.height > 0) setRect(r);
    };
    compute();

    // Observe the paintable box (the first child element in the
    // display:contents case) so the pip tracks layout changes like flex
    // reflows, card expansion, and responsive rewraps.
    const target = (anchorRef.current?.firstElementChild as HTMLElement | null)
      ?? anchorRef.current;
    let ro: ResizeObserver | null = null;
    if (target && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => compute());
      ro.observe(target);
    }

    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
      ro?.disconnect();
    };
  }, [anchorRef]);

  const portal = typeof document !== "undefined"
    ? document.getElementById("clawnex-tooltip-root")
    : null;
  if (!rect || !portal) return null;

  // Pip is pinned just inside the top-right corner of the anchor. 6px dot,
  // light cyan glow. Stays at 40% alpha at rest, 100% on hover.
  const size = 6;
  const inset = 6;
  const alphaAtRest = light ? "88" : "55";
  const alphaHot = "ff";
  const alpha = hovered ? alphaHot : alphaAtRest;

  return createPortal(
    <div
      aria-hidden
      style={{
        position: "fixed",
        top: rect.top + inset,
        left: rect.left + rect.width - inset - size,
        width: size,
        height: size,
        borderRadius: "50%",
        background: `${C.brand}${alpha}`,
        boxShadow: hovered
          ? `0 0 8px ${C.brand}cc, 0 0 2px ${C.brand}ff`
          : `0 0 4px ${C.brand}44`,
        pointerEvents: "none",
        zIndex: 9998,
        transition: "background 150ms ease-out, box-shadow 150ms ease-out",
      }}
    />,
    portal,
  );
}

// ---------------------------------------------------------------------------
// Helper — inline mono code wrapper for use inside tooltip content
// ---------------------------------------------------------------------------

/**
 * Small helper for rendering inline code-style text inside tooltip content.
 * Use for model names, rule IDs, file paths, and any technical token that
 * should visually pop from the surrounding prose.
 */
export function TipCode({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: F.mono,
      fontSize: "0.92em",
      color: C.cyan,
      background: `${C.cyan}0c`,
      padding: "1px 5px",
      borderRadius: 3,
      border: `1px solid ${C.cyan}22`,
    }}>
      {children}
    </span>
  );
}
