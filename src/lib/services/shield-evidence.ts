import { redact } from '../shield/scanner';
import type { ShieldScanResult } from '../types';
import { logEvent } from './audit-logger';

const MAX_EVIDENCE_EXCERPT = 4096;

export interface ShieldRiskContext {
  why_risky: string;
  severity_basis: string;
  escalation_guidance: string;
  verification_step: string;
}

function riskContext(category: string, severity: string): ShieldRiskContext {
  const categoryContext: Record<string, Pick<ShieldRiskContext, 'why_risky' | 'verification_step'>> = {
    secret: {
      why_risky: 'The matched content resembles credential or secret material that could enable unauthorized access if disclosed or acted upon.',
      verification_step: 'Confirm the matched span is a real secret, identify its owner and scope, and rotate it if exposure cannot be ruled out.',
    },
    command: {
      why_risky: 'The matched content requests or constructs command execution that could alter the host, run arbitrary code, or escape an intended tool boundary.',
      verification_step: 'Inspect the exact command span, the requesting agent, and the tool policy that would have executed it.',
    },
    'sensitive-path': {
      why_risky: 'The matched content targets a sensitive host path commonly associated with credentials, identity, or privileged configuration.',
      verification_step: 'Verify whether the agent had a legitimate task requiring this path and whether filesystem controls prevented access.',
    },
    c2: {
      why_risky: 'The matched content resembles command-and-control, callback, tunneling, or metadata-service access that can support remote control or exfiltration.',
      verification_step: 'Inspect the destination, DNS or URL indicators, related sessions, and outbound network telemetry.',
    },
    jailbreak: {
      why_risky: 'The matched content attempts to override or bypass model instructions and safety controls, which can redirect the agent into unauthorized behavior.',
      verification_step: 'Review the matched instruction in context and confirm whether any later tool calls or model outputs followed it.',
    },
    'trust-exploit': {
      why_risky: 'The matched content uses authority, identity, or trust manipulation to make unverified instructions appear legitimate.',
      verification_step: 'Validate the claimed authority and correlate the request with the authenticated operator and session history.',
    },
    steganography: {
      why_risky: 'The matched content uses concealed or non-visible characters that can hide instructions from human review and basic filters.',
      verification_step: 'Inspect the normalized text and compare it with the rendered text before allowing the request to proceed.',
    },
    encoding: {
      why_risky: 'The matched content uses encoding or obfuscation that may conceal executable instructions, secrets, or policy-bypass content.',
      verification_step: 'Decode the relevant span in an isolated environment and rescan the decoded content before release.',
    },
    financial: {
      why_risky: 'The matched content indicates wallet, private-key, transfer, or drain behavior that could cause immediate financial loss.',
      verification_step: 'Freeze the affected workflow, verify wallet and key ownership, and inspect related tool calls before resuming.',
    },
    'outbound-leak': {
      why_risky: 'The matched response appears to contain sensitive data leaving the trust boundary; once transmitted, the disclosure may be irreversible.',
      verification_step: 'Identify the data owner and destination, confirm whether transmission occurred, and begin containment if it did.',
    },
    policy: {
      why_risky: 'The content matched an operator-defined protection rule, indicating behavior outside the organization\'s accepted AI-use boundary.',
      verification_step: 'Open the governing policy rule, verify the matched span, and confirm the rule still reflects the intended control.',
    },
  };
  const categoryInfo = categoryContext[category] ?? {
    why_risky: 'The content matched a Shield detection associated with unsafe or unauthorized agent behavior.',
    verification_step: 'Review the matched span, source session, and related activity before deciding whether to suppress or escalate.',
  };
  const severityBasis: Record<string, string> = {
    CRITICAL: 'Critical indicates a direct compromise, credential exposure, destructive action, or similarly immediate-impact pattern.',
    HIGH: 'High indicates a strong, material security signal that can enable control bypass, unauthorized access, or significant data exposure.',
    MEDIUM: 'Medium indicates a credible suspicious signal that needs contextual validation before the workflow proceeds.',
    LOW: 'Low indicates a weak or contextual signal; retain it for pattern analysis and escalate only with corroborating evidence.',
  };
  return {
    ...categoryInfo,
    severity_basis: severityBasis[severity] ?? 'Severity reflects the rule definition, match confidence, and potential impact.',
    escalation_guidance: severity === 'CRITICAL' || severity === 'HIGH'
      ? 'Escalate when the match is genuine, the source is untrusted, the affected session has tool access, or related activity shows attempted execution or disclosure.'
      : 'Escalate if the signal repeats, correlates with another detection, or the affected session has sensitive tool or data access.',
  };
}

