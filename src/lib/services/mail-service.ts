/**
 * ClawNex Mail Service — abstraction over Resend and SMTP.
 *
 * Reads provider config from config_defaults (set via Configuration panel).
 * Falls back to env vars for backward compatibility.
 *
 * @module services/mail-service
 */

import { queryOne } from '../db/index';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MailConfig {
  provider: 'resend' | 'smtp' | 'emailit' | 'none';
  fromEmail: string;
  // Resend
  resendApiKey?: string;
  // SMTP
  smtpHost?: string;
  smtpPort?: number;
  smtpUsername?: string;
  smtpPassword?: string;
  smtpTls?: boolean;
  /**
   * Opt-in to skip TLS certificate verification.
   * ONLY for testing against self-signed SMTP servers; never enable in production.
   * Defaults to false (strict verification).
   */
  smtpAllowInsecure?: boolean;
  // Emailit (v0.9.0+) — REST API at https://api.emailit.com/v2/emails
  emailitApiKey?: string;
}

interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

function getSetting(key: string): string | null {
  try {
    const row = queryOne<{ value: string }>('SELECT value FROM config_defaults WHERE key = ?', [key]);
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export function getMailConfig(): MailConfig {
  const provider = (getSetting('mail_provider') || process.env.MAIL_PROVIDER || 'none') as MailConfig['provider'];
  const fromEmail = getSetting('mail_from_email') || process.env.RESEND_FROM_EMAIL || 'ClawNex <noreply@clawnexai.com>';

  if (provider === 'resend') {
    return {
      provider,
      fromEmail,
      resendApiKey: getSetting('mail_resend_api_key') || process.env.RESEND_API_KEY || '',
    };
  }

  if (provider === 'smtp') {
    return {
      provider,
      fromEmail,
      smtpHost: getSetting('mail_smtp_host') || process.env.SMTP_HOST || '',
      smtpPort: parseInt(getSetting('mail_smtp_port') || process.env.SMTP_PORT || '587', 10),
      smtpUsername: getSetting('mail_smtp_username') || process.env.SMTP_USERNAME || '',
      smtpPassword: getSetting('mail_smtp_password') || process.env.SMTP_PASSWORD || '',
      smtpTls: (getSetting('mail_smtp_tls') || process.env.SMTP_TLS || 'true') === 'true',
      smtpAllowInsecure: (getSetting('mail_smtp_allow_insecure') || process.env.SMTP_ALLOW_INSECURE || 'false') === 'true',
    };
  }

  if (provider === 'emailit') {
    return {
      provider,
      fromEmail,
      emailitApiKey: getSetting('mail_emailit_api_key') || process.env.EMAILIT_API_KEY || '',
    };
  }

  return { provider: 'none', fromEmail };
}

export function isMailConfigured(): boolean {
  const config = getMailConfig();
  if (config.provider === 'resend') return !!config.resendApiKey;
  if (config.provider === 'smtp') return !!config.smtpHost && !!config.smtpUsername;
  if (config.provider === 'emailit') return !!config.emailitApiKey;
  return false;
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export async function sendMail(options: SendMailOptions): Promise<{ ok: boolean; error?: string }> {
  const config = getMailConfig();

  if (config.provider === 'none') {
    return { ok: false, error: 'Mail not configured. Set up a mail provider in Configuration.' };
  }

  if (config.provider === 'resend') {
    return sendViaResend(config, options);
  }

  if (config.provider === 'smtp') {
    return sendViaSmtp(config, options);
  }

  if (config.provider === 'emailit') {
    return sendViaEmailit(config, options);
  }

  return { ok: false, error: `Unknown mail provider: ${config.provider}` };
}

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------

async function sendViaResend(config: MailConfig, options: SendMailOptions): Promise<{ ok: boolean; error?: string }> {
  if (!config.resendApiKey) {
    return { ok: false, error: 'Resend API key not configured' };
  }

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(config.resendApiKey);

    const result = await resend.emails.send({
      from: config.fromEmail,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });

    if (result.error) {
      return { ok: false, error: result.error.message };
    }

    return { ok: true };
  } catch (err) {
    console.error('[MailService/Resend] Error:', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Resend send failed' };
  }
}

// ---------------------------------------------------------------------------
// SMTP
// ---------------------------------------------------------------------------

async function sendViaSmtp(config: MailConfig, options: SendMailOptions): Promise<{ ok: boolean; error?: string }> {
  if (!config.smtpHost || !config.smtpUsername) {
    return { ok: false, error: 'SMTP not fully configured' };
  }

  try {
    // Dynamic import nodemailer — it's a peer dependency, not required for Resend-only setups
    const nodemailer = await import('nodemailer');

    const transport = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort || 587,
      secure: config.smtpTls !== false && (config.smtpPort === 465),
      auth: {
        user: config.smtpUsername,
        pass: config.smtpPassword,
      },
      // CRIT #21 — always enforce TLSv1.2+ regardless of smtpTls config.
      // Was: smtpTls:false → tls:undefined → nodemailer would happily
      // negotiate TLS 1.0/1.1 (downgrade-vulnerable, well-known weak
      // ciphers) if the server offered it. minVersion forces 1.2 floor
      // even when the operator turned off strict cert verification.
      // The rejectUnauthorized branch still honors the operator's
      // smtpAllowInsecure preference; only the TLS protocol floor is
      // unconditional.
      tls: {
        rejectUnauthorized: config.smtpTls !== false && config.smtpAllowInsecure !== true,
        minVersion: 'TLSv1.2',
      },
    });

    await transport.sendMail({
      from: config.fromEmail,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });

    return { ok: true };
  } catch (err) {
    console.error('[MailService/SMTP] Error:', err);
    return { ok: false, error: err instanceof Error ? err.message : 'SMTP send failed' };
  }
}

// ---------------------------------------------------------------------------
// Emailit (REST API — https://api.emailit.com/v2/emails)
// ---------------------------------------------------------------------------
//
// Why fetch (not an SDK): Emailit's published REST contract is small enough
// to call directly. Avoiding an SDK keeps our supply-chain surface unchanged
// — no new transitive deps for one outbound POST per send.
//
// Auth: Bearer token in the Authorization header.
// Endpoint: POST https://api.emailit.com/v2/emails
// Success: 200 OK with { object, id, message_id, status, created_at }
// Errors: 400 invalid params, 401 invalid key, 403 access denied, 404,
//         429 rate-limited (workspace default 2 msg/sec, 5000/day), 500.
//
// We do NOT enable open-rate / click tracking by default — operators who
// want it can extend this provider.

const EMAILIT_ENDPOINT = 'https://api.emailit.com/v2/emails';

async function sendViaEmailit(config: MailConfig, options: SendMailOptions): Promise<{ ok: boolean; error?: string }> {
  if (!config.emailitApiKey) {
    return { ok: false, error: 'Emailit API key not configured' };
  }

  try {
    const response = await fetch(EMAILIT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.emailitApiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        from: config.fromEmail,
        to: options.to,
        subject: options.subject,
        html: options.html,
      }),
    });

    if (!response.ok) {
      // Emailit returns { error, message, validation_errors? } on failure.
      // Surface the most informative field we can find without leaking the API key.
      let detail = `HTTP ${response.status}`;
      try {
        const body = await response.json() as { error?: string; message?: string; validation_errors?: string[] };
        if (body.message) detail = body.message;
        else if (body.error) detail = body.error;
        if (body.validation_errors?.length) detail += ` (${body.validation_errors.join(', ')})`;
      } catch {
        // Non-JSON error body — stick with the status code.
      }
      // Map common status codes for callers that want to act on them.
      if (response.status === 401) return { ok: false, error: `Emailit: invalid API key (${detail})` };
      if (response.status === 429) return { ok: false, error: `Emailit: rate limited (${detail})` };
      return { ok: false, error: `Emailit: ${detail}` };
    }

    return { ok: true };
  } catch (err) {
    console.error('[MailService/Emailit] Error:', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Emailit send failed' };
  }
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

export async function testMailConfig(testTo: string): Promise<{ ok: boolean; error?: string }> {
  return sendMail({
    to: testTo,
    subject: 'ClawNex Mail Test',
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; text-align: center;">
        <h1 style="color: #00e5a0; font-size: 28px; margin: 0 0 16px;">ClawNex</h1>
        <p style="color: #333; font-size: 15px;">Mail configuration is working correctly.</p>
        <p style="color: #999; font-size: 12px; margin-top: 20px;">This is a test email from your ClawNex dashboard.</p>
      </div>
    `,
  });
}
