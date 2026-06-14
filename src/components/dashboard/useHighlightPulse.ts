// useHighlightPulse — scroll-into-view + brief pulse animation when a row's
// id matches the URL `highlight` (or `id`) param.
//
// Used by panels that render lists of rows. Each row calls the hook with its
// own id; the hook returns a ref to attach to the row's DOM element + a
// boolean indicating whether this row is currently the highlighted one.
//
// On URL change, the matched row scrolls into view (smooth, block:center) and
// a CSS pulse class is applied for 2 seconds. The keyframe + class definition
// are injected into <head> once on first hook usage.
//
// Spec: docs/superpowers/specs/2026-04-23-filtered-navigation-design.md §2 Layer C

"use client";

import { useEffect, useRef, useState } from "react";
import { useHashState } from "./url-state";

const HIGHLIGHT_DURATION_MS = 2000;
const STYLE_INJECTED_FLAG = "__clawnex_highlight_pulse_injected__";

/**
 * Inject the pulse keyframe + class into <head> once. Idempotent — checks a
 * flag on the document so multiple hook instances don't duplicate the style.
 */
function ensureStyleInjected() {
  if (typeof document === "undefined") return;
  const w = window as unknown as Record<string, unknown>;
  if (w[STYLE_INJECTED_FLAG]) return;
  w[STYLE_INJECTED_FLAG] = true;
  const style = document.createElement("style");
  style.textContent = `
    @keyframes clawnex-highlight-pulse {
      0%   { box-shadow: 0 0 0 0 rgba(94, 234, 212, 0.6); background-color: rgba(94, 234, 212, 0.18); }
      40%  { box-shadow: 0 0 0 6px rgba(94, 234, 212, 0.0); background-color: rgba(94, 234, 212, 0.10); }
      100% { box-shadow: 0 0 0 0 rgba(94, 234, 212, 0.0); background-color: transparent; }
    }
    .clawnex-highlight-pulse {
      animation: clawnex-highlight-pulse ${HIGHLIGHT_DURATION_MS}ms ease-out 2;
      border-radius: 6px;
      transition: background-color 200ms ease;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Hook for a row in a list. Pass the row's stable id. When the URL's
 * `highlight` or `id` param matches, the returned ref's element scrolls
 * into view and gets a brief pulse animation.
 *
 * Returns: { ref, isHighlighted } — attach `ref` to the row element, and
 * use `isHighlighted` if you want to render any conditional UI (most callers
 * just need the ref).
 */
export function useHighlightPulse<T extends HTMLElement = HTMLDivElement>(id: string | undefined) {
  const ref = useRef<T | null>(null);
  const [isHighlighted, setHighlighted] = useState(false);
  const [urlState] = useHashState();

  // The trigger: URL highlight (preferred) or URL id (deep-link doubles as
  // a highlight when no separate highlight is set).
  const targetId = urlState.highlight ?? urlState.id;

  useEffect(() => {
    if (!id || id !== targetId) {
      setHighlighted(false);
      return;
    }
    ensureStyleInjected();
    setHighlighted(true);
    const el = ref.current;
    if (el) {
      // Defer one frame so newly-rendered elements get the scroll + class
      // after layout settles.
      requestAnimationFrame(() => {
        try {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch {
          // Safari < 14 fallback
          el.scrollIntoView();
        }
        el.classList.add("clawnex-highlight-pulse");
      });
    }
    // Strip the class after the animation so a future re-highlight can
    // re-trigger it cleanly.
    const t = setTimeout(() => {
      ref.current?.classList.remove("clawnex-highlight-pulse");
      setHighlighted(false);
    }, HIGHLIGHT_DURATION_MS * 2 + 200);
    return () => clearTimeout(t);
  }, [id, targetId]);

  return { ref, isHighlighted } as const;
}
