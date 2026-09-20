import { NextRequest, NextResponse } from 'next/server';
import { authorizeAnythingRelay } from '@/lib/services/anythingllm-routing';
import { ROUTING_IDENTITY_HEADER } from '@/lib/services/routing-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const fields = new Set(['model', 'messages', 'stream', 'stream_options', 'temperature', 'top_p', 'max_tokens', 'max_completion_tokens', 'stop', 'presence_penalty', 'frequency_penalty', 'tools', 'tool_choice', 'parallel_tool_calls', 'response_format', 'seed', 'reasoning_effort']);
const active = new Map<string, { count: number; requests: number; start: number }>();
const error = (message: string, status: number) => NextResponse.json({ error: { message, type: 'clawnex_routing_error' } }, { status });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/.test(id)) return error('Invalid connector.', 404);
  try { if (!authorizeAnythingRelay(id, request.headers.get('authorization'))) return error('Invalid or inactive connector key.', 401); }
  catch { return error('Invalid or inactive connector key.', 401); }
  // Bound the actual stream, not only the untrusted Content-Length header.
  const reader = request.body?.getReader();
  if (!reader) return error('A chat request is required.', 400);
  const chunks: Uint8Array[] = []; let size = 0;
  let timedOut = false;
  const deadline = setTimeout(() => { timedOut = true; void reader.cancel(); }, 10_000);
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > 2 * 1024 * 1024) { await reader.cancel(); return error('Request too large.', 413); }
      chunks.push(chunk.value);
    }
  } catch { return error('Cannot read chat request.', 400); }
  finally { clearTimeout(deadline); }
  if (timedOut) return error('Request body timed out.', 408);
  let body: Record<string, unknown>;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return error('Invalid JSON.', 400); }
  if (!body || typeof body.model !== 'string' || !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 1000) return error('Model and messages are required.', 400);
  // Strip all provider override, proxy metadata, credential, and attribution fields.
  const safeBody = Object.fromEntries(Object.entries(body).filter(([key]) => fields.has(key)));
  let identity;
  try { identity = authorizeAnythingRelay(id, request.headers.get('authorization'), body.model); } catch { identity = null; }
  if (!identity) return error('Invalid connector key, inactive route, or unapproved model.', 401);
  for (const [key, entry] of active) if (!entry.count && Date.now() - entry.start > 60_000) active.delete(key);
  const bucket = active.get(id) || { count: 0, requests: 0, start: Date.now() };
  if (Date.now() - bucket.start > 60_000) { bucket.requests = 0; bucket.start = Date.now(); }
  if (bucket.count >= 4 || bucket.requests >= 60) return error('Connector request limit reached. Retry shortly.', 429);
  bucket.count++; bucket.requests++; active.set(id, bucket);
  let released = false;
  const release = () => { if (!released) { bucket.count--; released = true; } };
  const port = Number(process.env.LITELLM_PORT || '4001');
  if (!Number.isInteger(port) || port < 1 || port > 65535) { release(); return error('Proxy configuration is invalid.', 503); }
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]),
      headers: { 'Content-Type': 'application/json', [ROUTING_IDENTITY_HEADER]: identity.token,
        ...(process.env.LITELLM_MASTER_KEY ? { Authorization: `Bearer ${process.env.LITELLM_MASTER_KEY}` } : {}) },
      body: JSON.stringify(safeBody),
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel(); release();
      return error('ClawNex proxy rejected the request. Check Traffic Monitor and Shield for details.', response.status >= 400 ? response.status : 502);
    }
    const upstream = response.body.getReader();
    const stream = new ReadableStream({
      async pull(controller) {
        try { const chunk = await upstream.read(); if (chunk.done) { release(); controller.close(); } else controller.enqueue(chunk.value); }
        catch (cause) { release(); controller.error(cause); }
      },
      async cancel() { release(); await upstream.cancel(); },
    });
    return new Response(stream, { status: response.status, headers: { 'Content-Type': response.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
  } catch { release(); return error('ClawNex proxy is unavailable or the request timed out.', 502); }
}
