"use client";

/**
 * BrandWordmark — the "ClawNex" logotype rendered as inline SVG.
 *
 * Why SVG instead of CSS background-clip:text:
 *   The CSS gradient-clipped-to-text approach is fragile. It needs three
 *   interlocking properties (`background`, `background-clip: text`,
 *   `-webkit-text-fill-color: transparent`) and any layer that strips one
 *   leaves an invisible word inside a colored box. We hit this exact bug on
 *   staging production (cyan rectangle, no text shape) even after a "fallback to
 *   solid color" patch — Chrome respects WebkitTextFillColor regardless of
 *   whether the clip succeeded, so the fallback color was never reached.
 *
 *   SVG <text> with linearGradient fill renders the gradient AS the glyph
 *   paint. If the SVG renders at all, the wordmark is visible. No clipping,
 *   no fragile WebKit-only properties, no theming to forget.
 *
 * Sizing:
 *   Width is approximated for "ClawNex" at the chosen font size; if a future
 *   weight change drifts the natural width we tighten via textLength below.
 *   Keep the component self-contained — both header and chat panel use it.
 */

import { useId } from "react";
import { C } from "./constants";

export function BrandWordmark({ size = 13 }: { size?: number }) {
  // Unique gradient ID per instance — useId() prevents collisions when both
  // the header and chat panel render the wordmark on the same page.
  const rawId = useId();
  const gradId = `cnx-wm-${rawId.replace(/:/g, "")}`;

  // Approximate width of "ClawNex" in Plus Jakarta Sans 700 at the given size.
  // textLength + lengthAdjust spacing pin the rendered glyph run to this exact
  // width so the SVG box and the visible glyphs match on every font-load state
  // (avoids FOUC width drift between fallback and webfont).
  const textWidth = Math.round(size * 4.0);
  const boxHeight = Math.round(size * 1.25);
  const baselineY = Math.round(size * 0.92);

  return (
    <svg
      width={textWidth}
      height={boxHeight}
      viewBox={`0 0 ${textWidth} ${boxHeight}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="ClawNex"
      style={{ display: "inline-block", verticalAlign: "middle" }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={C.brand} />
          <stop offset="100%" stopColor={C.cyan} />
        </linearGradient>
      </defs>
      <text
        x="0"
        y={baselineY}
        fontFamily="'Plus Jakarta Sans', sans-serif"
        fontSize={size}
        fontWeight={700}
        fill={`url(#${gradId})`}
        textLength={textWidth}
        lengthAdjust="spacingAndGlyphs"
      >
        ClawNex
      </text>
    </svg>
  );
}
