/**
 * ClawNex Clawkeeper Mapper
 *
 * Maps Clawkeeper check results to ClawNex hardening categories
 * and generates structured hardening reports.
 */

import type { ClawkeeperCheck, ClawkeeperScanResult } from './clawkeeper-runner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HardeningTier = 'Basic' | 'Standard' | 'Advanced';

export interface HardeningItem {
  checkId: string;
  name: string;
  status: string;
  severity: string;
  category: string;
  tier: HardeningTier;
  remediation: string;
  detail: string;
}

export interface HardeningCategory {
  name: string;
  items: HardeningItem[];
  passCount: number;
  failCount: number;
  warnCount: number;
  score: number;
}

export interface HardeningReport {
  grade: string;
  score: number;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  categories: HardeningCategory[];
  tiers: {
    basic: HardeningItem[];
    standard: HardeningItem[];
    advanced: HardeningItem[];
  };
  scannedAt: string;
}

// ---------------------------------------------------------------------------
// Tier assignment
// ---------------------------------------------------------------------------

/**
 * Assign a hardening tier based on category and severity.
 * Basic = fundamental security, Standard = recommended, Advanced = best-practice.
 */
function assignTier(check: ClawkeeperCheck): HardeningTier {
  const { category, severity } = check;

  // Critical and high-severity items in core categories are Basic tier
  if (severity === 'CRITICAL' || severity === 'HIGH') {
    if (['Network', 'Authentication', 'Encryption'].includes(category)) return 'Basic';
    return 'Standard';
  }

  // Medium severity
  if (severity === 'MEDIUM') {
    if (['Filesystem', 'Process', 'Logging'].includes(category)) return 'Standard';
    return 'Advanced';
  }

  // Low / Info severity
  if (['Kernel', 'Updates'].includes(category)) return 'Advanced';
  return 'Standard';
}

// ---------------------------------------------------------------------------
// Report Generation
// ---------------------------------------------------------------------------

/**
 * Build a hardening report from scan results.
 */
export function buildHardeningReport(scan: ClawkeeperScanResult): HardeningReport {
  const items: HardeningItem[] = scan.checks.map(check => ({
    checkId: check.checkId,
    name: check.name,
    status: check.status,
    severity: check.severity,
    category: check.category,
    tier: assignTier(check),
    remediation: check.remediation,
    detail: check.detail,
  }));

  // Group by category
  const categoryMap = new Map<string, HardeningItem[]>();
  for (const item of items) {
    if (!categoryMap.has(item.category)) categoryMap.set(item.category, []);
    categoryMap.get(item.category)!.push(item);
  }

  const categories: HardeningCategory[] = Array.from(categoryMap.entries()).map(([name, catItems]) => {
    const passCount = catItems.filter(i => i.status === 'PASS').length;
    const failCount = catItems.filter(i => i.status === 'FAIL').length;
    const warnCount = catItems.filter(i => i.status === 'WARN').length;
    const total = catItems.length;
    const score = total > 0 ? Math.round((passCount / total) * 100) : 0;

    return { name, items: catItems, passCount, failCount, warnCount, score };
  });

  // Sort categories: worst-scoring first
  categories.sort((a, b) => a.score - b.score);

  return {
    grade: scan.overallGrade,
    score: scan.overallScore,
    totalChecks: scan.totalChecks,
    passedChecks: scan.passedChecks,
    failedChecks: scan.failedChecks,
    categories,
    tiers: {
      basic: items.filter(i => i.tier === 'Basic'),
      standard: items.filter(i => i.tier === 'Standard'),
      advanced: items.filter(i => i.tier === 'Advanced'),
    },
    scannedAt: scan.scannedAt,
  };
}

/**
 * Generate remediation suggestions for failed checks.
 */
export function getRemediationSuggestions(scan: ClawkeeperScanResult): Array<{
  checkId: string;
  name: string;
  severity: string;
  category: string;
  suggestion: string;
}> {
  return scan.checks
    .filter(c => c.status === 'FAIL' || c.status === 'WARN')
    .sort((a, b) => {
      const sevOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
      return (sevOrder[a.severity] || 4) - (sevOrder[b.severity] || 4);
    })
    .map(check => ({
      checkId: check.checkId,
      name: check.name,
      severity: check.severity,
      category: check.category,
      suggestion: check.remediation || `Review and address: ${check.name}. Category: ${check.category}.`,
    }));
}
