"use client";

/**
 * TriageGraphCard — top-level parent that stitches the five workflow stage cards,
 * artifact selection strip, and inline preview pane into a single glassmorphism
 * investigation card.
 *
 * WHY this wraps <Card> from shared.tsx instead of hand-rolling chrome:
 * The shared Card component owns the G.card glass tokens (gradient, blur, cyan
 * border, radial-glow overlay, hover transitions). Delegating to it means all
 * future design-system updates ripple here automatically without touching this
 * file.
 *
 * WHY selection state lives here (not in a parent):
 * The selected artifact determines which stage is highlighted active and which
 * preview content to show — it is purely a display concern scoped to this card.
 * Parent panels only need to supply `defaultArtifactId` when they want to
 * deep-link to a specific artifact on first render.
 *
 * @module dashboard/triage/TriageGraphCard
 */

import { useState, useEffect } from "react";
import { Card } from "../shared";
import { C, F } from "../constants";
import type { TabId } from "../types";
import type { NavigateOpts } from "../url-state";
import { TriageStageCard } from "./TriageStageCard";
import { TriageArtifactStrip } from "./TriageArtifactStrip";
import { TriageArtifactPreview } from "./TriageArtifactPreview";
import { TriageEmptyState } from "./TriageEmptyState";
import { InvestigationWorkbench } from "./InvestigationWorkbench";
import type { TriageGraph } from "./types";
import { TRIAGE_STAGE_ORDER } from "./types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TriageGraphCardProps {
  graph: TriageGraph;
  /** Phase 2: compact mode for side-panel embedding. Wired but not visually
   * differentiated yet — Phase 2 will tighten padding/font-size. */
  compact?: boolean;
  /** Artifact to pre-select. Falls back to graph.defaultArtifactId, then
   * first resolved artifact, then first artifact in the list. */
  defaultArtifactId?: string;
  onNavigate: (tab: TabId, focusOrOpts?: string | NavigateOpts) => void;
  onClose?: () => void;
  /** Where this card is embedded. Shown as a small breadcrumb label in the
   * header when not "other". */
  sourceContext?: "missionControl" | "alertsIncidents" | "tokenCost" | "trustAudit" | "other";
}

// ---------------------------------------------------------------------------
// Severity / status accent helpers
// ---------------------------------------------------------------------------

/** Map issue severity to its accent display color. */
function severityColor(severity: string | undefined): string {
  switch (severity) {
    case "CRIT":
    case "HIGH":  return C.danger;
    case "MED":   return C.warn;
    case "LOW":   return C.cyan;
    case "WARN":  return C.warn;
    default:      return C.txS;
  }
}

/** Map issue status to its accent display color. */
function statusColor(status: string | undefined): string {
  const s = (status ?? "").toLowerCase();
  if (s === "open" || s === "active")   return C.danger;
  if (s === "review")                   return C.warn;
  if (s === "resolved")                 return C.green;
  if (s === "dismissed")                return C.txT;
  return C.txS;
}

/** Human-readable label for sourceContext breadcrumb. */
function contextLabel(ctx: TriageGraphCardProps["sourceContext"]): string | null {
  switch (ctx) {
    case "missionControl":   return "FROM MISSION CONTROL";
    case "alertsIncidents":  return "FROM ALERTS & INCIDENTS";
    case "tokenCost":        return "FROM TOKEN COST";
    case "trustAudit":       return "FROM TRUST AUDIT";
    default:                 return null;
  }
}

// ---------------------------------------------------------------------------
// Per-stage title + humanized state — used by the empty state when the operator
// has selected a non-resolved chip. Mirrors the resolver-side STAGE_TITLES so
// title text stays consistent across surfaces.
// ---------------------------------------------------------------------------

function stageTitleFor(stageId: string): string {
  switch (stageId) {
    case "evidence":        return "Evidence";
    case "sourceEvent":     return "Source Event";
    case "affectedObject":  return "Affected Object";
    case "relatedActivity": return "Related Activity";
    case "fixControl":      return "Fix / Control";
    default:                return "Stage";
  }
}

