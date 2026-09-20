import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { isProxyServiceEndpoint } from './proxy-service-paths';

export function isAuthenticatedProxyService(request: NextRequest): boolean {
  if (!isProxyServiceEndpoint(request.nextUrl.pathname, request.method)) return false;
  const secret = process.env.CLAWNEX_INGEST_SECRET;
  const supplied = request.headers.get('x-clawnex-ingest-secret');
  if (!secret || !supplied) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(supplied);
  return expected.length >= 32 && actual.length === expected.length && timingSafeEqual(actual, expected);
}
