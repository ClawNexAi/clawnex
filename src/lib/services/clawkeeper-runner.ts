/**
 * ClawNex Clawkeeper Runner
 *
 * Executes Clawkeeper scans, parses text output into structured results,
 * and stores them in the database.
 *
 * Clawkeeper outputs ANSI-colored text with Unicode symbols:
 *   checkmark = PASS, X = FAIL, warning = WARN, circle-slash = SKIP
 *   Phase headers: "Phase N of M: Category Name"
 *   Grade line: "Security Grade: D (55% of checks passing)"
 *   Summary: "Passed: 31 / Failed: 25 / Accepted: 1"
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { run, queryAll, queryOne } from '../db/index';
import { findHostSecurityScanner, missingHostSecurityScannerMessage } from './host-security/scanner-path';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CheckStatus = 'PASS' | 'FAIL' | 'WARN' | 'SKIP' | 'INFO';
export type SeverityLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export interface ClawkeeperCheck {
  checkId: string;       // e.g. CK-001
  name: string;          // description text
  status: CheckStatus;
  severity: SeverityLevel;
  category: string;
  detail: string;
  remediation: string;
}

export interface ClawkeeperScanResult {
  id: string;
  scanner: string;
  overallGrade: string;
  overallScore: number;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  warnedChecks: number;
  skippedChecks: number;
  checks: ClawkeeperCheck[];
  rawOutput: string;
  scannedAt: string;
}

// Track whether a scan is currently running
let activeScan: Promise<ClawkeeperScanResult> | null = null;

// ---------------------------------------------------------------------------
// ANSI Stripping
// ---------------------------------------------------------------------------

function stripAnsi(text: string): string {
  // Replace cursor-positioning escapes (e.g. \x1b[42G) with column separator
  // eslint-disable-next-line no-control-regex
  let cleaned = text.replace(/\x1b\[\d+G/g, '     ');
  // Strip remaining ANSI escape codes
  // eslint-disable-next-line no-control-regex
  cleaned = cleaned.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  return cleaned;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function scoreToGrade(score: number): string {
  if (score >= 95) return 'A';
  if (score >= 90) return 'A-';
  if (score >= 85) return 'B';
  if (score >= 80) return 'B-';
  if (score >= 75) return 'C';
  if (score >= 70) return 'C-';
  if (score >= 65) return 'D';
  if (score >= 60) return 'D-';
  return 'F';
}

function gradeToScore(grade: string): number {
  const map: Record<string, number> = {
    'A+': 98, 'A': 95, 'A-': 90,
    'B+': 88, 'B': 85, 'B-': 80,
    'C+': 78, 'C': 75, 'C-': 70,
    'D+': 68, 'D': 65, 'D-': 60,
    'F': 40,
  };
  return map[grade.toUpperCase()] || 50;
}

/**
 * Parse the grade and score from Clawkeeper output.
 */
