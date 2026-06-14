"use client";

/**
 * TriageArtifactPreview — inline preview pane for a selected triage artifact.
 *
 * Renders safe metadata fields + 1-3 navigation actions. Field names are
 * filtered through isSafeTriageFieldName() at render time — any field whose
 * label matches a sensitive pattern is silently dropped. This is the runtime
 * guard; the compile-time guard is the redaction verifier (scripts/verify-triage-redaction.ts).
 *
 * Loading state shows skeleton shimmer bars. Restricted state shows a
 * permission notice instead of actions. Missing state shows the reason string.
 *
 * Design language: dashboard-flat glass sub-surface (C.glassSurfTrans,
 * C.glassSurfBorder, 12px radius). Primary action button uses the shared
 * cyan→glassGreen gradient. Secondary actions use outline-cyan styling.
 * No cockpit chrome, no radial glow — those belong on the outer Card.
 *
 * Spec §10 amendment 2026-05-07: when artifact carries an evidenceSnippet
 * (alert resolver) or evidenceTrail (trust-audit resolver), render a
 * default-collapsed toggle to expand the content inline. Snippets are the
 * SAME server-side-redacted match-span data EvidenceInline renders on
 * Audit & Evidence — not raw payload. Trail items are short rule-emitted
 * facts. Both let operators make a fast decision without drilling out.
 *
 * @module dashboard/triage/TriageArtifactPreview
 */

import { useState } from "react";
import { C, F } from "../constants";
import type { TriageArtifact, TriageTone, TriageLinkState } from "./types";
import type { TabId } from "../types";
import type { NavigateOpts } from "../url-state";
import type { TriageNavigationTarget } from "./types";
import { navigateToTriageTarget } from "./navigation";
import { isSafeTriageFieldName } from "./redaction";

export interface TriageArtifactPreviewProps {
  artifact: TriageArtifact;
  onNavigate: (tab: TabId, focusOrOpts?: string | NavigateOpts) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map TriageTone → display color. */
function toneColor(tone: TriageTone | undefined): string {
  switch (tone) {
    case "good":    return C.green;
    case "warn":    return C.warn;
    case "danger":  return C.danger;
    case "muted":   return C.txT;
    case "default":
    default:        return C.tx;
  }
}

/** Map TriageLinkState → small pill color. */
function stateAccent(state: TriageLinkState): string {
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
// Sub-components
// ---------------------------------------------------------------------------

/** Skeleton shimmer bar for the loading state. */
function ShimmerRow({ width = "100%" }: { width?: string | number }) {
  return (
    <div style={{
      height: 12,
      width,
      borderRadius: 4,
      background: C.glassSurfBorder,
      opacity: 0.55,
      // The animation is declared globally in the app; fall back gracefully
      // if it isn't present — the bar still renders as a static placeholder.
      animation: "shimmer 1.6s ease-in-out infinite alternate",
    }} />
  );
}

/** Loading skeleton for the field grid area. */
function LoadingBody() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
      <ShimmerRow width="80%" />
      <ShimmerRow width="60%" />
      <ShimmerRow width="75%" />
      <ShimmerRow width="50%" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Primary action button (cyan→glassGreen gradient, dark text)
// ---------------------------------------------------------------------------

interface ActionButtonProps {
  action: TriageNavigationTarget;
  onNavigate: TriageArtifactPreviewProps["onNavigate"];
  isPrimary: boolean;
}

function ActionButton({ action, onNavigate, isPrimary }: ActionButtonProps) {
  const label = action.label ?? "Open ▸";

  function handleClick() {
    navigateToTriageTarget(onNavigate, action);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  }

  if (isPrimary) {
    return (
      <button
        type="button"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "6px 14px",
          borderRadius: 10,
          fontSize: 11,
          fontFamily: F.sans,
          fontWeight: 850,
          color: "#06121f",
          background: `linear-gradient(135deg, ${C.cyan}, ${C.glassGreen})`,
          border: "none",
          cursor: "pointer",
          outline: "none",
          letterSpacing: "0.02em",
          transition: "opacity 150ms ease",
        }}
      >
        {label}
      </button>
    );
  }

