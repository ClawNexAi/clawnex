// In-memory 60s-TTL cache for PermissivenessReport.
// Manual clearCache() available for tests and for the API route's
// ?refresh=true path.

import type { PermissivenessReport } from "./types";

export const DEFAULT_TTL_MS = 60_000;

let cached: { report: PermissivenessReport; expiresAt: number } | null = null;

export function getCached(): PermissivenessReport | null {
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    cached = null;
    return null;
  }
  return cached.report;
}

export function setCached(report: PermissivenessReport, ttlMs: number = DEFAULT_TTL_MS): void {
  cached = { report, expiresAt: Date.now() + ttlMs };
}

export function clearCache(): void {
  cached = null;
}