export interface ShieldEvidenceContext {
  actor: string;
  action: string;
  auditSource: string;
  resourceType: string;
  resourceId: string;
  content: string;
  scanResult: ShieldScanResult;
  direction: string;
  promptHash: string;
  shieldScanId?: string | null;
  proxyTrafficId?: string | null;
  sessionId?: string | null;
  agentId?: string | null;
  model?: string | null;
  provider?: string | null;
  summaryContext?: Record<string, string | number | null | undefined>;
}

export interface ShieldEvidenceRecord {
  auditEventId: string;
  alertMetadata: Record<string, unknown>;
}

export interface BuiltShieldEvidence {
  detail: Record<string, unknown>;
  alertMetadata: Record<string, unknown>;
}

/**
 * Build the canonical Shield evidence shape before creating an alert.
 * Payload content is PII-redacted and capped; detection samples already carry
 * the scanner's rule-specific redaction. Alert metadata contains identifiers
 * and verdict context only, never payload text.
 */
export function buildShieldEvidence(context: ShieldEvidenceContext): BuiltShieldEvidence {
  const redactedPayload = redact(context.content);
  const payloadExcerpt = redactedPayload.length <= MAX_EVIDENCE_EXCERPT
    ? redactedPayload
    : `${redactedPayload.slice(0, MAX_EVIDENCE_EXCERPT / 2)}\n…[truncated]…\n${redactedPayload.slice(-MAX_EVIDENCE_EXCERPT / 2)}`;
  const detectionNames = context.scanResult.detections.slice(0, 5).map((d) => d.name).join(', ');
  const extraSummary = Object.entries(context.summaryContext ?? {})
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' | ');
  const sourceEventType = context.proxyTrafficId ? 'proxy_traffic' : context.shieldScanId ? 'shield_scan' : null;
  const sourceEventId = context.proxyTrafficId ?? context.shieldScanId ?? null;

  const detail = {
    summary: [
      `Direction: ${context.direction}`,
      `Score: ${context.scanResult.score}`,
      `Verdict: ${context.scanResult.verdict}`,
      `Model: ${context.model || 'unknown'}`,
      extraSummary,
      `Detections: ${detectionNames || 'none'}`,
    ].filter(Boolean).join(' | '),
    shield_detections: context.scanResult.detections.map((detection) => ({
      ...detection,
      risk_context: riskContext(detection.category, detection.severity),
    })),
    prompt_hash: context.promptHash,
    payload_excerpt: payloadExcerpt,
    payload_excerpt_truncated: redactedPayload.length > MAX_EVIDENCE_EXCERPT,
    payload_total_length: context.content.length,
    shield_scan_id: context.shieldScanId ?? null,
    proxy_traffic_id: context.proxyTrafficId ?? null,
    source_event_type: sourceEventType,
    session_id: context.sessionId ?? null,
    agent_id: context.agentId ?? null,
    model: context.model ?? null,
    provider: context.provider ?? null,
    direction: context.direction,
    verdict: context.scanResult.verdict,
    score: context.scanResult.score,
  };

  return {
    detail,
    alertMetadata: {
      source_event_id: sourceEventId,
      source_event_type: sourceEventType,
      shield_scan_id: context.shieldScanId ?? null,
      proxy_traffic_id: context.proxyTrafficId ?? null,
      session_id: context.sessionId ?? null,
      agent_id: context.agentId ?? null,
      direction: context.direction,
      model: context.model ?? null,
      provider: context.provider ?? null,
      verdict: context.scanResult.verdict,
      score: context.scanResult.score,
      detection_count: context.scanResult.detections.length,
      primary_rule_key: context.scanResult.detections[0]?.rule_key ?? context.scanResult.detections[0]?.id ?? null,
      primary_rule_name: context.scanResult.detections[0]?.name ?? null,
      prompt_hash: context.promptHash,
    },
  };
}

export function recordShieldEvidence(context: ShieldEvidenceContext): ShieldEvidenceRecord {
  const built = buildShieldEvidence(context);
  const audit = logEvent(
    context.actor,
    context.action,
    context.resourceType,
    context.resourceId,
    JSON.stringify(built.detail),
    context.auditSource,
  );

  return {
    auditEventId: audit.id,
    alertMetadata: {
      ...built.alertMetadata,
      audit_event_id: audit.id,
    },
  };
}