function parseGrade(clean: string): { grade: string; score: number } {
  // Match: "Security Grade: D (55% of checks passing)"
  const gradeMatch = clean.match(/Security\s+Grade:\s*([A-F][+-]?)\s*\((\d+)%/i);
  if (gradeMatch) {
    return { grade: gradeMatch[1].toUpperCase(), score: parseInt(gradeMatch[2], 10) };
  }

  // Fallback: compute from summary line counts
  const passedMatch = clean.match(/Passed:\s*(\d+)/i);
  const failedMatch = clean.match(/Failed:\s*(\d+)/i);
  if (passedMatch && failedMatch) {
    const passed = parseInt(passedMatch[1], 10);
    const failed = parseInt(failedMatch[1], 10);
    const total = passed + failed;
    const score = total > 0 ? Math.round((passed / total) * 100) : 0;
    return { grade: scoreToGrade(score), score };
  }

  // Fallback: generic "Grade: X" pattern
  const altMatch = clean.match(/Grade:\s*([A-F][+-]?)/i);
  if (altMatch) {
    const g = altMatch[1].toUpperCase();
    return { grade: g, score: gradeToScore(g) };
  }

  return { grade: 'N/A', score: 0 };
}

/**
 * Infer category from phase name and check name.
 */
function inferCategory(phaseName: string, checkName: string): string {
  const p = phaseName.toLowerCase();
  if (p.includes('host hardening') || p.includes('macos')) return 'Host Hardening';
  if (p.includes('network')) return 'Network';
  if (p.includes('prerequisit')) return 'Prerequisites';
  if (p.includes('installation')) return 'Installation';
  if (p.includes('security audit')) return 'Security Audit';

  // Name-based fallback
  const n = checkName.toLowerCase();
  if (n.includes('firewall') || n.includes('network') || n.includes('port') || n.includes('ssh') || n.includes('mdns') || n.includes('screen sharing') || n.includes('remote login')) return 'Network';
  if (n.includes('filevault') || n.includes('permission') || n.includes('filesystem') || n.includes('directory')) return 'Filesystem';
  if (n.includes('auth') || n.includes('password') || n.includes('login') || n.includes('user') || n.includes('account')) return 'Authentication';
  if (n.includes('encrypt') || n.includes('ssl') || n.includes('tls') || n.includes('credential')) return 'Encryption';
  if (n.includes('log') || n.includes('redact')) return 'Logging';
  if (n.includes('sandbox') || n.includes('exec') || n.includes('policy')) return 'Sandboxing';
  if (n.includes('skill')) return 'Skills';
  if (n.includes('config') || n.includes('gateway') || n.includes('discovery') || n.includes('bind') || n.includes('dm ')) return 'Configuration';
  return 'General';
}

/**
 * Determine severity based on status and category.
 */
function inferSeverity(status: CheckStatus, category: string): SeverityLevel {
  if (status === 'PASS' || status === 'SKIP') return 'INFO';

  if (category === 'Security Audit' || category === 'Encryption' || category === 'Sandboxing') {
    return status === 'FAIL' ? 'HIGH' : 'MEDIUM';
  }
  if (category === 'Network') {
    return status === 'FAIL' ? 'HIGH' : 'MEDIUM';
  }
  if (category === 'Skills') {
    return status === 'FAIL' ? 'CRITICAL' : 'HIGH';
  }
  if (category === 'Host Hardening') {
    return status === 'FAIL' ? 'MEDIUM' : 'LOW';
  }
  return status === 'FAIL' ? 'MEDIUM' : 'LOW';
}

/**
 * Parse the full Clawkeeper output into structured check results.
 *
 * After stripping ANSI, the output uses Unicode symbols:
 *   \u2713 (checkmark) = PASS
 *   \u2717 (ballot X) = FAIL
 *   \u2718 (heavy ballot X) = FAIL
 *   \u26A0 (warning sign) = WARN
 *   \u2298 (circled division slash) = SKIP
 */
export function parseResults(output: string): Omit<ClawkeeperScanResult, 'id' | 'rawOutput' | 'scannedAt'> {
  const clean = stripAnsi(output);
  const lines = clean.split('\n');
  const checks: ClawkeeperCheck[] = [];
  let currentPhase = 'General';
  let checkIndex = 0;
  let lastDetail = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Phase headers: "Phase N of M: Category Name" or "=== Phase N..."
    const phaseMatch = line.match(/Phase\s+\d+\s+of\s+\d+:\s*(.+)/i);
    if (phaseMatch) {
      currentPhase = phaseMatch[1].replace(/[=\s]+$/, '').trim();
      continue;
    }

    // Skip decorative/summary/header lines
    if (line.match(/^[═─┌┐└┘│┤├]+/) || line.includes('Clawkeeper Security Scan') ||
        line.match(/^Read-only audit/) || line.match(/^macOS\s/) ||
        line.match(/^\d+ passed/) || line.match(/^Security Grade:/) ||
        line.match(/^Passed:/) || line.match(/^Failed:/) || line.match(/^Accepted:/)) {
      continue;
    }

    // Step headers provide detail context
    const stepMatch = line.match(/^Step\s+\d+:\s*(.+)/i);
    if (stepMatch) {
      continue;
    }

    // Detail/remediation lines (start with arrow)
    if (line.startsWith('\u2192') || line.startsWith('->') || line.startsWith('Move skill')) {
      lastDetail = line.replace(/^[\u2192\->]+\s*/, '').trim();
      // Attach to last check if it was a FAIL/WARN
      if (checks.length > 0) {
        const last = checks[checks.length - 1];
        if (last.status === 'FAIL' || last.status === 'WARN') {
          if (!last.remediation) {
            last.remediation = lastDetail;
          } else {
            last.detail = last.detail ? last.detail + '; ' + lastDetail : lastDetail;
          }
        }
      }
      continue;
    }

    // Now parse check symbols from the line
    // Lines can contain multiple checks separated by column markers or wide whitespace
    // Split on wide gaps (column separator) — Clawkeeper uses column alignment
    const segments = line.split(/\s{3,}/).filter(s => s.trim());

    for (const seg of segments) {
      const s = seg.trim();
      if (!s || s.length < 2) continue;

      let status: CheckStatus | null = null;
      let name = '';

      // PASS: checkmark symbol + name
      if (s.startsWith('\u2713') || s.startsWith('\u2714')) {
        status = 'PASS';
        name = s.replace(/^[\u2713\u2714]\s*/, '').trim();
      }
      // FAIL: X symbol + name
      else if (s.startsWith('\u2717') || s.startsWith('\u2718') || s.startsWith('\u2716') || s.startsWith('\u00d7')) {
        status = 'FAIL';
        name = s.replace(/^[\u2717\u2718\u2716\u00d7]\s*/, '').trim();
      }
      // WARN: warning symbol + name
      else if (s.startsWith('\u26A0')) {
        status = 'WARN';
        name = s.replace(/^\u26A0\uFE0F?\s*/, '').trim();
      }
      // SKIP: circled slash + name
      else if (s.startsWith('\u2298')) {
        status = 'SKIP';
        name = s.replace(/^\u2298\s*/, '').trim();
      }

      if (status && name && name.length > 1) {
        // Skip summary counters like "31 passed" "25 failed"
        if (name.match(/^\d+\s+(passed|failed|skipped|accepted)/i)) continue;
        // Remove trailing annotations like "(risk)"
        name = name.replace(/\s*\(risk\)\s*$/, '').trim();
        if (!name) continue;

        checkIndex++;
        const category = inferCategory(currentPhase, name);
        checks.push({
          checkId: `CK-${String(checkIndex).padStart(3, '0')}`,
          name,
          status,
          severity: inferSeverity(status, category),
          category,
          detail: '',
          remediation: '',
        });
      }
    }
  }

  // Deduplicate checks with same name and status (Clawkeeper sometimes repeats for multiple paths)
  const seen = new Set<string>();
  const deduped: ClawkeeperCheck[] = [];
  for (const check of checks) {
    const key = `${check.status}:${check.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(check);
    }
  }

  // Re-index after dedup
  deduped.forEach((c, i) => { c.checkId = `CK-${String(i + 1).padStart(3, '0')}`; });

  const { grade, score } = parseGrade(clean);
  const passed = deduped.filter(c => c.status === 'PASS').length;
  const failed = deduped.filter(c => c.status === 'FAIL').length;
  const warned = deduped.filter(c => c.status === 'WARN').length;
  const skipped = deduped.filter(c => c.status === 'SKIP').length;

  return {
    scanner: 'clawkeeper',
    overallGrade: grade,
    overallScore: score,
    totalChecks: deduped.length,
    passedChecks: passed,
    failedChecks: failed,
    warnedChecks: warned,
    skippedChecks: skipped,
    checks: deduped,
  };
}

// ---------------------------------------------------------------------------
// Database Operations
// ---------------------------------------------------------------------------

function storeScan(result: ClawkeeperScanResult): void {
  const scanId = result.id;

  run(
    `INSERT OR REPLACE INTO security_scans (id, scanner, overall_grade, overall_score, total_checks, passed_checks, failed_checks, raw_output, parsed_results, scanned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      scanId,
      result.scanner,
      result.overallGrade,
      result.overallScore,
      result.totalChecks,
      result.passedChecks,
      result.failedChecks,
      result.rawOutput,
      JSON.stringify(result),
      result.scannedAt,
    ]
  );

  // Store individual check results
  for (const check of result.checks) {
    run(
      `INSERT OR REPLACE INTO security_check_results (id, scan_id, check_id, check_name, category, status, severity, detail, remediation, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `${scanId}-${check.checkId}`,
        scanId,
        check.checkId,
        check.name,
        check.category,
        check.status,
        check.severity,
        check.detail,
        check.remediation,
        result.scannedAt,
      ]
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a Clawkeeper scan (non-interactive), parse, and store results.
 */
export async function runScan(): Promise<ClawkeeperScanResult> {
  // If a scan is already running, return it
  if (activeScan) return activeScan;

  const scanPromise = (async () => {
    const scanner = findHostSecurityScanner();
    if (!scanner) {
      throw new Error(missingHostSecurityScannerMessage());
    }
    const scanId = randomUUID();
    const scannedAt = new Date().toISOString();

    let rawOutput: string;
    try {
      const { stdout, stderr } = await execFileAsync('bash', [scanner.path, 'scan', '--non-interactive'], {
        timeout: 120_000, // 2 minute timeout
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, TERM: 'dumb' },
      });
      rawOutput = stdout + (stderr ? '\n' + stderr : '');
    } catch (err: unknown) {
      // Clawkeeper may exit non-zero on failures — still parse output
      const execErr = err as { stdout?: string; stderr?: string; message?: string };
      if (execErr.stdout) {
        rawOutput = execErr.stdout + (execErr.stderr ? '\n' + execErr.stderr : '');
      } else {
        throw new Error(`Clawkeeper execution failed: ${execErr.message || 'Unknown error'}`);
      }
    }

    const parsed = parseResults(rawOutput);
    const result: ClawkeeperScanResult = {
      id: scanId,
      ...parsed,
      rawOutput,
      scannedAt,
    };

    // Store in DB
    try {
      storeScan(result);
    } catch (dbErr) {
      console.error('[CLAWKEEPER] Failed to store scan results:', dbErr);
    }

    return result;
  })();

  activeScan = scanPromise;
  try {
    return await scanPromise;
  } finally {
    activeScan = null;
  }
}

/**
 * Get the most recent scan from DB.
 */
export function getLastScan(): ClawkeeperScanResult | null {
  const row = queryOne<{ parsed_results: string }>(
    `SELECT parsed_results FROM security_scans ORDER BY scanned_at DESC LIMIT 1`
  );
  if (!row) return null;
  try {
    return JSON.parse(row.parsed_results) as ClawkeeperScanResult;
  } catch {
    return null;
  }
}

/**
 * List scan history.
 */
export function listScans(limit = 20): Array<{
  id: string;
  scanner: string;
  overallGrade: string;
  overallScore: number;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  scannedAt: string;
}> {
  return queryAll<{
    id: string;
    scanner: string;
    overall_grade: string;
    overall_score: number;
    total_checks: number;
    passed_checks: number;
    failed_checks: number;
    scanned_at: string;
  }>(
    `SELECT id, scanner, overall_grade, overall_score, total_checks, passed_checks, failed_checks, scanned_at
     FROM security_scans ORDER BY scanned_at DESC LIMIT ?`,
    [limit]
  ).map(row => ({
    id: row.id,
    scanner: row.scanner,
    overallGrade: row.overall_grade,
    overallScore: row.overall_score,
    totalChecks: row.total_checks,
    passedChecks: row.passed_checks,
    failedChecks: row.failed_checks,
    scannedAt: row.scanned_at,
  }));
}

/**
 * Check whether a scan is currently running.
 */
export function isScanRunning(): boolean {
  return activeScan !== null;
}
