/**
 * OpenClaw routing wire/revert smoke test.
 *
 * Usage:
 *   npx tsx scripts/openclaw-routing-test.ts          # safe sandbox: copies openclaw.json + sidecar to /tmp, exercises wire/revert there, never touches the real files
 *   npx tsx scripts/openclaw-routing-test.ts --target=real    # destructive: runs against your actual ~/.openclaw/openclaw.json. Backs up first.
 *
 * The sandbox mode redirects HOME and the OpenClaw config-path resolver
 * to a /tmp working dir. Any wire/revert lands on the copy. The real
 * openclaw.json is never read or written.
 *
 * The --target=real mode runs against the real config but ALWAYS makes
 * a timestamped backup at ~/.openclaw/openclaw.json.before-clawnex-wire.<ts>
 * before any write. That backup is your hard floor for recovery if
 * anything goes sideways.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Parse args before importing the lib — we need to set OPENCLAW_HOME +
// HOME first so the lib's path resolver picks up the sandbox.
const argv = process.argv.slice(2);
const targetReal = argv.includes('--target=real');

let sandboxDir: string | null = null;
let realConfigBackup: string | null = null;

if (!targetReal) {
  // Sandbox: copy ~/.openclaw/openclaw.json into /tmp/clawnex-routing-test-<pid>/.openclaw/
  // and point HOME + OPENCLAW_HOME at the sandbox so neither openclaw.json
  // nor the sidecar at ~/.clawnex-routing-managed.json touches the real ones.
  sandboxDir = path.join(os.tmpdir(), `clawnex-routing-test-${process.pid}`);
  const sandboxOpenClaw = path.join(sandboxDir, '.openclaw');
  fs.mkdirSync(sandboxOpenClaw, { recursive: true });

  const realConfig = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  if (!fs.existsSync(realConfig)) {
    console.error(`No openclaw.json at ${realConfig}. Either OpenClaw isn't installed or your config is at a non-standard path.`);
    process.exit(1);
  }
  fs.copyFileSync(realConfig, path.join(sandboxOpenClaw, 'openclaw.json'));

  process.env.HOME = sandboxDir;
  process.env.OPENCLAW_HOME = sandboxOpenClaw;
  console.log(`[sandbox] HOME=${sandboxDir}`);
  console.log(`[sandbox] OPENCLAW_HOME=${sandboxOpenClaw}`);
  console.log(`[sandbox] Copy of openclaw.json placed at ${path.join(sandboxOpenClaw, 'openclaw.json')}`);
  console.log('');
} else {
  // Destructive: take a backup of the real openclaw.json before letting
  // wireLitellmRouting touch it.
  const realConfig = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  if (!fs.existsSync(realConfig)) {
    console.error(`No openclaw.json at ${realConfig}. Aborting.`);
    process.exit(1);
  }
  realConfigBackup = `${realConfig}.before-clawnex-wire.${Date.now()}`;
  fs.copyFileSync(realConfig, realConfigBackup);
  console.log(`[real] Backup created at ${realConfigBackup}`);
  console.log('[real] Will run against actual ~/.openclaw/openclaw.json');
  console.log('');
}

// Dynamic import so the lib's module-level path resolver runs AFTER
// our env-var setup (top-level static imports are hoisted in ESM/TS,
// which would defeat the sandbox).
async function loadLib() {
  return import('../src/lib/services/openclaw-routing-wire');
}

function pretty(label: string, obj: unknown): void {
  console.log(`--- ${label} ---`);
  console.log(JSON.stringify(obj, null, 2));
  console.log('');
}

function printConfigSnippet(): void {
  const cfg = path.join(process.env.OPENCLAW_HOME || path.join(os.homedir(), '.openclaw'), 'openclaw.json');
  try {
    const j = JSON.parse(fs.readFileSync(cfg, 'utf-8'));
    const slice: Record<string, unknown> = {
      'models.providers': (j.models as { providers?: unknown } | undefined)?.providers ?? '<missing>',
      'agents.defaults.model.primary':
        ((j.agents as { defaults?: { model?: { primary?: unknown } } } | undefined)?.defaults?.model?.primary) ?? '<missing>',
      'meta.lastTouchedVersion': (j.meta as { lastTouchedVersion?: string } | undefined)?.lastTouchedVersion ?? '<missing>',
    };
    pretty('openclaw.json (relevant slice)', slice);
  } catch (err) {
    console.error('Could not read config:', err);
  }
}

function printSidecar(): void {
  const sidecarPath = path.join(process.env.HOME || os.homedir(), '.clawnex-routing-managed.json');
  if (!fs.existsSync(sidecarPath)) {
    console.log(`(no sidecar at ${sidecarPath})`);
    console.log('');
    return;
  }
  try {
    const j = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
    pretty(`sidecar at ${sidecarPath}`, j);
  } catch (err) {
    console.error('Could not read sidecar:', err);
  }
}

async function main() {
  const { wireLitellmRouting, revertLitellmRouting, inspectLitellmRouting } = await loadLib();

  console.log('=== STEP 1: inspect (before any wire) ===');
  pretty('inspect()', inspectLitellmRouting());

  console.log('=== STEP 2: wire ===');
  const w1 = wireLitellmRouting();
  pretty('wire() #1', w1);
  printConfigSnippet();
  printSidecar();

  console.log('=== STEP 3: wire again (idempotent — should report already-wired) ===');
  const w2 = wireLitellmRouting();
  pretty('wire() #2', w2);

  console.log('=== STEP 4: inspect (after wire) ===');
  pretty('inspect()', inspectLitellmRouting());

  console.log('=== STEP 5: revert ===');
  const r1 = revertLitellmRouting();
  pretty('revert() #1', r1);
  printConfigSnippet();
  printSidecar();

  console.log('=== STEP 6: revert again (idempotent — should report nothing-to-revert) ===');
  const r2 = revertLitellmRouting();
  pretty('revert() #2', r2);

  console.log('=== SUMMARY ===');
  console.log(`wire #1 status:    ${w1.status}`);
  console.log(`wire #2 status:    ${w2.status}  (expected: already-wired)`);
  console.log(`revert #1 status:  ${r1.status}  (expected: reverted)`);
  console.log(`revert #2 status:  ${r2.status}  (expected: nothing-to-revert)`);
}

main().catch(err => { console.error(err); process.exit(1); });

if (sandboxDir) {
  console.log('');
  console.log(`Sandbox left in place at ${sandboxDir} for inspection.`);
  console.log(`Remove with: rm -rf ${sandboxDir}`);
}
if (realConfigBackup) {
  console.log('');
  console.log(`Real-mode backup is at ${realConfigBackup} (delete when satisfied).`);
}
