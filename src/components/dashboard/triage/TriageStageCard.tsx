"use client";

/**
 * TriageStageCard — presentational card for a single investigation workflow stage.
 *
 * Renders one of the five canonical stages and acts as the sole selector for
 * that stage's lead artifact. Unavailable stages remain visible but disabled.
 *
 * Design language: post-strip dashboard-flat glass (C.glassSurfTrans body,
 * C.glassSurfBorder border, 12px radius). Active state upgrades to
 * C.glassBorderCyan + soft cyan glow. No inner cockpit chrome or radial
 * gradients — those belong only on the outer <Card> composition.
 *
 * @module dashboard/triage/TriageStageCard
 */

import { C, F } from "../constants";
import type { TriageStage, TriageLinkState } from "./types";

export interface TriageStageCardProps {
  stage: TriageStage;
  active?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onClick?: () => void;
}

// ---------------------------------------------------------------------------
// State → accent color mapping
// ---------------------------------------------------------------------------

/**
 * Returns the accent color for each link state.
 * "resolved" = cyan (matches the canonical evidence-resolved color used across
 * posture rows and action-queue rows). All advisory states use warn. Missing
 * and loading use the muted tertiary text tier so they don't alarm.
 */
function stateColor(state: TriageLinkState): string {
  switch (state) {
    case "resolved":   return C.cyan;
    case "stale":      return C.warn;
    case "restricted": return C.warn;
    case "derived":    return C.warn;
    case "missing":    return C.txT;
    case "loading":    return C.txT;
    default:           return C.txT;
  }
}

function stateLabel(state: TriageLinkState): string {
  switch (state) {
    case "resolved":   return "RESOLVED";
    case "missing":    return "MISSING";
    case "restricted": return "RESTRICTED";
    case "stale":      return "STALE";
    case "derived":    return "DERIVED";
    case "loading":    return "LOADING";
    default:           return String(state).toUpperCase();
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TriageStageCard({
  stage,
  active = false,
  disabled = false,
  disabledReason,
  onClick,
}: TriageStageCardProps) {
  const accent = stateColor(stage.state);

  // Outer container border: cyan when active, normal surf border otherwise.
  const borderColor = active ? C.glassBorderCyan : C.glassSurfBorder;

  // Active state gets a soft cyan ambient glow so it stands out clearly from
  // sibling stage cards without introducing heavy cockpit chrome.
  const boxShadow = active ? `0 0 16px ${C.cyan}33` : undefined;

  const isInteractive = !disabled && typeof onClick === "function";
  const accessibleLabel = isInteractive
    ? `${stage.title}. ${stateLabel(stage.state)}. ${stage.summary}`
    : `${stage.title}. ${stateLabel(stage.state)}. ${disabledReason ?? stage.summary}`;

  // State-badge pill: translucent accent bg + 55%-opacity accent border.
  const pillBg     = `${accent}22`;
  const pillBorder = `1px solid ${accent}55`;

  return (
    <button
      type="button"
      aria-label={accessibleLabel}
      aria-pressed={isInteractive ? active : undefined}
      disabled={!isInteractive}
      title={!isInteractive ? disabledReason : undefined}
      onClick={isInteractive ? onClick : undefined}
      style={{
        width: "100%",
        appearance: "none",
        textAlign: "left",
        background: C.glassSurfTrans,
        border: `1px solid ${borderColor}`,
        borderRadius: 12,
        // Tightened from 12 → 10 per the reviewer's vertical-density feedback so the
        // artifact strip + preview ride higher in the visible card area on
        // 720px viewports.
        padding: 10,
        cursor: isInteractive ? "pointer" : "not-allowed",
        opacity: isInteractive ? 1 : 0.78,
        boxShadow,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 0,
        // Transition border/shadow smoothly when active state toggles.
        transition: "border-color 200ms ease, box-shadow 200ms ease",
      }}
    >
      {/* Eyebrow row: stage number + state badge */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        {/* Eyebrow label — small mono uppercase, colored by state */}
        <span style={{
          fontFamily: F.mono,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: accent,
        }}>
          {stage.eyebrow}
        </span>

        {/* State badge pill — accent-tinted, uppercase */}
        <span style={{
          fontFamily: F.mono,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: accent,
          background: pillBg,
          border: pillBorder,
          borderRadius: 999,
          padding: "2px 7px",
          lineHeight: 1.6,
          flexShrink: 0,
        }}>
          {stateLabel(stage.state)}
        </span>
      </div>

      {/* Stage title — 13px sans bold, primary text */}
      <div style={{
        fontFamily: F.sans,
        fontSize: 13,
        fontWeight: 700,
        color: C.tx,
        lineHeight: 1.3,
      }}>
        {stage.title}
      </div>

      {/* Summary — 11px sans, secondary text. Capped at 3 lines so missing-
          state explanations have room to read fully on the stage card; operator
          2026-05-07 flagged that "...is not bound..." truncation hid the
          posture-level finding rationale. 3 lines is still uniform across
          stepper rows. */}
      <div style={{
        fontFamily: F.sans,
        fontSize: 11,
        color: C.txS,
        lineHeight: 1.4,
        display: "-webkit-box",
        WebkitLineClamp: 3,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
        wordBreak: "break-word",
      }}>
        {stage.summary}
      </div>
    </button>
  );
}
