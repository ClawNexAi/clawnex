"use client";

/**
 * TriageArtifactStrip — horizontal chip strip for triage artifact selection.
 *
 * Clicking a chip selects that artifact and updates the inline preview pane
 * below. No fetching — the parent provides the artifact list and wires the
 * selection callback.
 *
 * Chip states:
 *  - active:      cyan→green gradient bg, dark text, no border (primary CTA)
 *  - resolved:    translucent glassSurfTrans + glassSurfBorder border
 *  - restricted:  translucent + warn-55 border + warn text; aria-disabled
 *  - All others:  translucent neutral (same as resolved inactive)
 *
 * Restricted chips are always visible (never hidden) — operators need to know
 * an artifact exists even when they cannot see its contents.
 *
 * @module dashboard/triage/TriageArtifactStrip
 */

import { C, F } from "../constants";
import type { TriageArtifact } from "./types";

export interface TriageArtifactStripProps {
  artifacts: TriageArtifact[];
  activeArtifactId?: string;
  onSelectArtifact: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Confidence pill color
// ---------------------------------------------------------------------------

/**
 * Maps artifact confidence level to its accent color. Used for the inset
 * confidence pip rendered inside each chip.
 */
function confidenceColor(confidence: TriageArtifact["confidence"]): string {
  switch (confidence) {
    case "exact":   return C.green;
    case "high":    return C.cyan;
    case "medium":  return C.warn;
    case "low":     return C.txT;
    case "derived": return C.warn;
    default:        return C.txT;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TriageArtifactStrip({
  artifacts,
  activeArtifactId,
  onSelectArtifact,
}: TriageArtifactStripProps) {
  return (
    <div>
      {/* Strip heading */}
      <div style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 8,
        marginBottom: 8,
        flexWrap: "wrap",
      }}>
        <span style={{
          fontFamily: F.mono,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: C.txS,
        }}>
          APPLICABLE ARTIFACTS
        </span>
        <span style={{
          fontFamily: F.mono,
          // Bumped from 10/txT to 11/txS per the reviewer's contrast feedback —
          // this is the safety-posture caption operators must be able to read.
          fontSize: 11,
          color: C.txS,
          letterSpacing: "0.02em",
        }}>
          Resolved from live triageLinks · no raw evidence content in this card
        </span>
      </div>

      {/* Chip row */}
      <div style={{
        display: "flex",
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
      }}>
        {artifacts.map((artifact) => {
          const isActive     = activeArtifactId === artifact.id;
          const isRestricted = artifact.state === "restricted";

          // Active chip: gradient primary CTA treatment (cyan→glassGreen).
          // Restricted chip: warm-tinted translucent. Inactive: neutral glass.
          const chipBg = isActive
            ? `linear-gradient(135deg, ${C.cyan}, ${C.glassGreen})`
            : isRestricted
              ? C.glassSurfTrans
              : C.glassSurfTrans;

          const chipBorder = isActive
            ? "none"
            : isRestricted
              ? `1px solid ${C.warn}55`
              : `1px solid ${C.glassSurfBorder}`;

          const chipColor = isActive
            ? "#06121f"
            : isRestricted
              ? C.warn
              : C.txS;

          // Restricted chips cannot be activated (the user lacks permission).
          const isDisabled = isRestricted;

          function handleClick() {
            if (isDisabled) return;
            onSelectArtifact(artifact.id);
          }

          function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleClick();
            }
          }

          return (
            <button
              key={artifact.id}
              type="button"
              aria-pressed={isActive}
              aria-disabled={isDisabled ? true : undefined}
              disabled={isDisabled}
              onClick={handleClick}
              onKeyDown={handleKeyDown}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 12px",
                borderRadius: 999,
                fontSize: 11,
                fontFamily: F.mono,
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: chipColor,
                background: chipBg,
                border: chipBorder,
                cursor: isDisabled ? "not-allowed" : "pointer",
                outline: "none",
                transition: "opacity 150ms ease",
                opacity: isDisabled ? 0.65 : 1,
              }}
            >
              {/* Short label */}
              <span>{artifact.shortLabel}</span>

              {/* Confidence pip — shown when confidence is set */}
              {artifact.confidence && (
                <span style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: isActive ? "#06121f" : confidenceColor(artifact.confidence),
                  background: isActive
                    ? "rgba(6,18,31,0.18)"
                    : `${confidenceColor(artifact.confidence)}22`,
                  border: isActive
                    ? "1px solid rgba(6,18,31,0.25)"
                    : `1px solid ${confidenceColor(artifact.confidence)}55`,
                  borderRadius: 999,
                  padding: "1px 5px",
                  lineHeight: 1.6,
                }}>
                  {artifact.confidence}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
