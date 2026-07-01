/**
 * Public API — Shield Scan
 * POST /api/v1/shield/scan
 *
 * Scope: "shield:scan"
 * Accepts { text, direction?, options? } and returns the shield scan result.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { authenticateRequest } from '@/lib/middleware/api-auth';
import { shieldScan } from '@/lib/shield/scanner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const timestamp = new Date().toISOString();

  // Authenticate
  const auth = authenticateRequest(request, 'shield:scan');
  if (!auth.authenticated) {
    const res = NextResponse.json(
      { ok: false, error: auth.error, meta: { requestId, timestamp } },
      { status: auth.status || 401 },
    );
    if (auth.rateLimit) {
      res.headers.set('X-RateLimit-Limit', String(auth.rateLimit.limit));
      res.headers.set('X-RateLimit-Remaining', String(auth.rateLimit.remaining));
      res.headers.set('X-RateLimit-Reset', String(auth.rateLimit.reset));
    }
    return res;
  }

  try {
    const body = await request.json();
    const { text } = body as { text?: string };

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { ok: false, error: "Missing or invalid 'text' field", meta: { requestId, timestamp } },
        { status: 400 },
      );
    }

    if (text.length > 500000) {
      return NextResponse.json(
        { ok: false, error: 'Input exceeds maximum length of 500,000 characters', meta: { requestId, timestamp } },
        { status: 413 },
      );
    }

    const result = shieldScan(text, body.options);

    const res = NextResponse.json({
      ok: true,
      data: result,
      meta: { requestId, timestamp },
    });
    if (auth.rateLimit) {
      res.headers.set('X-RateLimit-Limit', String(auth.rateLimit.limit));
      res.headers.set('X-RateLimit-Remaining', String(auth.rateLimit.remaining));
      res.headers.set('X-RateLimit-Reset', String(auth.rateLimit.reset));
    }
    return res;
  } catch (err) {
    console.error('[Shield Scan v1] Error');
    return NextResponse.json(
      { ok: false, error: 'Internal server error', meta: { requestId, timestamp } },
      { status: 500 },
    );
  }
}
