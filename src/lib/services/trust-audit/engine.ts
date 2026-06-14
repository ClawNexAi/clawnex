/**
 * Trust Audit — Engine
 *
 * Orchestrates: Discovery → Rules → Scoring → Report
 */

import { buildAuditContext } from './discovery';
import { AUDIT_RULES } from './rules';
import { scan as scanPermissiveness } from '../permissiveness';
import {
  applySuppressions as applyRiskSuppressions,
  autoExpire as autoExpireRiskAcceptances,
  autoRevokeOnEvidenceChange as autoRevokeOnEvidenceChangeRA,
} from '../risk-acceptance';
import type { AuditReport, Finding, Severity, MatrixEntry, RemediationItem, SuppressionAcceptance } from './types';

// ── Scoring ──

const SEVERITY_ORDER: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function overallSeverity(findings: Finding[]): Severity {
  if (findings.length === 0) return 'info';
  const max = Math.max(...findings.map(f => SEVERITY_ORDER[f.severity]));
  return (Object.entries(SEVERITY_ORDER).find(([, v]) => v === max)?.[0] as Severity) || 'info';
}

function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
  for (const f of findings) {
    counts[f.severity]++;
  }
  return counts;
}

// ── Matrix Builder ──

function buildMatrix(report: Partial<AuditReport>): MatrixEntry[] {
  const matrix: MatrixEntry[] = [];

  if (!report.surfaces || !report.agents || !report.findings) return matrix;

  for (const agent of report.agents) {
    // Find the most relevant surface for this agent
    const surface = agent.routingMode === 'routed'
      ? report.surfaces.find(s => s.kind === 'litellm-proxy')
      : report.surfaces.find(s => s.kind === 'session-watcher');

    // Find findings related to this agent
    const agentFindings = report.findings.filter(f => f.agentId === agent.id);
    const worstSeverity = agentFindings.length > 0
      ? overallSeverity(agentFindings)
      : 'info';

    matrix.push({
      surface: surface?.name || 'Unknown',
      agent: agent.name,
      model: agent.model,
      tools: agent.tools.slice(0, 5), // top 5 tools
      // `sandboxed: null` means we can't determine sandbox state — show as
      // "Unknown" rather than lying in either direction.
      containment: agent.sandboxed === true
        ? 'Sandboxed'
        : agent.sandboxed === false
          ? 'Unsandboxed'
          : 'Unknown',
      blastRadius: agentFindings.length > 0
        ? agentFindings[0].blastRadius
        : 'No findings — appears within acceptable risk',
      severity: worstSeverity,
    });
  }

  // Sort by severity (worst first)
  matrix.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);

  return matrix;
}

// ── Remediation Plan ──

function buildRemediationPlan(findings: Finding[]): RemediationItem[] {
  // Sort findings by severity (critical first), then by rule
  const sorted = [...findings].sort((a, b) =>
    SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]
  );

  return sorted.map((f, i) => ({
    priority: i + 1,
    findingId: f.id,
    title: f.title,
    severity: f.severity,
    fix: f.recommendedFix,
    effort: f.severity === 'critical' || f.severity === 'high' ? 'low' : 'medium',
  }));
}

// ── Main Engine ──

export async function runTrustAudit(): Promise<AuditReport> {
  const startTime = Date.now();

  // Step 0 (v0.8.0): sweep expired risk acceptances first so their findings
  // pop back active in this run. Cheap (one-row index lookup per acceptance).
  try {
    autoExpireRiskAcceptances();
  } catch (err) {
    console.warn('[trust-audit] risk-acceptance autoExpire failed:', err);
  }

  // Step 1: Discovery
  const context = buildAuditContext();

  // Step 1b (v0.7.1): attach permissiveness report so rules can consume
  // dangerous-combo and posture-lint findings as Trust Audit findings.
  // Use cache (refresh:false) — the permissiveness module has its own 60s
  // TTL so consecutive trust-audit runs reuse the recent scan.
  try {
    context.permissivenessReport = await scanPermissiveness({ refresh: false });
  } catch (err) {
    console.warn('[trust-audit] permissiveness scan failed; comm-surface-permissiveness rule will skip:', err);
    context.permissivenessReport = undefined;
  }

  // Step 2: Run all rules
  const allFindings: Finding[] = [];
  for (const rule of AUDIT_RULES) {
    try {
      const ruleFindings = rule.evaluate(context);
      allFindings.push(...ruleFindings);
    } catch (err) {
      // Rule execution error — log but don't fail the audit
      allFindings.push({
        id: `ERR-${rule.id}`,
        ruleId: rule.id,
        severity: 'info',
        title: `Rule "${rule.name}" failed to execute`,
        capabilityPath: [],
        containmentState: 'unknown',
        assetHints: [],
        whyItMatters: 'An audit rule encountered an error during evaluation. This finding may be incomplete.',
        blastRadius: 'Unknown — rule could not complete evaluation.',
        recommendedFix: 'Check system logs for details. This may indicate missing data or a configuration issue.',
        evidence: [`Error: ${err instanceof Error ? err.message : String(err)}`],
      });
    }
  }

  // Step 2b (v0.8.0): trigger evidence-delta auto-revoke for finding-scope
  // acceptances on this panel before applying suppressions, so any
  // acceptance whose evidence shifted is revoked first and its finding
  // pops back into the active list.
  try {
    autoRevokeOnEvidenceChangeRA(
      'trust_audit',
      allFindings.map((f) => ({
        rule_id: f.ruleId,
        agent_id: f.agentId ?? null,
        surface_id: f.surfaceId ?? null,
        evidence: f.evidence,
      })),
    );
  } catch (err) {
    console.warn('[trust-audit] risk-acceptance evidence-delta sweep failed:', err);
  }

  // Step 2c (v0.8.0): partition findings into active + suppressed.
  const partition = applyRiskSuppressions(allFindings, (f) => ({
    source_panel: 'trust_audit' as const,
    rule_id: f.ruleId,
    agent_id: f.agentId ?? null,
    surface_id: f.surfaceId ?? null,
    evidence: f.evidence,
  }));
  const activeFindings = partition.active;
  const suppressedFindings: Array<{ finding: Finding; acceptance: SuppressionAcceptance }> = partition.suppressed.map((s) => ({
    finding: s.finding,
    acceptance: {
      id: s.acceptance.id,
      scope_level: s.acceptance.scope_level,
      accepted_by: s.acceptance.accepted_by,
      accepted_at: s.acceptance.accepted_at,
      reason: s.acceptance.reason,
      expires_at: s.acceptance.expires_at,
    },
  }));

  // Step 3: Build report. `findingCounts` is gross (back-compat);
  // `findingCountsActive` and `summary.overallSeverity` use the active set
  // (the headline). Operators see "X critical · Y accepted" so suppression
  // is operator-discoverable and never produces false confidence.
  const report: AuditReport = {
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startTime,
    summary: {
      overallSeverity: overallSeverity(activeFindings),
      surfaceCount: context.surfaces.length,
      agentCount: context.agents.length,
      findingCounts: countBySeverity(allFindings),
      findingCountsActive: countBySeverity(activeFindings),
      totalFindings: allFindings.length,
      totalActiveFindings: activeFindings.length,
      totalSuppressedFindings: suppressedFindings.length,
    },
    surfaces: context.surfaces,
    agents: context.agents,
    findings: activeFindings,
    suppressedFindings,
    matrix: [],
    remediationPlan: [],
  };

  // Step 4: Build matrix and remediation
  report.matrix = buildMatrix(report);
  report.remediationPlan = buildRemediationPlan(allFindings);

  return report;
}
