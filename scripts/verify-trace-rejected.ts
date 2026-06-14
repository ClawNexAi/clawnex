/**
 * verify-trace-rejected.ts
 *
 * DAST 2026-05-15 #8: asserts src/middleware.ts rejects TRACE at the
 * top of the middleware function, BEFORE the nonce + RBAC paths run.
 *
 * Static check on the source, plus a live exercise of the middleware
 * function against synthetic TRACE / GET requests so we know the
 * shape (status 405, Allow header) is what the source claims.
 *
 *   npx tsx scripts/verify-trace-rejected.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { middleware } from '../src/middleware';

interface Case { name: string; ok: boolean; detail?: string }
const results: Case[] = [];

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

// ---- Static check on the source ---------------------------------------
const srcPath = path.resolve(__dirname, '..', 'src/middleware.ts');
const src = fs.readFileSync(srcPath, 'utf8');

check(
  'static: middleware checks request.method === \'TRACE\'',
  /request\.method\s*===\s*['"]TRACE['"]/.test(src),
);
check(
  'static: middleware returns status 405 on TRACE',
  /status:\s*405/.test(src),
);
check(
  'static: TRACE rejection sets Allow header',
  /headers:\s*\{\s*Allow:/.test(src),
);
// The TRACE block MUST live before the nonce generation so a scanner
// can't measure the per-request crypto.getRandomValues() time and
// can't trigger the RBAC redirect/path-allowlist logic via TRACE.
const tracePos = src.search(/request\.method\s*===\s*['"]TRACE['"]/);
const noncePos = src.search(/getRandomValues/);
check(
  'static: TRACE check appears before nonce generation',
  tracePos > 0 && noncePos > 0 && tracePos < noncePos,
  `tracePos=${tracePos} noncePos=${noncePos}`,
);

// ---- Live exercise — invoke middleware with synthetic requests --------
// NextRequest's constructor accepts a URL + init shape. We don't need
// a real Edge runtime to inspect the immediate return — TRACE returns
// before any RBAC / nonce machinery, so the simple Request → Response
// path is enough.
async function exerciseTrace(method: string) {
  // NextRequest is a thin wrapper over Request; we can hand it a plain
  // Request and the middleware reads .method + .nextUrl + .cookies. The
  // .nextUrl + .cookies accessors fail-soft on a plain Request because
  // they're added by the Next runtime. So we synthesize the shape the
  // function actually touches on the TRACE path.
  const fakeRequest = {
    method,
    headers: new Headers(),
    nextUrl: new URL('http://localhost/'),
    cookies: { get: () => undefined },
    url: 'http://localhost/',
  } as unknown as Parameters<typeof middleware>[0];
  return middleware(fakeRequest);
}

(async () => {
  try {
    const traceRes = (await exerciseTrace('TRACE')) as Response;
    check(
      'live: TRACE returns status 405',
      traceRes.status === 405,
      `got status=${traceRes.status}`,
    );
    const allow = traceRes.headers.get('Allow') || '';
    check(
      'live: TRACE response carries Allow header',
      allow.length > 0,
      `Allow="${allow}"`,
    );
    check(
      'live: Allow header does NOT advertise TRACE',
      !/\bTRACE\b/i.test(allow),
      `Allow="${allow}"`,
    );
    check(
      'live: TRACE response body is empty',
      (await traceRes.text()) === '',
    );
  } catch (err) {
    check(
      'live: TRACE invocation',
      false,
      `unexpected throw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const failures = results.filter((r) => !r.ok);
  for (const r of results) {
    const tag = r.ok ? 'PASS' : 'FAIL';
    console.log(`  ${tag}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  }
  console.log('');
  if (failures.length === 0) {
    console.log(`PASS — ${results.length}/${results.length} TRACE rejection assertions hold`);
    process.exit(0);
  }
  console.log(`FAIL — ${failures.length}/${results.length} assertion(s) failed`);
  process.exit(1);
})();
