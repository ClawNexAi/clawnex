"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "../shared";
import { C, F } from "../constants";
import type { TabId } from "../types";
import type { NavigateOpts } from "../url-state";

type ViewId = "overview" | "payload" | "detection" | "activity" | "decision";
type BannerTone = "success" | "error" | "info";
type WorkbenchDisposition =
  | "true_positive"
  | "false_positive"
  | "expected_activity"
  | "needs_more_evidence"
  | "escalated";
type DraftDirection = "inbound" | "outbound" | "both";
type DraftStatus = "draft" | "replayed" | "ready" | "activated" | "deactivated" | "discarded";

interface WorkbenchAlert {
  id: string;
  title?: string | null;
  description?: string | null;
  severity?: string | null;
  source?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface WorkbenchOverview {
  verdict?: string | null;
  score?: number | null;
  direction?: string | null;
  model?: string | null;
  provider?: string | null;
  agent_id?: string | null;
  session_id?: string | null;
  source_event_type?: string | null;
  proxy_traffic_id?: string | null;
  shield_scan_id?: string | null;
  audit_event_id?: string | null;
  prompt_hash?: string | null;
  capture_complete?: boolean | null;
}

interface WorkbenchPayloadForensicStatus {
  available?: boolean;
  expiresAt?: string | null;
  originalLength?: number | null;
}

interface WorkbenchPayload {
  audit_event_id: string;
  created_at?: string | null;
  direction?: string | null;
  label?: string | null;
  redacted_text?: string | null;
  capture_mode?: string | null;
  capture_complete?: boolean | null;
  truncated?: boolean | null;
  total_length?: number | null;
  content_hash?: string | null;
  forensic?: WorkbenchPayloadForensicStatus | null;
}

interface WorkbenchRiskContext {
  why_risky?: string;
  severity_basis?: string;
  escalation_guidance?: string;
  verification_step?: string;
}

interface WorkbenchRulePolicy {
  id?: string;
  name?: string;
  source?: string;
  lifecycle?: string;
  version?: string | null;
  enabled?: boolean;
  updated_at?: string;
}

interface WorkbenchRuleSnapshot {
  stable_id?: string;
  name?: string;
  source?: string;
  category?: string;
  severity?: string;
  confidence?: number;
  pattern?: string;
  flags?: string;
  is_regex?: boolean;
  direction?: string;
  action?: string;
  exceptions?: string;
  tags?: string[];
  updated_at?: string | null;
  policy?: WorkbenchRulePolicy;
}

interface WorkbenchDetection {
  id: string;
  stable_rule_id?: string | null;
  name?: string | null;
  source?: string | null;
  category?: string | null;
  severity?: string | null;
  confidence?: number | null;
  matchCount?: number | null;
  score_contribution?: number | null;
  rule_key?: string | null;
  action?: string | null;
  tags?: string[];
  samples?: string[];
  risk_context?: WorkbenchRiskContext | null;
  rule_snapshot?: WorkbenchRuleSnapshot | null;
}

interface WorkbenchScoringEntry {
  stable_rule_id?: string;
  rule_name?: string;
  severity?: string;
  confidence?: number;
  match_count?: number;
  score_contribution?: number;
  action?: string;
  category?: string;
}

interface WorkbenchScoring {
  version?: string;
  formula?: string;
  severity_weights?: Record<string, number>;
  raw_total?: number;
  rounded_total?: number;
  capped_score?: number;
  review_threshold?: number;
  block_threshold?: number;
  evaluated_detection_count?: number;
  returned_detection_count?: number;
  verdict_basis?: string;
  entries?: WorkbenchScoringEntry[];
}

interface RelatedActivityRow {
  id: string;
  timestamp?: string | null;
  direction?: string | null;
  model?: string | null;
  provider?: string | null;
  upstream_url?: string | null;
  prompt_hash?: string | null;
  messages_count?: number | null;
  shield_verdict?: string | null;
  shield_score?: number | null;
  blocked?: boolean | null;
  block_reason?: string | null;
  status_code?: number | null;
  source?: string | null;
}

interface InvestigationCaseEvent {
  id: string;
  event_type?: string | null;
  actor?: string | null;
  detail?: Record<string, unknown> | null;
  created_at?: string | null;
}

interface InvestigationCase {
  id: string;
  status?: string | null;
  disposition?: WorkbenchDisposition | null;
  rationale?: string | null;
  notes?: string | null;
  assigned_to?: string | null;
  evidence_hash?: string | null;
  created_by?: string | null;
  decided_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  decided_at?: string | null;
  events?: InvestigationCaseEvent[];
}

interface DraftReplayResult {
  target_rule_removed?: boolean;
  activation_ready?: boolean;
  replay?: {
    verdict?: string;
    score?: number;
    detections?: Array<{ name?: string; rule_key?: string; id?: string }>;
  };
  comparison?: Record<string, unknown> | null;
}

interface InvestigationDraft {
  id: string;
  case_id?: string;
  alert_id?: string;
  target_rule_key?: string;
  target_rule_name?: string | null;
  exception_text?: string | null;
  direction?: DraftDirection;
  rationale?: string | null;
  status?: DraftStatus;
  replay_case_id?: string | null;
  replay_result?: DraftReplayResult | null;
  created_by?: string | null;
  activated_by?: string | null;
  created_at?: string | null;
  replayed_at?: string | null;
  activated_at?: string | null;
}

interface InvestigationCapturePolicy {
  mode?: string | null;
  redactedLimit?: number | null;
  forensicRetentionHours?: number | null;
  relatedWindowMinutes?: number | null;
  forensicAvailable?: boolean | null;
}

interface InvestigationWorkbenchData {
  alert: WorkbenchAlert;
  overview?: WorkbenchOverview | null;
  payloads?: WorkbenchPayload[];
  detections?: WorkbenchDetection[];
  scoring?: WorkbenchScoring | null;
  related_activity?: RelatedActivityRow[];
  case?: InvestigationCase | null;
  drafts?: InvestigationDraft[];
  capture_policy?: InvestigationCapturePolicy | null;
  evidence_hash?: string | null;
}

interface WorkbenchResponse {
  workbench?: InvestigationWorkbenchData;
  error?: string;
}

interface MutationResponse {
  ok?: boolean;
  error?: string;
}

interface BannerState {
  tone: BannerTone;
  text: string;
}

interface RevealedPayload {
  content: string;
  direction?: string | null;
  contentHash?: string | null;
  originalLength?: number | null;
  expiresAt?: string | null;
}

interface InvestigationWorkbenchProps {
  alertId: string;
  onNavigate: (tab: TabId, focusOrOpts?: string | NavigateOpts) => void;
}

const VIEW_OPTIONS: Array<{ id: ViewId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "payload", label: "Payload" },
  { id: "detection", label: "Detection Analysis" },
  { id: "activity", label: "Related Activity" },
  { id: "decision", label: "Decision" },
];

const DISPOSITION_OPTIONS: Array<{ value: WorkbenchDisposition; label: string }> = [
  { value: "true_positive", label: "True positive" },
  { value: "false_positive", label: "False positive" },
  { value: "expected_activity", label: "Expected activity" },
  { value: "needs_more_evidence", label: "Needs more evidence" },
  { value: "escalated", label: "Escalated" },
];

