/**
 * verify-audit-pagination-clamp.ts
 *
 * DAST 2026-05-15 #7: asserts the audit list-endpoint pagination is
 * capped at MAX_AUDIT_LIMIT (100) — both at the route boundary
 * (clampAuditLimit) and inside the service layer (listEvents).
 *
 * Wrapped by verify-audit-pagination-clamp.sh which pins
 * DATABASE_PATH=:memory: so the in-process SQLite holds no live data.
 *
 *   bash scripts/verify-audit-pagination-clamp.sh
 */

import {
  DEFAULT_AUDIT_LIMIT,
  MAX_AUDIT_LIMIT,
  clampAuditLimit,
  parseAuditLimitOrReject,
  parseAuditDateOrReject,
  listEvents,
  logEvent,
} from '../src/lib/services/audit-logger';

interface Case { name: string; ok: boolean; detail?: string }
const results: Case[] = [];

function check(name: string, got: unknown, want: unknown) {
  const ok = got === want;
  results.push({
    name,
    ok,
    detail: ok ? undefined : `got=${String(got)} want=${String(want)}`,
  });
}

// Constants are pinned at 100 — both default and max collapse to the
// same number so any value above normalizes downward without UX
// surprise.
check('constant: DEFAULT_AUDIT_LIMIT === 100', DEFAULT_AUDIT_LIMIT, 100);
check('constant: MAX_AUDIT_LIMIT === 100', MAX_AUDIT_LIMIT, 100);

// the operator's spec: missing/abc => 100, -5/0 => 1, 50 => 50, 999999 => 100
check('clamp: missing → 100', clampAuditLimit(null), 100);
check('clamp: undefined → 100', clampAuditLimit(undefined), 100);
check('clamp: empty string → 100', clampAuditLimit(''), 100);
check('clamp: "abc" → 100', clampAuditLimit('abc'), 100);
check('clamp: "Infinity" → 100', clampAuditLimit('Infinity'), 100);
check('clamp: "-5" → 1', clampAuditLimit('-5'), 1);
check('clamp: "0" → 1', clampAuditLimit('0'), 1);
check('clamp: "50" → 50', clampAuditLimit('50'), 50);
check('clamp: "999999" → 100', clampAuditLimit('999999'), 100);
check('clamp: "100" → 100', clampAuditLimit('100'), 100);

// DAST 2026-05-15 Run 2 #M4: route boundary rejects invalid/out-of-range
// instead of silently normalizing. Routes use parseAuditLimitOrReject;
// internal callers keep using clampAuditLimit.
function rejectShape(raw: string | null): string {
  const r = parseAuditLimitOrReject(raw);
  return r.ok ? `ok:${r.limit}` : 'reject';
}
check('reject: null → ok:100 (default)', rejectShape(null), `ok:${DEFAULT_AUDIT_LIMIT}`);
check('reject: "" → ok:100 (default)', rejectShape(''), `ok:${DEFAULT_AUDIT_LIMIT}`);
check('reject: "50" → ok:50', rejectShape('50'), 'ok:50');
check('reject: "100" → ok:100', rejectShape('100'), 'ok:100');
check('reject: "101" → reject (over max)', rejectShape('101'), 'reject');
check('reject: "999999" → reject', rejectShape('999999'), 'reject');
check('reject: "0" → reject (under min)', rejectShape('0'), 'reject');
check('reject: "-5" → reject', rejectShape('-5'), 'reject');
check('reject: "abc" → reject', rejectShape('abc'), 'reject');
check('reject: "Infinity" → reject', rejectShape('Infinity'), 'reject');
check('reject: "1.5" → reject (non-integer)', rejectShape('1.5'), 'reject');
check('reject: " 50 " → ok:50 (whitespace trimmed)', rejectShape(' 50 '), 'ok:50');
check('reject: "50abc" → reject (trailing garbage)', rejectShape('50abc'), 'reject');

