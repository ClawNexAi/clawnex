"use client";

/**
 * TriageEmptyState — compact card shown when no artifact is resolved or the
 * resolver has failed.
 *
 * Renders a centered title + reason text, and optionally a single
 * outline-cyan secondary action button when the caller provides both
 * fallbackAction and onNavigate.
 *
 * Design language: same glassSurfTrans sub-surface card as TriageArtifactPreview
 * — no cockpit chrome, no radial glow.
 *
 * @module dashboard/triage/TriageEmptyState
 */

import { C, F } from "../constants";
import type { TriageNavigationTarget } from "./types";
import type { TabId } from "../types";
import type { NavigateOpts } from "../url-state";
import { navigateToTriageTarget } from "./navigation";

export interface TriageEmptyStateProps {
  reason: string;
  /**
   * Override the default "No resolved artifact yet" heading. When the parent has
   * a specific selected artifact (e.g., the operator clicked a "missing" chip),
   * pass a stage-aware title like "Source Event · Missing" so the operator sees
   * which stage's pending state they just opened.
   */
  title?: string;
  fallbackAction?: TriageNavigationTarget;
  onNavigate?: (tab: TabId, focusOrOpts?: string | NavigateOpts) => void;
}

export function TriageEmptyState({ reason, title, fallbackAction, onNavigate }: TriageEmptyStateProps) {
  const hasFallback = fallbackAction != null && onNavigate != null;

  function handleFallbackClick() {
    if (!hasFallback) return;
    navigateToTriageTarget(onNavigate!, fallbackAction!);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleFallbackClick();
    }
  }

  return (
    <div
      style={{
        background: C.glassSurfTrans,
        border: `1px solid ${C.glassSurfBorder}`,
        borderRadius: 12,
        padding: 18,
        marginTop: 12,
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      {/* Title — stage-aware when caller supplies it, else generic fallback */}
      <div style={{
        fontFamily: F.sans,
        fontSize: 13,
        fontWeight: 700,
        color: C.tx,
      }}>
        {title ?? "No resolved artifact yet"}
      </div>

      {/* Reason body — bumped from 11px/txT to 12px/txS for readability per the reviewer's contrast feedback. */}
      <div style={{
        fontFamily: F.sans,
        fontSize: 12,
        color: C.txS,
        lineHeight: 1.5,
        maxWidth: 360,
      }}>
        {reason}
      </div>

      {/* Optional fallback navigation button */}
      {hasFallback && (
        <button
          type="button"
          onClick={handleFallbackClick}
          onKeyDown={handleKeyDown}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            marginTop: 4,
            padding: "5px 14px",
            borderRadius: 8,
            fontSize: 11,
            fontFamily: F.sans,
            fontWeight: 600,
            color: C.cyan,
            background: "transparent",
            border: `1px solid ${C.cyan}55`,
            cursor: "pointer",
            outline: "none",
            letterSpacing: "0.02em",
            transition: "opacity 150ms ease",
          }}
        >
          {fallbackAction!.label ?? "View source ▸"}
        </button>
      )}
    </div>
  );
}