const DRAFT_DIRECTIONS: DraftDirection[] = ["inbound", "outbound", "both"];

function severityColor(severity: string | null | undefined): string {
  switch ((severity || "").toUpperCase()) {
    case "CRITICAL":
    case "CRIT":
      return C.danger;
    case "HIGH":
      return C.orange;
    case "MEDIUM":
    case "MED":
      return C.warn;
    case "LOW":
      return C.cyan;
    default:
      return C.txS;
  }
}

function verdictColor(verdict: string | null | undefined): string {
  switch ((verdict || "").toUpperCase()) {
    case "BLOCK":
      return C.danger;
    case "REVIEW":
      return C.warn;
    case "ALLOW":
      return C.green;
    default:
      return C.txS;
  }
}

function dispositionColor(disposition: WorkbenchDisposition | null | undefined): string {
  switch (disposition) {
    case "true_positive":
      return C.danger;
    case "false_positive":
      return C.green;
    case "expected_activity":
      return C.cyan;
    case "needs_more_evidence":
      return C.warn;
    case "escalated":
      return C.orange;
    default:
      return C.txS;
  }
}

function draftStatusColor(status: DraftStatus | null | undefined): string {
  switch (status) {
    case "ready":
      return C.green;
    case "activated":
      return C.cyan;
    case "deactivated":
      return C.txT;
    case "discarded":
      return C.txT;
    case "replayed":
      return C.warn;
    default:
      return C.txS;
  }
}

function bannerColor(tone: BannerTone): string {
  switch (tone) {
    case "success":
      return C.green;
    case "error":
      return C.danger;
    default:
      return C.cyan;
  }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Date(timestamp).toLocaleString();
}

function formatMaybeNumber(value: number | null | undefined, suffix = ""): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "Unknown";
  return `${value.toLocaleString()}${suffix}`;
}

function formatConfidence(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "Unknown";
  return `${Math.round(value * 100)}%`;
}

function formatDirection(value: string | null | undefined): string {
  if (!value) return "Unknown";
  switch (value) {
    case "inbound":
      return "Request / inbound";
    case "outbound":
      return "Response / outbound";
    case "both":
      return "Both directions";
    default:
      return value.replace(/_/g, " ");
  }
}

function humanize(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDisposition(disposition: WorkbenchDisposition | null | undefined): string {
  if (!disposition) return "Not decided";
  return humanize(disposition);
}

function safeString(value: string | null | undefined): string {
  return typeof value === "string" ? value : "";
}

function readJsonError(payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string") {
    return (payload as { error: string }).error;
  }
  return "Request failed";
}

function payloadGroupLabel(direction: string | null | undefined): "request" | "response" {
  return direction === "outbound" ? "response" : "request";
}

function lineSearchData(content: string, query: string): { totalMatches: number; matchingLines: Array<{ line: number; text: string; matches: number }> } {
  if (!query.trim()) return { totalMatches: 0, matchingLines: [] };
  const normalizedQuery = query.toLowerCase();
  let totalMatches = 0;
  const matchingLines: Array<{ line: number; text: string; matches: number }> = [];

  content.split("\n").forEach((line, index) => {
    const normalizedLine = line.toLowerCase();
    let cursor = 0;
    let lineMatches = 0;
    while (cursor >= 0) {
      const found = normalizedLine.indexOf(normalizedQuery, cursor);
      if (found === -1) break;
      lineMatches += 1;
      totalMatches += 1;
      cursor = found + Math.max(1, normalizedQuery.length);
    }
    if (lineMatches > 0) {
      matchingLines.push({ line: index + 1, text: line, matches: lineMatches });
    }
  });

  return { totalMatches, matchingLines };
}

function highlightLine(
  line: string,
  query: string,
  detectionTerms: string[],
): Array<{ text: string; kind: "search" | "detection" | null }> {
  const normalizedLine = line.toLowerCase();
  const intervals: Array<{ start: number; end: number; kind: "search" | "detection" }> = [];
  const addMatches = (term: string, kind: "search" | "detection") => {
    const normalizedTerm = term.trim().toLowerCase();
    if (!normalizedTerm) return;
    let cursor = 0;
    while (cursor < normalizedLine.length) {
      const start = normalizedLine.indexOf(normalizedTerm, cursor);
      if (start === -1) break;
      intervals.push({ start, end: start + normalizedTerm.length, kind });
      cursor = start + Math.max(1, normalizedTerm.length);
    }
  };
  detectionTerms.forEach((term) => addMatches(term, "detection"));
  addMatches(query, "search");
  if (intervals.length === 0) return [{ text: line || " ", kind: null }];

  intervals.sort((left, right) => left.start - right.start || (left.kind === "search" ? -1 : 1));
  const fragments: Array<{ text: string; kind: "search" | "detection" | null }> = [];
  let cursor = 0;
  for (const interval of intervals) {
    if (interval.end <= cursor) continue;
    if (interval.start > cursor) {
      fragments.push({ text: line.slice(cursor, interval.start), kind: null });
    }
    const start = Math.max(cursor, interval.start);
    fragments.push({ text: line.slice(start, interval.end), kind: interval.kind });
    cursor = interval.end;
  }
  if (cursor < line.length) fragments.push({ text: line.slice(cursor), kind: null });
  return fragments;
}

function shellButtonStyle(active = false): React.CSSProperties {
  return {
    padding: "6px 10px",
    borderRadius: 8,
    border: `1px solid ${active ? C.cyan : C.glassSurfBorder}`,
    background: active ? `${C.cyan}18` : C.glassSurfTrans,
    color: active ? C.cyan : C.txS,
    fontSize: 10,
    fontFamily: F.mono,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

function primaryButtonStyle(disabled = false): React.CSSProperties {
  return {
    padding: "7px 12px",
    borderRadius: 10,
    border: 0,
    background: disabled ? C.glassSurfBorder : C.cyan,
    color: disabled ? C.txT : "#06121f",
    fontSize: 11,
    fontFamily: F.mono,
    fontWeight: 850,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
  };
}

function surfaceStyle(minHeight = 0): React.CSSProperties {
  return {
    background: C.glassSurfTrans,
    border: `1px solid ${C.glassSurfBorder}`,
    borderRadius: 10,
    padding: 12,
    minHeight,
  };
}

function DetailField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
      <span style={{
        fontSize: 10,
        color: C.txT,
        fontFamily: F.mono,
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 12,
        color: C.txS,
        lineHeight: 1.5,
        fontFamily: mono ? F.mono : F.sans,
        wordBreak: "break-word",
      }}>
        {value}
      </span>
    </div>
  );
}

function StateBanner({
  tone,
  children,
}: {
  tone: BannerTone;
  children: React.ReactNode;
}) {
  const color = bannerColor(tone);
  return (
    <div style={{
      padding: "8px 10px",
      borderRadius: 8,
      border: `1px solid ${color}55`,
      background: `${color}14`,
      color,
      fontSize: 12,
      lineHeight: 1.5,
    }}>
      {children}
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div style={{
      ...surfaceStyle(180),
      display: "grid",
      placeItems: "center",
      textAlign: "center",
      gap: 8,
    }}>
      <div style={{ fontSize: 13, color: C.tx, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 12, color: C.txS, lineHeight: 1.5, maxWidth: 520 }}>{detail}</div>
    </div>
  );
}

