import { createHash, randomUUID } from "node:crypto";
import { queryAll, queryOne, run } from "@/lib/db/index";
import { shieldScan, outboundScan } from "@/lib/shield/scanner";
import type { ShieldDetection, ShieldScanResult } from "@/lib/types";
import { logEvent } from "@/lib/services/audit-logger";
import { createAlert } from "@/lib/services/alert-manager";
import { getActiveInspectionProfile } from "@/lib/services/shield-profiles";
import { enrichDetections, enrichScanResult, type StandardMapping } from "@/lib/services/shield-standards-mapping";
import { getInvestigationCapturePolicy, redactInvestigationEvidence, sanitizeDetectionsForCapture } from '@/lib/services/investigation-capture';

export type ReviewQueueStatus = "open" | "approved" | "rejected" | "false_positive" | "escalated" | "whitelist_draft";
export type EvidenceSourceType = "shield_scan" | "proxy_traffic" | "alert";

export interface ReviewQueueRow {
  id: string;
  source_type: EvidenceSourceType;
  source_id: string;
  verdict: string;
  score: number | null;
  status: ReviewQueueStatus;
  priority: string;
  summary: string;
  detections: string;
  atlas_mappings: string;
  profile_id: string | null;
  assigned_to: string | null;
  decision_reason: string | null;
  decision_by: string | null;
  decision_at: string | null;
  created_at: string;
  updated_at: string;
}

function priorityFor(score: number | null | undefined, detections: ShieldDetection[]): "low" | "medium" | "high" | "critical" {
  if (detections.some((d) => d.severity === "CRITICAL") || (score ?? 0) >= 80) return "critical";
  if ((score ?? 0) >= 50 || detections.some((d) => d.severity === "HIGH")) return "high";
  if ((score ?? 0) >= 25) return "medium";
  return "low";
}

