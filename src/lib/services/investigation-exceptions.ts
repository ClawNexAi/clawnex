import { queryAll } from '@/lib/db/index';

interface ActiveDraftRow {
  target_rule_key: string;
  exception_text: string;
}

let cachedAt = 0;
let cachedByDirection: Record<'inbound' | 'outbound', Record<string, string[]>> | null = null;
const CACHE_TTL_MS = 30_000;

function load(): Record<'inbound' | 'outbound', Record<string, string[]>> {
  const now = Date.now();
  if (cachedByDirection && now - cachedAt < CACHE_TTL_MS) return cachedByDirection;
  const inbound: Record<string, string[]> = {};
  const outbound: Record<string, string[]> = {};
  const rows = queryAll<ActiveDraftRow & { direction: 'inbound' | 'outbound' | 'both' }>(
    `SELECT target_rule_key, exception_text, direction
     FROM investigation_exception_drafts
     WHERE status = 'activated'`,
  );
  for (const row of rows) {
    for (const target of row.direction === 'both' ? [inbound, outbound] : [row.direction === 'inbound' ? inbound : outbound]) {
      (target[row.target_rule_key] ||= []).push(row.exception_text);
    }
  }
  cachedAt = now;
  cachedByDirection = { inbound, outbound };
  return cachedByDirection;
}

export function getActiveInvestigationExceptions(direction: 'inbound' | 'outbound'): Record<string, string[]> {
  return load()[direction];
}

export function invalidateInvestigationExceptionCache(): void {
  cachedAt = 0;
  cachedByDirection = null;
}

export function mergeExceptionOverlays(
  base: Record<string, string[]>,
  candidate?: Record<string, string[]>,
): Record<string, string[]> {
  if (!candidate) return base;
  const merged: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(base)) merged[key] = [...values];
  for (const [key, values] of Object.entries(candidate)) {
    merged[key] = [...(merged[key] || []), ...values];
  }
  return merged;
}