function humanizeState(state: string): string {
  switch (state) {
    case "resolved":   return "Resolved";
    case "missing":    return "Missing";
    case "restricted": return "Restricted";
    case "stale":      return "Stale";
    case "derived":    return "Derived";
    case "loading":    return "Loading";
    default:           return state.charAt(0).toUpperCase() + state.slice(1);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TriageGraphCard({
  graph,
  compact: _compact,
  defaultArtifactId,
  onNavigate,
  onClose,
  sourceContext,
}: TriageGraphCardProps) {
  // -------------------------------------------------------------------------
  // Artifact selection state
  //
  // Priority: prop defaultArtifactId → graph.defaultArtifactId → first
  // resolved artifact → first artifact in list. The "resolved" check uses
  // artifact.state (the actual field name) not linkState (spec wording).
  // -------------------------------------------------------------------------

  const pickInitial = () =>
    defaultArtifactId
    ?? graph.defaultArtifactId
    ?? graph.artifacts.find((a) => a.state === "resolved")?.id
    ?? graph.artifacts[0]?.id;

  const [selectedId, setSelectedId] = useState<string | undefined>(pickInitial);

  // Reset selection when the parent supplies a new issue, OR when the deep-link
  // pre-select prop changes (defaultArtifactId / graph.defaultArtifactId are
  // primitive strings — safe in deps without triggering on every parent render).
  // graph.artifacts is intentionally NOT a dep: parents that recompute the graph
  // object inline (e.g., resolveActionRowTriageGraph(...)) produce a fresh array
  // reference every render, which would clobber chip selections after every click.
  useEffect(() => {
    setSelectedId(
      defaultArtifactId
      ?? graph.defaultArtifactId
      ?? graph.artifacts.find((a) => a.state === "resolved")?.id
      ?? graph.artifacts[0]?.id,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.issue.id, defaultArtifactId, graph.defaultArtifactId]);

  const selectedArtifact = graph.artifacts.find((a) => a.id === selectedId);

  // Show the full preview pane only when we have a resolved (or derived/stale)
  // artifact selected — otherwise the empty state explains what's missing.
  const hasResolved =
    selectedArtifact !== undefined &&
    (selectedArtifact.state === "resolved" ||
     selectedArtifact.state === "derived" ||
     selectedArtifact.state === "stale");

  // -------------------------------------------------------------------------
  // Derived display values
  // -------------------------------------------------------------------------

  const issue = graph.issue;
  const sevColor = severityColor(issue.severity);
  const staColor = statusColor(issue.status);
  const breadcrumb = contextLabel(sourceContext);

  // Which stage is currently "active" — the stage that owns the selected artifact.
  const activeStageId = selectedArtifact?.stageId;

  // Build the ordered stage list by walking TRIAGE_STAGE_ORDER and finding
  // matching stage objects from graph.stages. Missing stages are skipped so
  // the row doesn't blow up if a graph has fewer than 5 stages.
  const orderedStages = TRIAGE_STAGE_ORDER
    .map((id) => graph.stages.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    // Outer wrapper provides the marginTop the spec requests, since the shared
    // <Card> component does not accept a style prop.
    <div style={{ marginTop: 12 }}>
      <Card title={issue.title}>
        {/* ----------------------------------------------------------------
            HEADER ROW — severity dot · title · status pill · breadcrumb · close
           ---------------------------------------------------------------- */}
        <div style={{
          display: "flex",
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 6,
        }}>
          {/* Left: severity dot + bold title + status pill + source label */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
            {/* 8px severity dot */}
            <span style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: 999,
              background: sevColor,
              flexShrink: 0,
            }} />

            {/* Issue title */}
            <span style={{
              fontFamily: F.sans,
              fontSize: 13,
              fontWeight: 700,
              color: C.tx,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {issue.title}
            </span>

            {/* Status pill */}
            {issue.status && (
              <span style={{
                fontFamily: F.mono,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: staColor,
                background: `${staColor}18`,
                border: `1px solid ${staColor}44`,
                borderRadius: 999,
                padding: "2px 8px",
                flexShrink: 0,
              }}>
                {issue.status.toUpperCase()}
              </span>
            )}

            {/* Source label */}
            {issue.source && (
              <span style={{
                fontFamily: F.mono,
                fontSize: 10,
                color: C.txT,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                flexShrink: 0,
              }}>
                {issue.source}
              </span>
            )}
          </div>

          {/* Right: sourceContext breadcrumb + close button */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {breadcrumb && (
              <span style={{
                fontFamily: F.mono,
                // Bumped from 10/txT to 11/txS per the reviewer's contrast feedback —
                // breadcrumb is meaningful operator orientation copy, not chrome.
                fontSize: 11,
                fontWeight: 600,
                color: C.txS,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}>
                {breadcrumb}
              </span>
            )}
            {onClose && (
              <button
                type="button"
                aria-label="Close investigation card"
                onClick={onClose}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: "2px 6px",
                  fontSize: 16,
                  lineHeight: 1,
                  color: C.txS,
                  cursor: "pointer",
                  borderRadius: 4,
                  transition: "color 150ms ease",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = C.tx; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = C.txS; }}
              >
                {"×"}
              </button>
            )}
          </div>
        </div>

        {/* ----------------------------------------------------------------
            SUMMARY LINE
           ---------------------------------------------------------------- */}
        <div style={{
          fontFamily: F.sans,
          fontSize: 11,
          color: C.txS,
          lineHeight: 1.5,
          marginTop: 6,
          marginBottom: 8,
        }}>
          {issue.summary}
        </div>

        {/* ----------------------------------------------------------------
            TAGS ROW — small pill per tag
           ---------------------------------------------------------------- */}
        {issue.tags.length > 0 && (
          <div style={{
            display: "flex",
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 4,
          }}>
            {issue.tags.map((tag) => (
              <span
                key={`${tag.label}:${tag.value}`}
                style={{
                  fontFamily: F.mono,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: C.txT,
                  background: C.glassSurfTrans,
                  border: `1px solid ${C.glassSurfBorder}`,
                  borderRadius: 999,
                  padding: "2px 8px",
                }}
              >
                {tag.label}: {tag.value}
              </span>
            ))}
          </div>
        )}

        {/* The evidence-driven workbench is the primary investigation surface.
            Keep it ahead of the legacy triage graph so operators immediately
            see Overview, Payload, Detection Analysis, Related Activity, and
            Decision after opening an alert. */}
        {graph.issue.kind === "alert" && (
          <InvestigationWorkbench
            alertId={graph.issue.id}
            onNavigate={onNavigate}
          />
        )}

        {/* ----------------------------------------------------------------
            WORKFLOW ROW — 5-column grid stepper.
            internal reviewer flagged the prior flex-wrap layout as visually uneven. Grid
            with fixed 5 equal columns gives a predictable horizontal stepper
            on desktop; on narrow viewports `minmax(0, 1fr)` lets cells shrink
            cleanly without wrapping. Eyebrow numbers (01-05) carry the
            stepper sequence; arrows removed to reduce vertical noise.
           ---------------------------------------------------------------- */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
          alignItems: "stretch",
          gap: 8,
          marginTop: 10,
          marginBottom: 10,
        }}>
          {orderedStages.map((stage) => (
            <TriageStageCard
              key={stage.id}
              stage={stage}
              active={stage.id === activeStageId}
              // operator-flagged 2026-05-07: stage cards looked clickable but did
              // nothing. Wire them up: click a stage card → select the lead
              // artifact for that stage (preferring resolved/derived over missing
              // so the operator sees actionable content when available).
              onClick={() => {
                const candidates = graph.artifacts.filter((a) => a.stageId === stage.id);
                const lead =
                  candidates.find((a) => a.state === "resolved")
                  ?? candidates.find((a) => a.state === "derived")
                  ?? candidates.find((a) => a.state === "stale")
                  ?? candidates[0];
                if (lead) setSelectedId(lead.id);
              }}
            />
          ))}
        </div>

        {/* ----------------------------------------------------------------
            ARTIFACT STRIP — horizontal chip row for artifact selection
           ---------------------------------------------------------------- */}
        <TriageArtifactStrip
          artifacts={graph.artifacts}
          activeArtifactId={selectedId}
          onSelectArtifact={setSelectedId}
        />

        {/* ----------------------------------------------------------------
            ARTIFACT PREVIEW or EMPTY STATE
           ---------------------------------------------------------------- */}
        {hasResolved && selectedArtifact ? (
          <TriageArtifactPreview
            artifact={selectedArtifact}
            onNavigate={onNavigate}
          />
        ) : (
          <TriageEmptyState
            // Stage-aware title when the operator clicked a specific (missing/
            // restricted/loading) chip — shows them which stage they're seeing
            // the pending state for. Generic fallback when no chip is selected.
            title={
              selectedArtifact
                ? `${stageTitleFor(selectedArtifact.stageId)} · ${humanizeState(selectedArtifact.state)}`
                : undefined
            }
            reason={
              selectedArtifact?.reason
                ?? selectedArtifact?.previewSummary
                ?? "No resolved artifact selected yet."
            }
            fallbackAction={
              selectedArtifact?.primaryAction ?? undefined
            }
            onNavigate={onNavigate}
          />
        )}

      </Card>
    </div>
  );
}
