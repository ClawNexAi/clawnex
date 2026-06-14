/**
 * HTTPS/Caddy Management API
 *
 * GET  /api/system/https — Get Caddy/HTTPS status
 * POST /api/system/https — Configure domain and generate Caddyfile
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import {
  getCaddyStatus,
  writeCaddyfile,
  getInstallInstructions,
  isValidDomain,
} from '@/lib/services/caddy-service';

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'config:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  const status = getCaddyStatus();
  const installInstructions = getInstallInstructions();

  return NextResponse.json({ ...status, installInstructions });
}

export async function POST(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'system:manage');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const body = await request.json();
    const { domain } = body;

    if (!domain || typeof domain !== 'string') {
      return NextResponse.json({ error: 'Valid domain required (e.g., clawnexai.com)' }, { status: 400 });
    }

    const normalized = domain.trim().toLowerCase();

    // Strict validation: reject anything that isn't a well-formed hostname.
    // This blocks shell metacharacters, newlines, braces, semicolons, and
    // other injection vectors before they reach the service layer.
    if (!isValidDomain(normalized)) {
      return NextResponse.json({ error: 'invalid domain' }, { status: 400 });
    }

    // Generate and write Caddyfile
    const caddyfilePath = writeCaddyfile(normalized);

    const status = getCaddyStatus();

    return NextResponse.json({
      message: `Caddyfile generated at ${caddyfilePath}`,
      domain: normalized,
      caddyfilePath,
      nextSteps: status.installed
        ? status.running
          ? 'Caddy is running. Reload with: caddy reload --config Caddyfile'
          : 'Start Caddy with: caddy start --config Caddyfile'
        : `Install Caddy first: ${getInstallInstructions()}`,
      status,
    });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
