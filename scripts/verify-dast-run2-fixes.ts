import { NextRequest } from 'next/server';
import { GET as health } from '../src/app/api/health/route';
import { POST as chat } from '../src/app/api/chat/route';
import { middleware } from '../src/middleware';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  const healthRes = await health();
  const healthBody = await healthRes.json();
  check('/api/health omits version', !Object.prototype.hasOwnProperty.call(healthBody, 'version'), JSON.stringify(healthBody));
  check('/api/health omits uptime', !Object.prototype.hasOwnProperty.call(healthBody, 'uptime'), JSON.stringify(healthBody));
  check('/api/health keeps liveness fields', healthBody.status === 'ok' && healthBody.name === 'ClawNex' && typeof healthBody.timestamp === 'string');

  const nonJsonChat = await chat(new NextRequest('http://127.0.0.1:5001/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'text/plain', origin: 'http://127.0.0.1:5001' },
    body: 'hello',
  }) as unknown as NextRequest);
  check('/api/chat non-JSON rejected before parse', nonJsonChat.status === 415, `status=${nonJsonChat.status}`);

  const badJsonChat = await chat(new NextRequest('http://127.0.0.1:5001/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5001' },
    body: '{bad',
  }) as unknown as NextRequest);
  check('/api/chat malformed JSON is 400', badJsonChat.status === 400, `status=${badJsonChat.status}`);

  // /api/health policy: burst 5/10s, sustained 10/min. 12 rapid hits
  // trip burst at hit 6.
  const healthStatuses: number[] = [];
  for (let i = 0; i < 12; i += 1) {
    const res = middleware(new NextRequest('http://clawnex.local/api/health', {
      headers: { 'x-forwarded-for': '198.51.100.77' },
    }));
    healthStatuses.push(res.status);
  }
  check(
    'middleware rate limit: /api/health 429 by hit 6 (burst=5/10s)',
    healthStatuses.slice(0, 5).every((s) => s === 200) && healthStatuses[5] === 429,
    healthStatuses.join(','),
  );

  // Generic /api/* policy: burst 10/10s. DAST 2026-05-15 Run 2 #H5:
  // 15 rapid requests should land 429 in the burst window.
  const apiStatuses: number[] = [];
  for (let i = 0; i < 15; i += 1) {
    const res = middleware(new NextRequest('http://clawnex.local/api/audit', {
      headers: { 'x-forwarded-for': '198.51.100.88' },
    }));
    apiStatuses.push(res.status);
  }
  check(
    'middleware rate limit: /api/* 429 by hit 11 on 15-rapid burst (burst=10/10s)',
    apiStatuses.slice(0, 10).every((s) => s === 200) && apiStatuses[10] === 429,
    apiStatuses.join(','),
  );

  if (failed > 0) process.exit(1);
  console.log('PASS — DAST Run 2 targeted fix harness green');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