function CodeViewer({
  content,
  query,
  wrap,
  detectionTerms = [],
}: {
  content: string;
  query: string;
  wrap: boolean;
  detectionTerms?: string[];
}) {
  const lines = content.split("\n");
  return (
    <div style={{
      border: `1px solid ${C.glassBorderSubtle}`,
      borderRadius: 8,
      overflow: "auto",
      background: C.pnl,
      maxHeight: 360,
    }}>
      <div style={{ minWidth: wrap ? undefined : "100%" }}>
        {lines.map((line, index) => {
          const fragments = highlightLine(line, query, detectionTerms);
          return (
            <div
              key={`${index}:${line.length}`}
              style={{
                display: "grid",
                gridTemplateColumns: "44px minmax(0, 1fr)",
                alignItems: "start",
                borderBottom: index === lines.length - 1 ? undefined : `1px solid ${C.glassSurfBorder}`,
              }}
            >
              <div style={{
                padding: "6px 8px",
                fontSize: 11,
                fontFamily: F.mono,
                color: C.txT,
                textAlign: "right",
                userSelect: "none",
                borderRight: `1px solid ${C.glassSurfBorder}`,
              }}>
                {index + 1}
              </div>
              <div style={{
                padding: "6px 10px",
                fontSize: 12,
                fontFamily: F.mono,
                color: C.tx,
                whiteSpace: wrap ? "pre-wrap" : "pre",
                wordBreak: wrap ? "break-word" : "normal",
                lineHeight: 1.5,
              }}>
                {fragments.map((fragment, fragmentIndex) => (
                  <span
                    key={`${index}:${fragmentIndex}`}
                    style={fragment.kind ? {
                      background: fragment.kind === "search" ? `${C.warn}40` : `${C.danger}26`,
                      color: C.tx,
                      borderRadius: 2,
                    } : undefined}
                  >
                    {fragment.text}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function InvestigationWorkbench({ alertId, onNavigate }: InvestigationWorkbenchProps) {
  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [workbench, setWorkbench] = useState<InvestigationWorkbenchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [savingDecision, setSavingDecision] = useState(false);
  const [draftBusyId, setDraftBusyId] = useState<string | null>(null);
  const [forensicBusyId, setForensicBusyId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [wrapPayload, setWrapPayload] = useState(true);
  const [copiedPayloadId, setCopiedPayloadId] = useState<string | null>(null);
  const [forensicDraftTarget, setForensicDraftTarget] = useState<string | null>(null);
  const [forensicReason, setForensicReason] = useState("");
  const [revealedPayloads, setRevealedPayloads] = useState<Record<string, RevealedPayload>>({});
  const [decision, setDecision] = useState<{
    disposition: WorkbenchDisposition;
    rationale: string;
    notes: string;
  }>({
    disposition: "needs_more_evidence",
    rationale: "",
    notes: "",
  });
  const [selectedDetectionId, setSelectedDetectionId] = useState("");
  const [draftForm, setDraftForm] = useState<{
    exceptionText: string;
    direction: DraftDirection;
    rationale: string;
  }>({
    exceptionText: "",
    direction: "inbound",
    rationale: "",
  });

  const loadWorkbench = useCallback(async (keepBanner = false) => {
    setLoading(true);
    setLoadError(null);
    if (!keepBanner) setBanner(null);
    try {
      const response = await fetch(`/api/alerts/${encodeURIComponent(alertId)}/investigation`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as WorkbenchResponse;
      if (!response.ok || !payload.workbench) {
        throw new Error(readJsonError(payload));
      }
      setWorkbench(payload.workbench);
    } catch (error) {
      setWorkbench(null);
      setLoadError(error instanceof Error ? error.message : "Unable to load investigation workbench");
    } finally {
      setLoading(false);
    }
  }, [alertId]);

  useEffect(() => {
    void loadWorkbench();
  }, [loadWorkbench]);

  useEffect(() => {
    if (!workbench) return;
    const currentCase = workbench.case;
    setDecision({
      disposition: currentCase?.disposition ?? "needs_more_evidence",
      rationale: currentCase?.rationale ?? "",
      notes: currentCase?.notes ?? "",
    });
  }, [workbench]);

  useEffect(() => {
    const direction = workbench?.overview?.direction;
    if (direction !== "inbound" && direction !== "outbound") return;
    setDraftForm((current) => ({ ...current, direction }));
  }, [workbench?.overview?.direction]);

  useEffect(() => {
    const firstDetectionId = workbench?.detections?.[0]?.stable_rule_id ?? workbench?.detections?.[0]?.id ?? "";
    setSelectedDetectionId((current) => {
      if (!workbench?.detections?.length) return "";
      const stillPresent = workbench.detections.some((detection) => (detection.stable_rule_id ?? detection.id) === current);
      return stillPresent ? current : firstDetectionId;
    });
  }, [workbench]);

  useEffect(() => {
    if (activeView !== "payload") {
      setRevealedPayloads({});
      setForensicDraftTarget(null);
      setForensicReason("");
    }
  }, [activeView]);

  const detections = workbench?.detections ?? [];
  const payloads = workbench?.payloads ?? [];
  const relatedActivity = useMemo(() => {
    return [...(workbench?.related_activity ?? [])].sort((left, right) => {
      return Date.parse(left.timestamp || "") - Date.parse(right.timestamp || "");
    });
  }, [workbench?.related_activity]);
  const caseEvents = workbench?.case?.events ?? [];
  const drafts = workbench?.drafts ?? [];
  const selectedDetection = useMemo(() => {
    return detections.find((detection) => (detection.stable_rule_id ?? detection.id) === selectedDetectionId) ?? null;
  }, [detections, selectedDetectionId]);
  const detectionTerms = useMemo(() => Array.from(new Set(
    detections.flatMap((detection) => detection.samples || []).map((sample) => sample.trim()).filter(Boolean),
  )), [detections]);
  const groupedPayloads = useMemo(() => {
    const requests = payloads.filter((payload) => payloadGroupLabel(payload.direction) === "request");
    const responses = payloads.filter((payload) => payloadGroupLabel(payload.direction) === "response");
    return { requests, responses };
  }, [payloads]);

  const handleCopyRedacted = useCallback(async (payload: WorkbenchPayload) => {
    const redactedText = safeString(payload.redacted_text);
    if (!redactedText) {
      setBanner({ tone: "info", text: "No stored redacted text is available to copy." });
      return;
    }
    try {
      await navigator.clipboard.writeText(redactedText);
      setCopiedPayloadId(payload.audit_event_id);
      setBanner({ tone: "success", text: "Copied the stored redacted text." });
      window.setTimeout(() => setCopiedPayloadId((current) => current === payload.audit_event_id ? null : current), 1200);
    } catch {
      setBanner({ tone: "error", text: "Clipboard access failed. Copy the redacted text directly from the viewer." });
    }
  }, []);

  const handleRevealForensic = useCallback(async (payload: WorkbenchPayload) => {
    if (!forensicReason.trim()) {
      setBanner({ tone: "error", text: "Type a reason before revealing forensic content." });
      return;
    }
    setForensicBusyId(payload.audit_event_id);
    setBanner(null);
    try {
      const response = await fetch(`/api/alerts/${encodeURIComponent(alertId)}/investigation/forensic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auditEventId: payload.audit_event_id,
          reason: forensicReason.trim(),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { payload?: RevealedPayload; error?: string };
      if (!response.ok || !body.payload) {
        throw new Error(readJsonError(body));
      }
      setRevealedPayloads((current) => ({
        ...current,
        [payload.audit_event_id]: body.payload!,
      }));
      setForensicDraftTarget(null);
      setForensicReason("");
      setBanner({ tone: "success", text: "Forensic content was revealed for this session only. It will be cleared when you leave Payload." });
    } catch (error) {
      setBanner({ tone: "error", text: error instanceof Error ? error.message : "Unable to reveal forensic payload" });
    } finally {
      setForensicBusyId(null);
    }
  }, [alertId, forensicReason]);

  const handleSaveDecision = useCallback(async () => {
    if (!decision.rationale.trim()) {
      setBanner({ tone: "error", text: "A decision rationale is required before saving." });
      setActiveView("decision");
      return;
    }
    setSavingDecision(true);
    setBanner(null);
    try {
      const response = await fetch(`/api/alerts/${encodeURIComponent(alertId)}/investigation`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disposition: decision.disposition,
          rationale: decision.rationale.trim(),
          notes: decision.notes.trim(),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as MutationResponse;
      if (!response.ok) {
        throw new Error(readJsonError(payload));
      }
      await loadWorkbench(true);
      setBanner({ tone: "success", text: "Disposition saved. The case history remains append-only below." });
    } catch (error) {
      setBanner({ tone: "error", text: error instanceof Error ? error.message : "Unable to save the disposition" });
    } finally {
      setSavingDecision(false);
    }
  }, [alertId, decision, loadWorkbench]);

  const handleCreateDraft = useCallback(async () => {
    if (!selectedDetection) {
      setBanner({ tone: "error", text: "Choose a triggered detection before drafting an exception." });
      return;
    }
    if (draftForm.exceptionText.trim().length < 3) {
      setBanner({ tone: "error", text: "Exception text must be at least 3 characters." });
      return;
    }
    if (!draftForm.rationale.trim()) {
      setBanner({ tone: "error", text: "Document why this exception is being drafted." });
      return;
    }
    setDraftBusyId("create");
    setBanner(null);
    try {
      const response = await fetch(`/api/alerts/${encodeURIComponent(alertId)}/investigation/drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          targetRuleKey: selectedDetection.stable_rule_id ?? selectedDetection.id,
          targetRuleName: selectedDetection.name ?? selectedDetection.rule_snapshot?.name ?? null,
          exceptionText: draftForm.exceptionText.trim(),
          direction: draftForm.direction,
          rationale: draftForm.rationale.trim(),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as MutationResponse;
      if (!response.ok) {
        throw new Error(readJsonError(payload));
      }
      setDraftForm({ exceptionText: "", direction: "inbound", rationale: "" });
      await loadWorkbench(true);
      setBanner({ tone: "success", text: "Exception draft created. Replay it before activation." });
    } catch (error) {
      setBanner({ tone: "error", text: error instanceof Error ? error.message : "Unable to create the exception draft" });
    } finally {
      setDraftBusyId(null);
    }
  }, [alertId, draftForm, loadWorkbench, selectedDetection]);

  const handleDraftAction = useCallback(async (action: "replay" | "activate" | "deactivate" | "discard", draftId: string) => {
    setDraftBusyId(`${action}:${draftId}`);
    setBanner(null);
    try {
      const response = await fetch(`/api/alerts/${encodeURIComponent(alertId)}/investigation/drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, draftId }),
      });
      const payload = (await response.json().catch(() => ({}))) as MutationResponse;
      if (!response.ok) {
        throw new Error(readJsonError(payload));
      }
      await loadWorkbench(true);
      setBanner({
        tone: "success",
        text:
          action === "replay"
            ? "Draft replay completed."
            : action === "activate"
              ? "Draft activated."
              : action === "deactivate"
                ? "Exception deactivated."
                : "Draft discarded.",
      });
    } catch (error) {
      setBanner({ tone: "error", text: error instanceof Error ? error.message : "Draft action failed" });
    } finally {
      setDraftBusyId(null);
    }
  }, [alertId, loadWorkbench]);

  const handleExport = useCallback(() => {
    window.location.assign(`/api/alerts/${encodeURIComponent(alertId)}/investigation/export`);
  }, [alertId]);

  if (loading) {
    return (
      <div style={{ marginTop: 12, ...surfaceStyle(240), display: "grid", alignItems: "center" }}>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 13, color: C.tx, fontWeight: 700 }}>Loading investigation workbench...</div>
          <div style={{ fontSize: 12, color: C.txS, lineHeight: 1.5 }}>
            Pulling stored evidence, related activity, scoring details, and case history for this alert.
          </div>
        </div>
      </div>
    );
  }

  if (loadError || !workbench) {
    return (
      <div style={{ marginTop: 12 }}>
        <StateBanner tone="error">
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Investigation workbench unavailable</div>
          <div>{loadError || "No investigation data was returned for this alert."}</div>
          <button
            type="button"
            onClick={() => void loadWorkbench()}
            style={{ ...shellButtonStyle(true), marginTop: 8 }}
          >
            Retry
          </button>
        </StateBanner>
      </div>
    );
  }

  const loadedWorkbench = workbench;
  const overview = loadedWorkbench.overview ?? {};
  const scoring = loadedWorkbench.scoring ?? null;
  const currentPayloadSearch = searchQuery.trim();
  const centerTimestamp = Date.parse(loadedWorkbench.alert.created_at || "");

  function renderOverviewView() {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {loadedWorkbench.alert.severity && <Badge label={loadedWorkbench.alert.severity} color={severityColor(loadedWorkbench.alert.severity)} />}
            {overview.verdict && <Badge label={overview.verdict} color={verdictColor(overview.verdict)} />}
            {loadedWorkbench.alert.status && <Badge label={loadedWorkbench.alert.status} color={severityColor(loadedWorkbench.alert.status)} />}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {overview.audit_event_id && (
              <button
                type="button"
                onClick={() => onNavigate("auditEvidence", { id: safeString(overview.audit_event_id), focus: "evidence", fromAlert: alertId })}
                style={shellButtonStyle()}
              >
                Open Audit
              </button>
            )}
            {overview.proxy_traffic_id && (
              <button
                type="button"
                onClick={() => onNavigate("trafficMonitor", { focus: safeString(overview.proxy_traffic_id) })}
                style={shellButtonStyle()}
              >
                Open Traffic
              </button>
            )}
            <button type="button" onClick={() => void loadWorkbench()} style={shellButtonStyle()}>
              Refresh
            </button>
          </div>
        </div>

        <div style={{ ...surfaceStyle(), display: "grid", gap: 10 }}>
          <div style={{ fontSize: 14, color: C.tx, fontWeight: 700 }}>{loadedWorkbench.alert.title || "Alert investigation"}</div>
          <div style={{ fontSize: 12, color: C.txS, lineHeight: 1.6 }}>
            {loadedWorkbench.alert.description || "No operator-facing description was stored for this alert."}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <div style={surfaceStyle()}>
            <DetailField label="Score" value={formatMaybeNumber(overview.score)} />
          </div>
          <div style={surfaceStyle()}>
            <DetailField label="Direction" value={formatDirection(overview.direction)} />
          </div>
          <div style={surfaceStyle()}>
            <DetailField label="Model / provider" value={`${overview.model || "Unknown"} / ${overview.provider || "Unknown"}`} mono />
          </div>
          <div style={surfaceStyle()}>
            <DetailField label="Session" value={overview.session_id || "Not linked"} mono />
          </div>
          <div style={surfaceStyle()}>
            <DetailField label="Agent" value={overview.agent_id || "Not linked"} mono />
          </div>
          <div style={surfaceStyle()}>
            <DetailField label="Prompt hash" value={overview.prompt_hash || "Not captured"} mono />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
          <div style={{ ...surfaceStyle(180), display: "grid", gap: 10 }}>
            <div style={{ fontSize: 13, color: C.tx, fontWeight: 700 }}>Case state</div>
            <DetailField label="Disposition" value={formatDisposition(loadedWorkbench.case?.disposition)} />
            <DetailField label="Created" value={formatDateTime(loadedWorkbench.case?.created_at || loadedWorkbench.alert.created_at)} />
            <DetailField label="Decided" value={formatDateTime(loadedWorkbench.case?.decided_at)} />
            <DetailField label="Decision owner" value={loadedWorkbench.case?.decided_by || "No operator recorded yet"} mono />
          </div>

          <div style={{ ...surfaceStyle(180), display: "grid", gap: 10 }}>
            <div style={{ fontSize: 13, color: C.tx, fontWeight: 700 }}>Evidence posture</div>
            <DetailField label="Evidence hash" value={loadedWorkbench.evidence_hash || loadedWorkbench.case?.evidence_hash || "Unavailable"} mono />
            <DetailField label="Capture complete" value={overview.capture_complete ? "Yes" : "No"} />
            <DetailField label="Stored payloads" value={`${payloads.length}`} mono />
            <DetailField label="Triggered rules" value={`${detections.length}`} mono />
          </div>

          <div style={{ ...surfaceStyle(180), display: "grid", gap: 10 }}>
            <div style={{ fontSize: 13, color: C.tx, fontWeight: 700 }}>Capture policy</div>
            <DetailField label="Mode" value={humanize(loadedWorkbench.capture_policy?.mode)} />
            <DetailField label="Redacted limit" value={formatMaybeNumber(loadedWorkbench.capture_policy?.redactedLimit, " chars")} mono />
            <DetailField label="Related window" value={formatMaybeNumber(loadedWorkbench.capture_policy?.relatedWindowMinutes, " min")} mono />
            <DetailField label="Forensic retention" value={formatMaybeNumber(loadedWorkbench.capture_policy?.forensicRetentionHours, " hr")} mono />
          </div>
        </div>
      </div>
    );
  }

  function renderPayloadPane(payload: WorkbenchPayload) {
    const redactedText = safeString(payload.redacted_text);
    const searchData = lineSearchData(redactedText, currentPayloadSearch);
    const revealed = revealedPayloads[payload.audit_event_id];

    return (
      <div key={payload.audit_event_id} style={{ ...surfaceStyle(), display: "grid", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, color: C.tx, fontWeight: 700 }}>{payload.label || formatDirection(payload.direction)}</div>
            <Badge label={humanize(payload.capture_mode || "redacted")} color={C.cyan} />
            {payload.truncated ? <Badge label="TRUNCATED" color={C.warn} /> : null}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => void handleCopyRedacted(payload)} style={shellButtonStyle()}>
              {copiedPayloadId === payload.audit_event_id ? "Copied" : "Copy redacted"}
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <StateBanner tone="info">
            Stored content is redacted. Copy actions preserve only the stored redacted form.
          </StateBanner>
          {!redactedText && (
            <StateBanner tone="info">
              No stored redacted text is available for this event. Review the capture policy and related activity before deciding.
            </StateBanner>
          )}
          {payload.truncated && (
            <StateBanner tone="info">
              The stored redacted text is truncated. Stored excerpt length: {formatMaybeNumber(payload.total_length, " chars")}.
            </StateBanner>
          )}
          {payload.capture_complete === false && (
            <StateBanner tone="info">
              Capture is incomplete for this event. Related activity or a forensic reveal may be needed before final disposition.
            </StateBanner>
          )}
        </div>

        {currentPayloadSearch && (
          <div style={{ ...surfaceStyle(), display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, color: C.tx, fontWeight: 700 }}>
              Search matches: {searchData.totalMatches}
            </div>
            {searchData.matchingLines.length > 0 ? (
              <div style={{ display: "grid", gap: 4 }}>
                {searchData.matchingLines.slice(0, 8).map((match) => (
                  <div key={match.line} style={{ fontSize: 12, color: C.txS, lineHeight: 1.45, fontFamily: F.mono, wordBreak: "break-word" }}>
                    L{match.line}: {match.text || " "}
                  </div>
                ))}
                {searchData.matchingLines.length > 8 && (
                  <div style={{ fontSize: 12, color: C.txT }}>
                    {searchData.matchingLines.length - 8} more matching lines hidden to keep this view readable.
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: C.txS }}>No matches in the stored redacted text.</div>
            )}
          </div>
        )}

        {redactedText ? <CodeViewer content={redactedText} query={currentPayloadSearch} wrap={wrapPayload} detectionTerms={detectionTerms} /> : null}

        {payload.forensic?.available && (
          <div style={{ ...surfaceStyle(), display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontSize: 13, color: C.tx, fontWeight: 700 }}>Forensic reveal</div>
                <div style={{ fontSize: 12, color: C.txS, lineHeight: 1.5 }}>
                  Full plaintext remains hidden by default. Revealing it requires an explicit typed reason and is cleared when you leave Payload.
                </div>
              </div>
              {!revealed && (
                <button
                  type="button"
                  onClick={() => {
                    setForensicDraftTarget((current) => current === payload.audit_event_id ? null : payload.audit_event_id);
                    setForensicReason("");
                  }}
                  style={shellButtonStyle(forensicDraftTarget === payload.audit_event_id)}
                >
                  Reveal forensic copy
                </button>
              )}
            </div>

            {forensicDraftTarget === payload.audit_event_id && !revealed && (
              <div style={{ display: "grid", gap: 8 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 10, color: C.txT, fontFamily: F.mono, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    Typed reason
                  </span>
                  <textarea
                    value={forensicReason}
                    onChange={(event) => setForensicReason(event.target.value)}
                    rows={3}
                    placeholder="Document why plaintext is required for this decision."
                    style={{
                      width: "100%",
                      resize: "vertical",
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: `1px solid ${C.glassSurfBorder}`,
                      background: C.pnl,
                      color: C.tx,
                      fontSize: 12,
                      fontFamily: F.sans,
                      lineHeight: 1.5,
                      outline: "none",
                    }}
                  />
                </label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => void handleRevealForensic(payload)}
                    disabled={forensicBusyId === payload.audit_event_id || forensicReason.trim().length < 8}
                    style={primaryButtonStyle(forensicBusyId === payload.audit_event_id || forensicReason.trim().length < 8)}
                  >
                    {forensicBusyId === payload.audit_event_id ? "Revealing..." : "Confirm reveal"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setForensicDraftTarget(null);
                      setForensicReason("");
                    }}
                    style={shellButtonStyle()}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {revealed && (
              <div style={{ display: "grid", gap: 8 }}>
                <StateBanner tone="error">
                  Plaintext is visible only in this session. It is not copied, persisted, or retained once you leave Payload.
                </StateBanner>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
                  <DetailField label="Direction" value={formatDirection(revealed.direction)} />
                  <DetailField label="Plaintext bytes" value={formatMaybeNumber(revealed.originalLength)} mono />
                  <DetailField label="Expires" value={formatDateTime(revealed.expiresAt)} />
                  <DetailField label="Content hash" value={revealed.contentHash || "Unavailable"} mono />
                </div>
                <CodeViewer content={revealed.content} query={currentPayloadSearch} wrap={wrapPayload} />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderPayloadView() {
    if (payloads.length === 0) {
      return (
        <EmptyState
          title="No stored payload excerpts"
          detail="This alert does not have a stored redacted request or response excerpt. Review capture policy, related activity, and detection rationale before deciding whether more evidence is required."
        />
      );
    }

    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ ...surfaceStyle(), display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 10, color: C.txT, fontFamily: F.mono, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                Search stored text
              </span>
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search all stored redacted lines"
                style={{
                  width: 260,
                  maxWidth: "100%",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: `1px solid ${C.glassSurfBorder}`,
                  background: C.pnl,
                  color: C.tx,
                  fontSize: 12,
                  fontFamily: F.sans,
                  outline: "none",
                }}
              />
            </label>
            <button type="button" onClick={() => setWrapPayload((current) => !current)} style={shellButtonStyle(wrapPayload)}>
              {wrapPayload ? "Wrap on" : "Wrap off"}
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Badge label={`${groupedPayloads.requests.length} request`} color={C.cyan} />
            <Badge label={`${groupedPayloads.responses.length} response`} color={C.warn} />
            <Badge label={`${detectionTerms.length} retained match ${detectionTerms.length === 1 ? "term" : "terms"}`} color={C.danger} />
          </div>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 13, color: C.tx, fontWeight: 700 }}>Request / inbound</div>
            {groupedPayloads.requests.length > 0 ? groupedPayloads.requests.map(renderPayloadPane) : (
              <EmptyState
                title="No stored request excerpt"
                detail="The investigation record does not include an inbound request excerpt for this alert."
              />
            )}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 13, color: C.tx, fontWeight: 700 }}>Response / outbound</div>
            {groupedPayloads.responses.length > 0 ? groupedPayloads.responses.map(renderPayloadPane) : (
              <EmptyState
                title="No stored response excerpt"
                detail="The investigation record does not include an outbound response excerpt for this alert."
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderDetectionView() {
    if (detections.length === 0) {
      return (
        <EmptyState
          title="No detections captured"
          detail="This alert has no stored rule hits. Use Related Activity and the decision history to document why this event was raised."
        />
      );
    }

    const scoringByRule = new Map<string, WorkbenchScoringEntry>();
    for (const entry of scoring?.entries ?? []) {
      const key = entry.stable_rule_id || entry.rule_name || "";
      if (key) scoringByRule.set(key, entry);
    }

    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <div style={surfaceStyle()}>
            <DetailField label="Formula" value={scoring?.formula || "No versioned scoring ledger captured"} mono />
          </div>
          <div style={surfaceStyle()}>
            <DetailField label="Raw / rounded / capped" value={`${formatMaybeNumber(scoring?.raw_total)} / ${formatMaybeNumber(scoring?.rounded_total)} / ${formatMaybeNumber(scoring?.capped_score)}`} mono />
          </div>
          <div style={surfaceStyle()}>
            <DetailField label="Thresholds" value={`Review ${formatMaybeNumber(scoring?.review_threshold)} / Block ${formatMaybeNumber(scoring?.block_threshold)}`} mono />
          </div>
          <div style={surfaceStyle()}>
            <DetailField label="Verdict basis" value={scoring?.verdict_basis || "No verdict basis was captured"} />
          </div>
        </div>

        {(scoring?.severity_weights && Object.keys(scoring.severity_weights).length > 0) && (
          <div style={{ ...surfaceStyle(), display: "grid", gap: 8 }}>
            <div style={{ fontSize: 13, color: C.tx, fontWeight: 700 }}>Severity weights</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {Object.entries(scoring.severity_weights).map(([key, value]) => (
                <Badge key={key} label={`${key}:${value}`} color={severityColor(key)} />
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gap: 10 }}>
          {detections.map((detection) => {
            const scoringEntry = scoringByRule.get(detection.stable_rule_id || detection.id);
            const contribution = detection.score_contribution ?? scoringEntry?.score_contribution;
            const stableId = detection.stable_rule_id ?? detection.rule_key ?? detection.id;
            return (
              <div key={detection.id} style={{ ...surfaceStyle(), display: "grid", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Badge label={detection.severity || "Unknown"} color={severityColor(detection.severity)} />
                    <span style={{ fontSize: 13, color: C.tx, fontWeight: 700 }}>{detection.name || "Unnamed detection"}</span>
                    <span style={{ fontSize: 11, color: C.cyan, fontFamily: F.mono }}>{stableId}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {detection.source && <Badge label={detection.source} color={C.cyan} />}
                    {detection.category && <Badge label={detection.category} color={C.warn} />}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                  <DetailField label="Confidence" value={formatConfidence(detection.confidence)} />
                  <DetailField label="Match count" value={formatMaybeNumber(detection.matchCount)} mono />
                  <DetailField label="Contribution" value={formatMaybeNumber(contribution)} mono />
                  <DetailField label="Action" value={humanize(detection.action)} />
                </div>

                {detection.rule_snapshot && (
                  <div style={{ ...surfaceStyle(), display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 13, color: C.tx, fontWeight: 700 }}>Rule / policy snapshot</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                      <DetailField label="Rule source" value={detection.rule_snapshot.source || detection.source || "Unknown"} />
                      <DetailField label="Rule category" value={detection.rule_snapshot.category || detection.category || "Unknown"} />
                      <DetailField label="Rule severity" value={detection.rule_snapshot.severity || detection.severity || "Unknown"} />
                      <DetailField label="Rule confidence" value={formatConfidence(detection.rule_snapshot.confidence)} />
                      <DetailField label="Direction" value={formatDirection(detection.rule_snapshot.direction)} />
                      <DetailField label="Pattern flags" value={detection.rule_snapshot.flags || "None"} mono />
                    </div>
                    {detection.rule_snapshot.policy && (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                        <DetailField label="Policy" value={detection.rule_snapshot.policy.name || "Unknown"} />
                        <DetailField label="Policy source" value={detection.rule_snapshot.policy.source || "Unknown"} />
                        <DetailField label="Lifecycle" value={humanize(detection.rule_snapshot.policy.lifecycle)} />
                        <DetailField label="Version" value={detection.rule_snapshot.policy.version || "Unversioned"} mono />
                      </div>
                    )}
                  </div>
                )}

                {detection.risk_context && (
                  <div style={{ ...surfaceStyle(), display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 13, color: C.tx, fontWeight: 700 }}>Risk rationale and verification</div>
                    <DetailField label="Why this matters" value={detection.risk_context.why_risky || "Not captured"} />
                    <DetailField label="Severity basis" value={detection.risk_context.severity_basis || "Not captured"} />
                    <DetailField label="Escalate when" value={detection.risk_context.escalation_guidance || "Not captured"} />
                    <DetailField label="Verify next" value={detection.risk_context.verification_step || "Not captured"} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderRelatedActivityView() {
    if (relatedActivity.length === 0) {
      return (
        <EmptyState
          title="No related traffic in the capture window"
          detail="No proxied request or response rows were linked to the alert session inside the configured related-activity window."
        />
      );
    }

    return (
      <div style={{ display: "grid", gap: 10 }}>
        {relatedActivity.map((row) => {
          const rowTime = Date.parse(row.timestamp || "");
          const timing = row.id === overview.proxy_traffic_id
            ? "current"
            : Number.isFinite(centerTimestamp) && Number.isFinite(rowTime)
              ? rowTime < centerTimestamp
                ? "before"
                : "after"
              : "related";
          const timingColor = timing === "current" ? C.cyan : timing === "before" ? C.txS : C.warn;
          const outcome = row.blocked
            ? `Blocked${row.block_reason ? ` -- ${row.block_reason}` : ""}`
            : row.status_code
              ? `Delivered with HTTP ${row.status_code}`
              : "Transmission outcome unavailable";

          return (
            <div key={row.id} style={{ ...surfaceStyle(), display: "grid", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Badge label={timing.toUpperCase()} color={timingColor} />
                  <span style={{ fontSize: 13, color: C.tx, fontWeight: 700 }}>{formatDateTime(row.timestamp)}</span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {row.shield_verdict && <Badge label={row.shield_verdict} color={verdictColor(row.shield_verdict)} />}
                  {row.direction && <Badge label={row.direction} color={C.cyan} />}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                <DetailField label="Source" value={row.source || "Unknown"} />
                <DetailField label="Model / provider" value={`${row.model || "Unknown"} / ${row.provider || "Unknown"}`} mono />
                <DetailField label="Destination" value={row.upstream_url || "Not captured"} mono />
                <DetailField label="Prompt hash" value={row.prompt_hash || "Not captured"} mono />
                <DetailField label="Shield score" value={formatMaybeNumber(row.shield_score)} mono />
                <DetailField label="Message count" value={formatMaybeNumber(row.messages_count)} mono />
                <DetailField label="Outcome" value={outcome} />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function renderDecisionView() {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ ...surfaceStyle(), display: "grid", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, color: C.tx, fontWeight: 700 }}>Disposition</div>
            <button type="button" onClick={handleExport} style={shellButtonStyle()}>
              Export markdown
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {DISPOSITION_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setDecision((current) => ({ ...current, disposition: option.value }))}
                style={shellButtonStyle(decision.disposition === option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 10, color: C.txT, fontFamily: F.mono, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Rationale
            </span>
            <textarea
              value={decision.rationale}
              onChange={(event) => setDecision((current) => ({ ...current, rationale: event.target.value }))}
              rows={4}
              placeholder="State why this disposition is justified."
              style={{
                width: "100%",
                resize: "vertical",
                padding: "8px 10px",
                borderRadius: 8,
                border: `1px solid ${C.glassSurfBorder}`,
                background: C.pnl,
                color: C.tx,
                fontSize: 12,
                fontFamily: F.sans,
                lineHeight: 1.5,
                outline: "none",
              }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 10, color: C.txT, fontFamily: F.mono, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Notes
            </span>
            <textarea
              value={decision.notes}
              onChange={(event) => setDecision((current) => ({ ...current, notes: event.target.value }))}
              rows={3}
              placeholder="Optional operator notes, follow-up tasks, or escalation details."
              style={{
                width: "100%",
                resize: "vertical",
                padding: "8px 10px",
                borderRadius: 8,
                border: `1px solid ${C.glassSurfBorder}`,
                background: C.pnl,
                color: C.tx,
                fontSize: 12,
                fontFamily: F.sans,
                lineHeight: 1.5,
                outline: "none",
              }}
            />
          </label>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => void handleSaveDecision()} disabled={savingDecision || !decision.rationale.trim()} style={primaryButtonStyle(savingDecision || !decision.rationale.trim())}>
              {savingDecision ? "Saving..." : "Save disposition"}
            </button>
          </div>
        </div>

        <div style={{ ...surfaceStyle(), display: "grid", gap: 10 }}>
          <div style={{ fontSize: 13, color: C.tx, fontWeight: 700 }}>Draft exception editor</div>
          {selectedDetection ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 10, color: C.txT, fontFamily: F.mono, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    Detection
                  </span>
                  <select
                    value={selectedDetectionId}
                    onChange={(event) => setSelectedDetectionId(event.target.value)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: `1px solid ${C.glassSurfBorder}`,
                      background: C.pnl,
                      color: C.tx,
                      fontSize: 12,
                      fontFamily: F.sans,
                      outline: "none",
                    }}
                  >
                    {detections.map((detection) => (
                      <option key={detection.id} value={detection.stable_rule_id ?? detection.id}>
                        {(detection.stable_rule_id ?? detection.id)} - {detection.name || "Unnamed detection"}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 10, color: C.txT, fontFamily: F.mono, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    Direction
                  </span>
                  <select
                    value={draftForm.direction}
                    onChange={(event) => setDraftForm((current) => ({ ...current, direction: event.target.value as DraftDirection }))}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: `1px solid ${C.glassSurfBorder}`,
                      background: C.pnl,
                      color: C.tx,
                      fontSize: 12,
                      fontFamily: F.sans,
                      outline: "none",
                    }}
                  >
                    {DRAFT_DIRECTIONS.map((direction) => (
                      <option key={direction} value={direction}>{humanize(direction)}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 10, color: C.txT, fontFamily: F.mono, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                  Exception text
                </span>
                <textarea
                  value={draftForm.exceptionText}
                  onChange={(event) => setDraftForm((current) => ({ ...current, exceptionText: event.target.value }))}
                  rows={3}
                  placeholder="Document the exception string or rule-specific text to allow."
                  style={{
                    width: "100%",
                    resize: "vertical",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: `1px solid ${C.glassSurfBorder}`,
                    background: C.pnl,
                    color: C.tx,
                    fontSize: 12,
                    fontFamily: F.sans,
                    lineHeight: 1.5,
                    outline: "none",
                  }}
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 10, color: C.txT, fontFamily: F.mono, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                  Draft rationale
                </span>
                <textarea
                  value={draftForm.rationale}
                  onChange={(event) => setDraftForm((current) => ({ ...current, rationale: event.target.value }))}
                  rows={3}
                  placeholder="Explain why this rule should accept the exception."
                  style={{
                    width: "100%",
                    resize: "vertical",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: `1px solid ${C.glassSurfBorder}`,
                    background: C.pnl,
                    color: C.tx,
                    fontSize: 12,
                    fontFamily: F.sans,
                    lineHeight: 1.5,
                    outline: "none",
                  }}
                />
              </label>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={() => void handleCreateDraft()} disabled={draftBusyId === "create"} style={primaryButtonStyle(draftBusyId === "create")}>
                  {draftBusyId === "create" ? "Creating..." : "Create draft"}
                </button>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: C.txS, lineHeight: 1.5 }}>
              No detection is available to seed an exception draft.
            </div>
          )}
        </div>

        <div style={{ ...surfaceStyle(), display: "grid", gap: 10 }}>
          <div style={{ fontSize: 13, color: C.tx, fontWeight: 700 }}>Exception drafts</div>
          {drafts.length === 0 ? (
            <div style={{ fontSize: 12, color: C.txS, lineHeight: 1.5 }}>
              No exception drafts have been created for this alert.
            </div>
          ) : (
            drafts.map((draft) => {
              const replayBusy = draftBusyId === `replay:${draft.id}`;
              const activateBusy = draftBusyId === `activate:${draft.id}`;
              const deactivateBusy = draftBusyId === `deactivate:${draft.id}`;
              const discardBusy = draftBusyId === `discard:${draft.id}`;
              const ready = draft.status === "ready";
              const replayable = draft.status !== "activated" && draft.status !== "deactivated" && draft.status !== "discarded";
              return (
                <div key={draft.id} style={{ ...surfaceStyle(), display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Badge label={humanize(draft.status)} color={draftStatusColor(draft.status)} />
                      <span style={{ fontSize: 13, color: C.tx, fontWeight: 700 }}>
                        {draft.target_rule_name || draft.target_rule_key || draft.id}
                      </span>
                      <span style={{ fontSize: 11, color: C.cyan, fontFamily: F.mono }}>
                        {draft.target_rule_key || draft.id}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {replayable && (
                        <button type="button" onClick={() => void handleDraftAction("replay", draft.id)} disabled={replayBusy} style={shellButtonStyle()}>
                          {replayBusy ? "Replaying..." : "Replay"}
                        </button>
                      )}
                      {ready && (
                        <button type="button" onClick={() => void handleDraftAction("activate", draft.id)} disabled={activateBusy} style={primaryButtonStyle(activateBusy)}>
                          {activateBusy ? "Activating..." : "Activate"}
                        </button>
                      )}
                      {draft.status === "activated" && (
                        <button type="button" onClick={() => void handleDraftAction("deactivate", draft.id)} disabled={deactivateBusy} style={shellButtonStyle()}>
                          {deactivateBusy ? "Deactivating..." : "Deactivate"}
                        </button>
                      )}
                      {draft.status !== "activated" && draft.status !== "discarded" && (
                        <button type="button" onClick={() => void handleDraftAction("discard", draft.id)} disabled={discardBusy} style={shellButtonStyle()}>
                          {discardBusy ? "Discarding..." : "Discard"}
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                    <DetailField label="Direction" value={formatDirection(draft.direction)} />
                    <DetailField label="Created" value={formatDateTime(draft.created_at)} />
                    <DetailField label="Created by" value={draft.created_by || "Unknown"} mono />
                    <DetailField label="Activated by" value={draft.activated_by || "Not activated"} mono />
                  </div>
                  <DetailField label="Exception text" value={draft.exception_text || "Not recorded"} mono />
                  <DetailField label="Rationale" value={draft.rationale || "Not recorded"} />

                  {draft.replay_result && (
                    <div style={{ ...surfaceStyle(), display: "grid", gap: 8 }}>
                      <div style={{ fontSize: 13, color: C.tx, fontWeight: 700 }}>Replay result</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                        <DetailField label="Replay verdict" value={draft.replay_result.replay?.verdict || "Unknown"} />
                        <DetailField label="Replay score" value={formatMaybeNumber(draft.replay_result.replay?.score)} mono />
                        <DetailField label="Target removed" value={draft.replay_result.target_rule_removed ? "Yes" : "No"} />
                        <DetailField label="Activation ready" value={draft.replay_result.activation_ready ? "Yes" : "No"} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div style={{ ...surfaceStyle(), display: "grid", gap: 10 }}>
          <div style={{ fontSize: 13, color: C.tx, fontWeight: 700 }}>Append-only history</div>
          {caseEvents.length === 0 ? (
            <div style={{ fontSize: 12, color: C.txS, lineHeight: 1.5 }}>
              No case events have been recorded yet.
            </div>
          ) : (
            caseEvents.map((event) => (
              <div key={event.id} style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr)",
                gap: 6,
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${C.glassSurfBorder}`,
                background: C.glassSurfTrans,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Badge label={humanize(event.event_type)} color={dispositionColor(loadedWorkbench.case?.disposition)} />
                    <span style={{ fontSize: 12, color: C.tx, fontWeight: 700 }}>{event.actor || "System"}</span>
                  </div>
                  <span style={{ fontSize: 11, color: C.txT, fontFamily: F.mono }}>{formatDateTime(event.created_at)}</span>
                </div>
                {event.detail && Object.keys(event.detail).length > 0 && (
                  <pre style={{
                    margin: 0,
                    fontSize: 11,
                    fontFamily: F.mono,
                    color: C.txS,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    lineHeight: 1.5,
                  }}>
                    {JSON.stringify(event.detail, null, 2)}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  function renderActiveView() {
    switch (activeView) {
      case "payload":
        return renderPayloadView();
      case "detection":
        return renderDetectionView();
      case "activity":
        return renderRelatedActivityView();
      case "decision":
        return renderDecisionView();
      case "overview":
      default:
        return renderOverviewView();
    }
  }

  return (
    <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
      <div style={{ ...surfaceStyle(), display: "grid", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ fontSize: 14, color: C.tx, fontWeight: 700 }}>Mission Control workbench</div>
            <div style={{ fontSize: 12, color: C.txS, lineHeight: 1.5 }}>
              Evidence review, rule analysis, related traffic, operator decision, and exception-draft handling for this alert.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Badge label={formatDisposition(loadedWorkbench.case?.disposition)} color={dispositionColor(loadedWorkbench.case?.disposition)} />
            <Badge label={`rules:${detections.length}`} color={C.cyan} />
            <Badge label={`drafts:${drafts.length}`} color={C.warn} />
          </div>
        </div>

        {banner && (
          <StateBanner tone={banner.tone}>
            {banner.text}
          </StateBanner>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {VIEW_OPTIONS.map((view) => (
            <button
              key={view.id}
              type="button"
              onClick={() => setActiveView(view.id)}
              style={shellButtonStyle(activeView === view.id)}
            >
              {view.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ minHeight: 320 }}>
        {renderActiveView()}
      </div>
    </div>
  );
}