function uniqueMappings(detections: Array<ShieldDetection & { standards?: StandardMapping[] }>): StandardMapping[] {
  const seen = new Set<string>();
  const out: StandardMapping[] = [];
  for (const detection of detections) {
    for (const mapping of detection.standards || []) {
      const key = `${mapping.framework}:${mapping.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(mapping);
    }
  }
  return out;
}

export function createReviewQueueItem(input: {
  sourceType: EvidenceSourceType;
  sourceId: string;
  verdict: string;
  score: number;
  detections: ShieldDetection[];
  summary?: string;
  profileId?: string;
}): string | null {
  if (input.verdict !== "REVIEW") return null;
  const id = `rq_${randomUUID()}`;
  const enriched = enrichDetections(input.detections);
  const mappings = uniqueMappings(enriched);
  const summary = input.summary || `${input.detections[0]?.name || "Shield REVIEW"} · score ${input.score}`;
  run(
    `INSERT OR IGNORE INTO shield_review_queue
      (id, source_type, source_id, verdict, score, status, priority, summary, detections, atlas_mappings, profile_id, created_at, updated_at)
     VALUES (?, ?, ?, 'REVIEW', ?, 'open', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      id,
      input.sourceType,
      input.sourceId,
      input.score,
      priorityFor(input.score, input.detections),
      summary,
      JSON.stringify(enriched),
      JSON.stringify(mappings),
      input.profileId || getActiveInspectionProfile().id,
    ],
  );
  const row = queryOne<{ id: string }>(
    "SELECT id FROM shield_review_queue WHERE source_type = ? AND source_id = ?",
    [input.sourceType, input.sourceId],
  );
  return row?.id || id;
}

export function listReviewQueue(status = "open", limit = 100): Array<ReviewQueueRow & { parsedDetections: unknown[]; mappings: StandardMapping[] }> {
  const rows = queryAll<ReviewQueueRow>(
    status === "all"
      ? "SELECT * FROM shield_review_queue ORDER BY created_at DESC LIMIT ?"
      : "SELECT * FROM shield_review_queue WHERE status = ? ORDER BY created_at DESC LIMIT ?",
    status === "all" ? [limit] : [status, limit],
  );
  return rows.map((row) => ({
    ...row,
    parsedDetections: JSON.parse(row.detections || "[]"),
    mappings: JSON.parse(row.atlas_mappings || "[]"),
  }));
}

export function decideReviewQueueItem(input: {
  id: string;
  status: ReviewQueueStatus;
  reason: string;
  actor: string;
}): ReviewQueueRow | null {
  const existing = queryOne<ReviewQueueRow>("SELECT * FROM shield_review_queue WHERE id = ?", [input.id]);
  if (!existing) return null;
  const now = new Date().toISOString();
  run(
    `UPDATE shield_review_queue
     SET status = ?, decision_reason = ?, decision_by = ?, decision_at = ?, updated_at = ?
     WHERE id = ?`,
    [input.status, input.reason, input.actor, now, now, input.id],
  );
  logEvent(input.actor, `review_queue_${input.status}`, "shield_review_queue", input.id, input.reason, "dashboard");

  if (input.status === "escalated") {
    const incidentId = `inc_${randomUUID()}`;
    run(
      `INSERT INTO incidents (id, title, description, severity, status, alert_ids, timeline, created_at, updated_at)
       VALUES (?, ?, ?, 'HIGH', 'open', ?, ?, ?, ?)`,
      [
        incidentId,
        `Escalated Shield REVIEW: ${existing.summary}`,
        input.reason,
        existing.source_type === "alert" ? JSON.stringify([existing.source_id]) : "[]",
        JSON.stringify([{ at: now, action: "review_queue_escalated", by: input.actor, queue_id: input.id }]),
        now,
        now,
      ],
    );
    createAlert(
      `Review queue escalated: ${existing.summary}`,
      input.reason,
      "HIGH",
      "shield-review-queue",
      { queue_id: input.id, incident_id: incidentId },
    );
  }

  return queryOne<ReviewQueueRow>("SELECT * FROM shield_review_queue WHERE id = ?", [input.id]) || null;
}

export function createReplayCase(input: {
  text: string;
  sourceType?: "shield_scan" | "proxy_traffic" | "alert" | "manual";
  sourceId?: string | null;
  original?: Pick<ShieldScanResult, "verdict" | "score" | "detections">;
  actor?: string;
  direction?: "inbound" | "outbound";
  exceptionOverlays?: Record<string, string[]>;
  originalProfile?: string | null;
}): Record<string, unknown> {
  const profile = getActiveInspectionProfile();
  const capturePolicy = getInvestigationCapturePolicy();
  // Scan the original in-memory specimen so redaction cannot erase the signal
  // being validated. Only the persisted replay snapshot is redacted.
  const replay = enrichScanResult(input.direction === 'outbound'
    ? outboundScan(input.text, { exceptionOverlays: input.exceptionOverlays })
    : shieldScan(input.text, { includeRedacted: true, exceptionOverlays: input.exceptionOverlays }));
  const originalDetections = input.original?.detections ? enrichDetections(input.original.detections) : [];
  const redactedText = capturePolicy.mode === 'metadata'
    ? ''
    : redactInvestigationEvidence(input.text, replay.detections);
  const persistedOriginalDetections = sanitizeDetectionsForCapture(originalDetections, capturePolicy.mode);
  const persistedReplayDetections = sanitizeDetectionsForCapture(replay.detections, capturePolicy.mode);
  const comparison = {
    verdictChanged: Boolean(input.original?.verdict && input.original.verdict !== replay.verdict),
    scoreDelta: typeof input.original?.score === "number" ? replay.score - input.original.score : null,
    originalDetectionCount: originalDetections.length,
    replayDetectionCount: replay.detections.length,
    direction: input.direction || 'inbound',
    candidateExceptionApplied: Boolean(input.exceptionOverlays && Object.keys(input.exceptionOverlays).length > 0),
  };
  const id = `replay_${randomUUID()}`;
  run(
    `INSERT INTO shield_replay_cases
      (id, source_type, source_id, content_hash, redacted_text, original_verdict, original_score,
       original_detections, original_profile, replay_verdict, replay_score, replay_detections,
       replay_profile, comparison, created_by, created_at, replayed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      id,
      input.sourceType || "manual",
      input.sourceId || null,
      createHash("sha256").update(input.text).digest("hex").slice(0, 16),
      redactedText,
      input.original?.verdict || null,
      input.original?.score ?? null,
      JSON.stringify(persistedOriginalDetections),
      input.originalProfile || null,
      replay.verdict,
      replay.score,
      JSON.stringify(persistedReplayDetections),
      profile.id,
      JSON.stringify(comparison),
      input.actor || "operator",
    ],
  );
  logEvent(input.actor || "operator", "shield_replay_case_created", "shield_replay_case", id, `Replay ${replay.verdict} score ${replay.score}`, "dashboard");
  return {
    id,
    replay: { ...replay, detections: persistedReplayDetections },
    comparison,
  };
}

export function getReplayCase(id: string): Record<string, unknown> | null {
  const row = queryOne<Record<string, unknown>>("SELECT * FROM shield_replay_cases WHERE id = ?", [id]);
  if (!row) return null;
  return {
    ...row,
    original_detections: JSON.parse(String(row.original_detections || "[]")),
    replay_detections: JSON.parse(String(row.replay_detections || "[]")),
    comparison: JSON.parse(String(row.comparison || "{}")),
  };
}
