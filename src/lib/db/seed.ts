/**
 * ClawNex Database Seed — populates config tables on first run.
 *
 * Fresh install mode: creates minimal generic defaults.
 * No personal IPs, model names, or client names — those are configured by the operator.
 */

import { queryOne, run, transaction } from './index';
import { getGatewayTokenFromOpenClaw } from '../openclaw-paths';
import { runPolicySeed } from './seed-policies';

interface CountRow { cnt: number }

export function seedConfigTables(): void {
  const providerCount = queryOne<CountRow>('SELECT COUNT(*) as cnt FROM config_providers');

  if (!providerCount || providerCount.cnt === 0) {
    console.log('[ClawNex Seed] Seeding configuration tables (fresh install)...');

    // Auto-populate gateway token from openclaw.json if present
    const gatewayToken = getGatewayTokenFromOpenClaw() || '';
    if (gatewayToken) {
      console.log('[ClawNex Seed] Found OpenClaw gateway token, seeding into config_gateways.');
    }

    transaction(() => {
      // --- OpenClaw Gateway (always present) ---
      const openclawUrl = process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789';

      run(
        `INSERT INTO config_providers (id, name, type, base_url, api_key, is_default, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['openclaw', 'OpenClaw Gateway', 'openclaw', openclawUrl, '', 1, 1]
      );

      // --- OpenClaw model entry ---
      run(
        `INSERT INTO config_models (id, provider_id, model_id, name, is_default)
         VALUES (?, ?, ?, ?, ?)`,
        ['openclaw::openclaw', 'openclaw', 'openclaw', 'OpenClaw (auto)', 1]
      );

      // --- Local Gateway (token auto-populated from openclaw.json if found) ---
      run(
        `INSERT INTO config_gateways (id, name, url, token, client_name, is_active, is_primary, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['gw-local', 'Local Gateway', openclawUrl, gatewayToken, '', 1, 1, 'unknown']
      );

      // --- Defaults (minimal) ---
      run(
        `INSERT INTO config_defaults (key, value) VALUES (?, ?)`,
        ['default_provider', 'openclaw']
      );
      run(
        `INSERT INTO config_defaults (key, value) VALUES (?, ?)`,
        ['default_model', 'openclaw']
      );
      if (gatewayToken) {
        run(
          `INSERT INTO config_defaults (key, value) VALUES (?, ?)`,
          ['openclaw_gateway_token', gatewayToken]
        );
      }
      run(
        `INSERT INTO config_defaults (key, value) VALUES (?, ?)`,
        ['lockout_decay_minutes', '15']
      );
      // CRITICAL #11: ship the shield in BLOCK mode by default on fresh
      // installs. Was 'off' (via runtime fallback when row absent), so a
      // new operator's shield logged attacks but never refused them. operator-
      // approved policy 2026-05-14: safe-by-default is "block first, the
      // operator can opt down to off via the toggle if they need to triage".
      // Value is 'on' to match the existing /api/proxy/block-mode vocab
      // (on / off) — the toggle endpoint and the v1 chat path both compare
      // against === 'on'.
      run(
        `INSERT INTO config_defaults (key, value) VALUES (?, ?)`,
        ['proxy_block_mode', 'on']
      );
    });

    console.log('[ClawNex Seed] Configuration seeded. Add model providers in Configuration tab.');
  }

  // Investigation evidence defaults must also land on upgrades, not only on
  // fresh installs. INSERT OR IGNORE preserves every operator choice.
  for (const [key, value] of [
    ['investigation_capture_mode', 'redacted'],
    ['investigation_redacted_limit', '16384'],
    ['investigation_forensic_retention_hours', '24'],
    ['investigation_related_window_minutes', '15'],
  ] as const) {
    run('INSERT OR IGNORE INTO config_defaults (key, value) VALUES (?, ?)', [key, value]);
  }

  // Policy framework seed runs on EVERY call — has its own idempotency
  // gate via policy_framework_seed_version, so re-runs are no-ops.
  // Critical: this MUST be outside the fresh-install branch so existing
  // installs upgrading to a build with the framework get the two starter
  // packs on first boot. internal reviewer Gate 2.2 fix-up.
  const policySeedResult = runPolicySeed();
  console.log('[seed] policy framework:', policySeedResult);
}
