import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type HostSecurityScannerSource = 'env' | 'bundled' | 'legacy';

export interface HostSecurityScannerCandidate {
  source: HostSecurityScannerSource;
  path: string;
  label: string;
}

export interface HostSecurityScannerResult extends HostSecurityScannerCandidate {
  mtime: Date;
}

export const BUNDLED_SCANNER_RELATIVE_PATH = path.join('third_party', 'clawkeeper', 'clawkeeper.sh');

export function getBundledScannerPath(): string {
  return path.join(process.cwd(), BUNDLED_SCANNER_RELATIVE_PATH);
}

export function getLegacyScannerPath(): string {
  return path.join(os.homedir(), '.local', 'bin', 'clawkeeper.sh');
}

export function getHostSecurityScannerCandidates(): HostSecurityScannerCandidate[] {
  const candidates: HostSecurityScannerCandidate[] = [];
  if (process.env.CLAWKEEPER_BINARY) {
    candidates.push({
      source: 'env',
      path: process.env.CLAWKEEPER_BINARY,
      label: 'CLAWKEEPER_BINARY override',
    });
  }
  candidates.push({
    source: 'bundled',
    path: getBundledScannerPath(),
    label: 'built into ClawNex',
  });
  candidates.push({
    source: 'legacy',
    path: getLegacyScannerPath(),
    label: 'legacy Clawkeeper binary',
  });
  return candidates;
}

export function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findHostSecurityScanner(): HostSecurityScannerResult | null {
  for (const candidate of getHostSecurityScannerCandidates()) {
    try {
      fs.accessSync(candidate.path, fs.constants.X_OK);
      const stats = fs.statSync(candidate.path);
      return {
        ...candidate,
        mtime: stats.mtime,
      };
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

export function missingHostSecurityScannerMessage(): string {
  const expected = getHostSecurityScannerCandidates()
    .map(candidate => `${candidate.label} at ${candidate.path}`)
    .join(' or ');
  return `Host security scanner not available. Expected ${expected}`;
}
