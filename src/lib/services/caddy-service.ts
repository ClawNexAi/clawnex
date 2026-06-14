/**
 * Caddy HTTPS Service
 *
 * Manages Caddy reverse proxy integration for automatic HTTPS.
 * - Generates Caddyfile from configured domain
 * - Checks Caddy installation status
 * - Monitors HTTPS/cert status
 */

import { getSetting } from './config-service';
import { run } from '../db/index';
import * as fs from 'fs';
import * as path from 'path';
import { execSync, execFileSync } from 'child_process';

/**
 * Strict RFC 1123-ish hostname validator.
 * Only allows lowercase letters, digits, hyphens, and dots. Labels cannot start
 * or end with a hyphen. Total length capped at 253 chars. No shell metacharacters,
 * no whitespace, no newlines, no braces, no semicolons can pass.
 */
const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function isValidDomain(domain: string): boolean {
  if (typeof domain !== 'string') return false;
  if (domain.length === 0 || domain.length > 253) return false;
  return DOMAIN_REGEX.test(domain);
}

export interface CaddyStatus {
  installed: boolean;
  running: boolean;
  version?: string;
  domain?: string;
  httpsEnabled: boolean;
  certExpiry?: string;
  caddyfilePath?: string;
  error?: string;
}

/**
 * Check if Caddy is installed and get its version.
 */
export function isCaddyInstalled(): { installed: boolean; version?: string } {
  try {
    const version = execSync('caddy version 2>/dev/null', { timeout: 5000 }).toString().trim();
    return { installed: true, version };
  } catch {
    return { installed: false };
  }
}

/**
 * Check if Caddy is running.
 */
export function isCaddyRunning(): boolean {
  try {
    const result = execSync('pgrep -x caddy 2>/dev/null', { timeout: 3000 }).toString().trim();
    return result.length > 0;
  } catch {
    return false;
  }
}

/**
 * Get the configured domain for HTTPS.
 */
export function getConfiguredDomain(): string | null {
  return getSetting('https_domain') || null;
}

/**
 * Generate a Caddyfile for the configured domain.
 */
export function generateCaddyfile(domain: string): string {
  // Defense in depth: even though callers should validate, never trust the
  // input here. A malformed domain could inject arbitrary Caddyfile directives.
  if (!isValidDomain(domain)) {
    throw new Error('invalid domain');
  }

  const port = process.env.PORT || '5001';

  return `# ClawNex Caddy Configuration
# Auto-generated — do not edit manually
# Domain: ${domain}
# Proxies HTTPS:443 → HTTP:${port}

${domain} {
    reverse_proxy localhost:${port}

    # Security headers
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
    }

    # Logging
    log {
        output file /var/log/caddy/clawnex-access.log
        format json
    }
}

# HTTP → HTTPS redirect is automatic with Caddy
`;
}

/**
 * Write the Caddyfile to disk.
 */
export function writeCaddyfile(domain: string): string {
  if (!isValidDomain(domain)) {
    throw new Error('invalid domain');
  }

  const content = generateCaddyfile(domain);
  const caddyfilePath = path.join(process.cwd(), 'Caddyfile');

  fs.writeFileSync(caddyfilePath, content, 'utf-8');

  // Save domain to config
  run(
    "INSERT OR REPLACE INTO config_defaults (key, value) VALUES ('https_domain', ?)",
    [domain]
  );

  return caddyfilePath;
}

/**
 * Get full Caddy/HTTPS status.
 */
export function getCaddyStatus(): CaddyStatus {
  const { installed, version } = isCaddyInstalled();
  const running = installed ? isCaddyRunning() : false;
  const domain = getConfiguredDomain();
  const caddyfilePath = path.join(process.cwd(), 'Caddyfile');
  const caddyfileExists = fs.existsSync(caddyfilePath);

  let httpsEnabled = false;
  let certExpiry: string | undefined;

  // Check if HTTPS is actually working.
  // Defense in depth: re-validate the domain before passing it to any child
  // process, and use execFileSync with array args so the shell is NOT involved.
  if (running && domain && isValidDomain(domain)) {
    try {
      const stdout = execFileSync(
        'curl',
        ['-sI', '--max-time', '3', `https://${domain}`],
        { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }
      ).toString();
      const firstLine = stdout.split('\n')[0] || '';
      httpsEnabled =
        firstLine.includes('200') ||
        firstLine.includes('301') ||
        firstLine.includes('302');
    } catch {
      httpsEnabled = false;
    }

    // Check cert expiry. We still need a shell pipeline here to chain openssl
    // commands, but the domain is passed as a positional argument ($1) to a
    // fixed script string — it is never interpolated into the shell command,
    // so metacharacters cannot break out.
    if (httpsEnabled) {
      try {
        const certInfo = execFileSync(
          'bash',
          [
            '-c',
            'openssl s_client -servername "$1" -connect "$1:443" </dev/null 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null',
            '--',
            domain,
          ],
          { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }
        ).toString().trim();
        const match = certInfo.match(/notAfter=(.+)/);
        if (match) certExpiry = match[1];
      } catch {
        // Can't check cert
      }
    }
  }

  return {
    installed,
    running,
    version,
    domain: domain || undefined,
    httpsEnabled,
    certExpiry,
    caddyfilePath: caddyfileExists ? caddyfilePath : undefined,
  };
}

/**
 * Get install instructions for the current platform.
 */
export function getInstallInstructions(): string {
  const platform = process.platform;

  switch (platform) {
    case 'darwin':
      return 'brew install caddy';
    case 'linux':
      return `sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy`;
    default:
      return 'Visit https://caddyserver.com/docs/install for installation instructions.';
  }
}