  // Secondary: outline-cyan
  return (
    <button
      type="button"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "5px 12px",
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
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Match-span / evidence-trail toggle state — keyed by artifact id so the
 * operator's expand-collapse choice survives chip-strip switches within the
 * same triage card.
 *
 * Stored in sessionStorage so the operator who triages 10 alerts in a row
 * doesn't re-toggle the snippet on each one — but a fresh browser session
 * always starts collapsed (default-hidden, per operator directive 2026-05-07).
 */
const SESSION_TOGGLE_KEY = "clawnex.triagePreview.matchSpanExpanded";

function readToggleSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(SESSION_TOGGLE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr)) {
      const out = new Set<string>();
      for (const id of arr) if (typeof id === "string") out.add(id);
      return out;
    }
  } catch {
    /* sessionStorage unavailable / malformed — start collapsed */
  }
  return new Set();
}

function writeToggleSet(s: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    const arr: string[] = [];
    s.forEach((id) => arr.push(id));
    window.sessionStorage.setItem(SESSION_TOGGLE_KEY, JSON.stringify(arr));
  } catch {
    /* ignore */
  }
}

export function TriageArtifactPreview({ artifact, onNavigate }: TriageArtifactPreviewProps) {
  const accent = stateAccent(artifact.state);

  // Filter previewFields through the redaction safety guard. Any field whose
  // label matches a forbidden pattern is dropped silently — the operator sees
  // a complete set of safe metadata without knowing redacted fields existed.
  const safeFields = artifact.previewFields.filter((f) => isSafeTriageFieldName(f.label));

  // Match-span / evidence-trail expand state. Default collapsed; operator
  // approved 2026-05-07. SessionStorage persists per-artifact-id so an
  // operator triaging multiple alerts doesn't re-toggle each time.
  const [expandedSet, setExpandedSet] = useState<Set<string>>(() => readToggleSet());
  const isExpanded = expandedSet.has(artifact.id);
  function toggleExpanded() {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(artifact.id)) next.delete(artifact.id);
      else next.add(artifact.id);
      writeToggleSet(next);
      return next;
    });
  }

  const hasSnippet = !!artifact.evidenceSnippet?.match;
  const hasTrail =
    !!artifact.evidenceTrail?.items && artifact.evidenceTrail.items.length > 0;
  const hasExpandable = hasSnippet || hasTrail;

  return (
    <div
      aria-label="Artifact preview"
      style={{
        background: C.glassSurfTrans,
        border: `1px solid ${C.glassSurfBorder}`,
        borderRadius: 12,
        padding: 14,
        marginTop: 12,
      }}
    >
      {/* Header row: artifact title + state pill */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        marginBottom: 8,
        flexWrap: "wrap",
      }}>
        <span style={{
          fontFamily: F.sans,
          fontSize: 12,
          fontWeight: 700,
          color: C.tx,
        }}>
          {artifact.previewTitle}
        </span>

        <span style={{
          fontFamily: F.mono,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: accent,
          background: `${accent}22`,
          border: `1px solid ${accent}55`,
          borderRadius: 999,
          padding: "2px 7px",
          lineHeight: 1.6,
        }}>
          {stateLabel(artifact.state)}
        </span>
      </div>

      {/* Summary */}
      {artifact.previewSummary && (
        <div style={{
          fontFamily: F.sans,
          fontSize: 11,
          color: C.txS,
          lineHeight: 1.5,
          marginBottom: 10,
        }}>
          {artifact.previewSummary}
        </div>
      )}

      {/* Loading state: skeleton bars instead of real fields */}
      {artifact.state === "loading" && <LoadingBody />}

      {/* Field grid — 2-column key/value layout, only for non-loading states */}
      {artifact.state !== "loading" && safeFields.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "6px 12px",
          marginBottom: 12,
        }}>
          {safeFields.map((field, idx) => (
            <div key={idx} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {/* Label — always mono uppercase */}
              <span style={{
                fontFamily: F.mono,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: C.txT,
              }}>
                {field.label}
              </span>
              {/* Value — mono, tone-colored */}
              <span style={{
                fontFamily: F.mono,
                fontSize: 11,
                color: toneColor(field.tone),
                wordBreak: "break-word",
              }}>
                {field.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Restricted: show permission notice instead of actions */}
      {artifact.state === "restricted" && (
        <div style={{
          fontFamily: F.sans,
          fontSize: 11,
          color: C.txT,
          fontStyle: "italic",
          marginTop: 6,
        }}>
          {artifact.permission
            ? `Requires \`${artifact.permission}\` permission to view details.`
            : "Requires additional permission to view details."}
        </div>
      )}

      {/* Missing: show reason instead of actions */}
      {artifact.state === "missing" && (
        <div style={{
          fontFamily: F.sans,
          fontSize: 11,
          color: C.txT,
          fontStyle: "italic",
          marginTop: 6,
        }}>
          {artifact.reason
            ? `Reason: ${artifact.reason}`
            : "No resolved backing object yet."}
        </div>
      )}

      {/* Match-span / evidence-trail toggle — only when artifact carries
          one. Default-collapsed per operator directive 2026-05-07. Snippet
          content is server-side-redacted (Shield masks PII before storage);
          trail items are short rule-emitted facts. Both surfaces are the
          fast-decision affordance — operator clicks once to see what
          actually triggered the alert without leaving the triage card. */}
      {hasExpandable && (
        <div style={{ marginTop: 8, marginBottom: 4 }}>
          <button
            type="button"
            onClick={toggleExpanded}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "Hide match span" : "Show match span"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 0",
              background: "transparent",
              border: "none",
              color: C.cyan,
              fontFamily: F.mono,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            <span style={{
              display: "inline-block",
              transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 150ms ease",
            }}>▶</span>
            {hasSnippet
              ? (isExpanded ? "Hide match span" : "Show match span")
              : (isExpanded ? "Hide evidence trail" : "Show evidence trail")}
          </button>
          {isExpanded && hasSnippet && artifact.evidenceSnippet && (
            <div
              style={{
                marginTop: 8,
                padding: 10,
                background: C.glassChrome,
                border: `1px solid ${C.glassBorderSubtle}`,
                borderRadius: 8,
                fontFamily: F.mono,
                fontSize: 11,
                lineHeight: 1.5,
                color: C.txS,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {artifact.evidenceSnippet.ruleKey && (
                <div style={{
                  marginBottom: 6,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: C.txT,
                }}>
                  rule: {artifact.evidenceSnippet.ruleKey}
                </div>
              )}
              {artifact.evidenceSnippet.before && (
                <span style={{ color: C.txT }}>
                  …{artifact.evidenceSnippet.before}
                </span>
              )}
              <mark style={{
                background: `${C.warn}33`,
                color: C.tx,
                padding: "1px 3px",
                borderRadius: 2,
                fontWeight: 700,
              }}>{artifact.evidenceSnippet.match}</mark>
              {artifact.evidenceSnippet.after && (
                <span style={{ color: C.txT }}>
                  {artifact.evidenceSnippet.after}…
                </span>
              )}
              <div style={{
                marginTop: 6,
                fontSize: 9,
                color: C.txT,
                fontStyle: "italic",
              }}>
                Server-side redacted match-span. Full payload remains in Audit &amp; Evidence under RBAC.
              </div>
            </div>
          )}
          {isExpanded && hasTrail && artifact.evidenceTrail && (
            <div
              style={{
                marginTop: 8,
                padding: 10,
                background: C.glassChrome,
                border: `1px solid ${C.glassBorderSubtle}`,
                borderRadius: 8,
              }}
            >
              <ul style={{
                margin: 0,
                paddingLeft: 18,
                fontFamily: F.sans,
                fontSize: 11,
                lineHeight: 1.6,
                color: C.txS,
              }}>
                {artifact.evidenceTrail.items.map((item, idx) => (
                  <li key={idx} style={{ marginBottom: 2, wordBreak: "break-word" }}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Actions row — shown for resolved, derived, and stale artifacts */}
      {(artifact.state === "resolved" || artifact.state === "derived" || artifact.state === "stale") &&
        (artifact.primaryAction || (artifact.secondaryActions && artifact.secondaryActions.length > 0)) && (
          <div style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            marginTop: 10,
          }}>
            {artifact.primaryAction && (
              <ActionButton
                action={artifact.primaryAction}
                onNavigate={onNavigate}
                isPrimary={true}
              />
            )}
            {artifact.secondaryActions?.map((action, idx) => (
              <ActionButton
                key={idx}
                action={action}
                onNavigate={onNavigate}
                isPrimary={false}
              />
            ))}
          </div>
        )}
    </div>
  );
}