// DAST 2026-05-16 Finding 2: since/until ISO 8601 validation.
function dateShape(raw: string | null, field: 'since' | 'until' = 'since'): string {
  const r = parseAuditDateOrReject(raw, field);
  return r.ok ? `ok:${r.value === null ? 'null' : r.value}` : 'reject';
}
check('date: null → ok:null (no filter)', dateShape(null), 'ok:null');
check('date: "" → ok:null (no filter)', dateShape(''), 'ok:null');
check('date: " " → ok:null (whitespace-only)', dateShape(' '), 'ok:null');
check('date: "2026-05-16" → ok', dateShape('2026-05-16'), 'ok:2026-05-16');
check('date: "2026-05-16T10:30:00Z" → ok', dateShape('2026-05-16T10:30:00Z'), 'ok:2026-05-16T10:30:00Z');
check('date: "2026-05-16T10:30:00.123Z" → ok', dateShape('2026-05-16T10:30:00.123Z'), 'ok:2026-05-16T10:30:00.123Z');
check('date: "2026-05-16T10:30:00+02:00" → ok', dateShape('2026-05-16T10:30:00+02:00'), 'ok:2026-05-16T10:30:00+02:00');
check('date: "notadate" → reject', dateShape('notadate'), 'reject');
check('date: "2099-13-99" → reject (invalid month/day)', dateShape('2099-13-99'), 'reject');
check('date: "2026-13-01" → reject (month 13)', dateShape('2026-13-01'), 'reject');
check('date: "2026-05-32" → reject (day 32)', dateShape('2026-05-32'), 'reject');
check('date: "2026-02-30" → reject (Feb 30)', dateShape('2026-02-30'), 'reject');
check('date: "2026/05/16" → reject (wrong separator)', dateShape('2026/05/16'), 'reject');
check('date: "2026-5-1" → reject (unpadded)', dateShape('2026-5-1'), 'reject');
check('date: "26-05-16" → reject (2-digit year)', dateShape('26-05-16'), 'reject');
check("date: \"' OR 1=1\" → reject", dateShape("' OR 1=1"), 'reject');
check('date: "2026-05-16T25:00:00Z" → reject (hour 25)', dateShape('2026-05-16T25:00:00Z'), 'reject');

// Defense-in-depth: listEvents internally re-clamps. Even though both
// audit routes call clampAuditLimit, a future internal caller could
// bypass them and pass any number directly. Seed 200 rows into the
// in-memory DB and assert that asking for 999999 still returns 100.
const ROWS = 200;
for (let i = 0; i < ROWS; i++) {
  logEvent(
    `actor-${i}`,
    'verify_action',
    'verify',
    `row-${i}`,
    `seed row ${i}`,
    'verify',
  );
}

const huge = listEvents({ limit: 999999 });
check(
  'service-DiD: listEvents({limit: 999999}) bounds safely',
  huge.length === MAX_AUDIT_LIMIT,
  true,
);

const zero = listEvents({ limit: 0 });
check(
  'service-DiD: listEvents({limit: 0}) returns ≥ 1 row (floor)',
  zero.length >= 1 && zero.length <= MAX_AUDIT_LIMIT,
  true,
);

const negative = listEvents({ limit: -5 });
check(
  'service-DiD: listEvents({limit: -5}) returns ≥ 1 row (floor)',
  negative.length >= 1 && negative.length <= MAX_AUDIT_LIMIT,
  true,
);

// NaN was the real regression: previously `Math.max(NaN, 1) = NaN`
// propagated to the SQL LIMIT placeholder. Asserts the finite-safe
// path inside clampAuditLimit handles it.
const nan = listEvents({ limit: NaN });
check(
  'service-DiD: listEvents({limit: NaN}) bounds safely (not NaN)',
  Number.isInteger(nan.length) && nan.length >= 1 && nan.length <= MAX_AUDIT_LIMIT,
  true,
);

const infinity = listEvents({ limit: Infinity });
check(
  'service-DiD: listEvents({limit: Infinity}) bounds safely',
  infinity.length >= 1 && infinity.length <= MAX_AUDIT_LIMIT,
  true,
);

const negInfinity = listEvents({ limit: -Infinity });
check(
  'service-DiD: listEvents({limit: -Infinity}) bounds safely',
  negInfinity.length >= 1 && negInfinity.length <= MAX_AUDIT_LIMIT,
  true,
);

const undef = listEvents();
check(
  'service-DiD: listEvents() (no filters) returns DEFAULT_AUDIT_LIMIT',
  undef.length === Math.min(ROWS, DEFAULT_AUDIT_LIMIT),
  true,
);

const inRange = listEvents({ limit: 50 });
check(
  'service-DiD: listEvents({limit: 50}) honors the requested page',
  inRange.length === 50,
  true,
);

const failures = results.filter((r) => !r.ok);
for (const r of results) {
  const tag = r.ok ? 'PASS' : 'FAIL';
  console.log(`  ${tag}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log('');
if (failures.length === 0) {
  console.log(`PASS — ${results.length}/${results.length} pagination-clamp assertions hold`);
  process.exit(0);
}
console.log(`FAIL — ${failures.length}/${results.length} assertion(s) failed`);
process.exit(1);
