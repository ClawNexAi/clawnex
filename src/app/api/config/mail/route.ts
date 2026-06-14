/**
 * Mail Configuration API
 * GET  /api/config/mail — get current mail config (keys masked)
 * PUT  /api/config/mail — update mail config
 * POST /api/config/mail — send test email
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, requirePermission, getOperatorFromRequest } from '@/lib/rbac/guard';
import { isRbacEnabled } from '@/lib/rbac/guard';
import { queryOne, run } from '@/lib/db/index';
import { getMailConfig, testMailConfig } from '@/lib/services/mail-service';
import { logEvent } from '@/lib/services/audit-logger';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getSetting(key: string): string {
  try {
    const row = queryOne<{ value: string }>('SELECT value FROM config_defaults WHERE key = ?', [key]);
    return row?.value ?? '';
  } catch {
    return '';
  }
}

function setSetting(key: string, value: string): void {
  const existing = queryOne<{ key: string }>('SELECT key FROM config_defaults WHERE key = ?', [key]);
  if (existing) {
    run('UPDATE config_defaults SET value = ? WHERE key = ?', [value, key]);
  } else {
    run('INSERT INTO config_defaults (key, value) VALUES (?, ?)', [key, value]);
  }
}

function maskKey(key: string): string {
  if (!key || key.length < 8) return key ? '****' : '';
  return key.substring(0, 6) + '...' + key.substring(key.length - 4);
}

// ---------------------------------------------------------------------------
// Input validation (adversarial review finding #3, 2026-04-24)
// ---------------------------------------------------------------------------
//
// These fields land in mail headers (fromEmail), fetch URLs (smtpHost), and
// provider-routing decisions (provider). An admin with write access who
// sets e.g. smtpHost to their own server would silently redirect every
// outbound mail (password resets, alerts) to themselves. CRLF in fromEmail
// could inject headers (Bcc/Cc) in downstream SMTP libraries that don't
// normalize. The whitelists + length caps + CRLF rejection below close
// those holes. Each helper returns null for "invalid" so the caller can
// surface a 400 before any DB write.

/** Whitelist of valid mail providers — mirrors MailConfig.provider union. */
const ALLOWED_PROVIDERS = new Set(['resend', 'smtp', 'emailit', 'none']);

/** Reject CRLF + cap length; returns null on failure. Header-safe fields only. */
function sanitizeHeaderField(v: unknown, maxLen: number): string | null {
  if (typeof v !== 'string') return null;
  if (v.length > maxLen) return null;
  if (/[\r\n\0]/.test(v)) return null;
  return v;
}

/** Validate an integer in [min, max]. Accepts numbers or numeric strings. */
function sanitizePort(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  return n;
}

/** Accept boolean or the strings "true"/"false" (body values arrive as JSON). */
function sanitizeBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
}

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

  const config = getMailConfig();

  return NextResponse.json({
    provider: config.provider,
    fromEmail: config.fromEmail,
    resend: {
      apiKey: config.resendApiKey ? maskKey(config.resendApiKey) : '',
      configured: !!config.resendApiKey,
    },
    smtp: {
      host: config.smtpHost || '',
      port: config.smtpPort || 587,
      username: config.smtpUsername || '',
      password: config.smtpPassword ? '••••••••' : '',
      tls: config.smtpTls !== false,
      configured: !!(config.smtpHost && config.smtpUsername),
    },
    emailit: {
      apiKey: config.emailitApiKey ? maskKey(config.emailitApiKey) : '',
      configured: !!config.emailitApiKey,
    },
  });
}

export async function PUT(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'config:write');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const body = await request.json();
    const { provider, fromEmail, resendApiKey, smtpHost, smtpPort, smtpUsername, smtpPassword, smtpTls, emailitApiKey } = body;

    // Validate each field before persisting (review finding #3). Rejecting
    // early keeps bad values out of the DB instead of surfacing at send-time.
    if (provider !== undefined) {
      if (typeof provider !== 'string' || !ALLOWED_PROVIDERS.has(provider)) {
        return NextResponse.json({ error: 'Invalid provider. Must be one of: resend, smtp, emailit, none.' }, { status: 400 });
      }
      setSetting('mail_provider', provider);
    }
    if (fromEmail !== undefined) {
      const clean = sanitizeHeaderField(fromEmail, 320);
      if (clean === null) return NextResponse.json({ error: 'Invalid fromEmail (CRLF or length).' }, { status: 400 });
      setSetting('mail_from_email', clean);
    }
    if (resendApiKey !== undefined) {
      const clean = sanitizeHeaderField(resendApiKey, 200);
      if (clean === null) return NextResponse.json({ error: 'Invalid resendApiKey.' }, { status: 400 });
      setSetting('mail_resend_api_key', clean);
    }
    if (smtpHost !== undefined) {
      const clean = sanitizeHeaderField(smtpHost, 253);
      if (clean === null) return NextResponse.json({ error: 'Invalid smtpHost.' }, { status: 400 });
      setSetting('mail_smtp_host', clean);
    }
    if (smtpPort !== undefined) {
      const port = sanitizePort(smtpPort);
      if (port === null) return NextResponse.json({ error: 'Invalid smtpPort (must be 1-65535).' }, { status: 400 });
      setSetting('mail_smtp_port', String(port));
    }
    if (smtpUsername !== undefined) {
      const clean = sanitizeHeaderField(smtpUsername, 320);
      if (clean === null) return NextResponse.json({ error: 'Invalid smtpUsername.' }, { status: 400 });
      setSetting('mail_smtp_username', clean);
    }
    if (smtpPassword !== undefined) {
      // Password permits CRLF-free printable content; upper-bound generously.
      const clean = sanitizeHeaderField(smtpPassword, 512);
      if (clean === null) return NextResponse.json({ error: 'Invalid smtpPassword.' }, { status: 400 });
      setSetting('mail_smtp_password', clean);
    }
    if (smtpTls !== undefined) {
      const b = sanitizeBool(smtpTls);
      if (b === null) return NextResponse.json({ error: 'Invalid smtpTls.' }, { status: 400 });
      setSetting('mail_smtp_tls', String(b));
    }
    // Emailit (v0.9.0+) — empty string preserves existing key (mask round-trip safety).
    if (emailitApiKey !== undefined && emailitApiKey !== '' && !String(emailitApiKey).startsWith('•')) {
      const clean = sanitizeHeaderField(emailitApiKey, 200);
      if (clean === null) return NextResponse.json({ error: 'Invalid emailitApiKey.' }, { status: 400 });
      setSetting('mail_emailit_api_key', clean);
    }

    // Audit
    const operator = getOperatorFromRequest(request);
    logEvent(
      operator?.username || 'admin', 'mail_config_updated', 'config', 'mail',
      `Mail provider set to: ${provider || getSetting('mail_provider') || 'none'}`, 'dashboard',
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[API/config/mail] PUT error:', err);
    return NextResponse.json({ error: 'Failed to update mail config' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'config:write');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const body = await request.json();
    const { testTo } = body as { testTo?: string };

    if (!testTo) {
      return NextResponse.json({ error: 'testTo email is required' }, { status: 400 });
    }

    const result = await testMailConfig(testTo);

    return NextResponse.json(result);
  } catch (err) {
    console.error('[API/config/mail] POST error:', err);
    return NextResponse.json({ error: 'Test failed' }, { status: 500 });
  }
}
