/**
 * verify-deploy-fail-closed.ts
 *
 * internal reviewer 2026-05-10 launch-grade contract: deploy scripts must fail-closed
 * on partial / corrupted builds and must never print the setup secret
 * before health gates pass. Locks four properties:
 *
 *   1. install-prod.sh has NO `/usr/bin/npm start` fallback in its
 *      systemd unit (broken builds must not get a working unit pointing
 *      at a partial .next/).
 *   2. install-prod.sh writes the full `npm run build` log to a file and
 *      exits 1 on failure (no more `| tail -3` swallowing type errors).
 *   3. scripts/deploy-prod.sh has a standalone-runtime guard BEFORE any
 *      `ln -s` symlinks — missing server.js or .next/static must exit 1.
 *   4. scripts/deploy-prod.sh prints the setup URL only AFTER the
 *      DEPLOY_OK gate (health checks all green).
 *
 *   npx tsx scripts/verify-deploy-fail-closed.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();

let assertions = 0;
let failed = 0;

function pass(msg: string) { assertions++; console.log(`PASS: ${msg}`); }
function fail(msg: string) { assertions++; failed++; console.error(`FAIL: ${msg}`); }
function assert(cond: unknown, msg: string): void { if (cond) pass(msg); else fail(msg); }

// ---------------------------------------------------------------------------
// Section 1 — install-prod.sh fail-closed properties
// ---------------------------------------------------------------------------

console.log("\n[1] deploy/install-prod.sh fail-closed");
{
  const installPath = path.join(ROOT, "deploy/install-prod.sh");
  const src = fs.readFileSync(installPath, "utf-8");

  // 1a — No npm-start ExecStart fallback. The previous code:
  //   DASHBOARD_EXEC="/usr/bin/npm start"
  // hid build failures by writing a unit pointing at a partial `.next/`.
  assert(!/DASHBOARD_EXEC=["']\/usr\/bin\/npm start["']/.test(src),
    `install-prod.sh has no DASHBOARD_EXEC=/usr/bin/npm start fallback`);
  // Strip comment lines before scanning for executable 'npm start' references —
  // historical-context comments documenting the REMOVED fallback are fine.
  const codeLines = src
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  assert(!/\bnpm start\b/.test(codeLines),
    `install-prod.sh has no executable 'npm start' line (broken build must not get a working unit)`);

  // 1b — Build step uses full log + fail-closed, not `| tail -3`.
  assert(!/npm run build 2>&1 \| tail -3/.test(src),
    `install-prod.sh no longer pipes 'npm run build' through bare 'tail -3' (which swallows errors)`);
  assert(/npm run build > "?\$\{?BUILD_LOG/.test(src) || /npm run build > "[^"]+\.deploy-build\.log/.test(src),
    `install-prod.sh redirects 'npm run build' output to a log file`);
  assert(/if ! npm run build/.test(src),
    `install-prod.sh wraps 'npm run build' in 'if !' for fail-closed branch`);
  assert(/tail -50 "?\$BUILD_LOG/.test(src) || /tail -50 "?\$\{INSTALL_DIR\}\/\.deploy-build\.log/.test(src),
    `install-prod.sh prints last 50 lines of build log on failure`);

  // 1c — Standalone artifact existence checks AFTER build, BEFORE writing
  // the systemd unit. Two distinct guards: server.js + .next/static.
  const buildIdx = src.indexOf("[3/8] Rebuilding");
  const unitIdx = src.indexOf("[6/8] Writing systemd unit");
  assert(buildIdx > 0 && unitIdx > buildIdx, `install-prod.sh has [3/8] before [6/8]`);
  if (buildIdx > 0 && unitIdx > buildIdx) {
    const between = src.slice(buildIdx, unitIdx);
    assert(/\[\s*!\s*-f\s+["']?\$\{?INSTALL_DIR\}?\/\.next\/standalone\/server\.js["']?\s*\][\s\S]*?exit 1/.test(between),
      `install-prod.sh exits 1 if standalone/server.js missing after build`);
    assert(/\[\s*!\s*-d\s+["']?\$\{?INSTALL_DIR\}?\/\.next\/standalone\/\.next\/static["']?\s*\][\s\S]*?exit 1/.test(between),
      `install-prod.sh exits 1 if standalone/.next/static missing after build`);
  }

  // 1d — Systemd unit always points at standalone server.js (no conditional).
  // The unit-write block must contain only the standalone ExecStart shape.
  if (unitIdx > 0) {
    const unitBlock = src.slice(unitIdx, unitIdx + 1500);
    assert(/DASHBOARD_EXEC=["']\/usr\/bin\/node \$\{INSTALL_DIR\}\/\.next\/standalone\/server\.js["']/.test(unitBlock),
      `install-prod.sh systemd unit ExecStart is the standalone server.js path`);
  }
}

// ---------------------------------------------------------------------------
// Section 2 — scripts/deploy-prod.sh fail-closed properties
// ---------------------------------------------------------------------------

console.log("\n[2] scripts/deploy-prod.sh fail-closed");
{
  const deployPath = path.join(ROOT, "scripts/deploy-prod.sh");
  const src = fs.readFileSync(deployPath, "utf-8");

  // 2a — Full deploy logs persisted to disk (not just tail).
  assert(/DEPLOY_LOG_DIR=/.test(src),
    `deploy-prod.sh defines DEPLOY_LOG_DIR for persistent logs`);
  assert(/tee "?\$\{?DEPLOY_LOG_DIR\}?\/npm-build\.log/.test(src),
    `deploy-prod.sh tees npm-build output to a file`);
  assert(/tee "?\$\{?DEPLOY_LOG_DIR\}?\/install-prod\.log/.test(src),
    `deploy-prod.sh tees install-prod output to a file`);

  // 2b — Standalone guard BEFORE first ln -s of clawnex.db.
  const guardIdx = src.search(/STANDALONE_DIR\s*=\s*["']?\$\{?INSTALL_DIR\}?\/\.next\/standalone/);
  const lnDbIdx = src.search(/ln -sf [^\n]*\.\.\/\.\.\/clawnex\.db\b/);
  assert(guardIdx > 0, `deploy-prod.sh defines STANDALONE_DIR variable`);
  assert(lnDbIdx > 0, `deploy-prod.sh has ln -sf clawnex.db symlink`);
  if (guardIdx > 0 && lnDbIdx > 0) {
    assert(guardIdx < lnDbIdx,
      `deploy-prod.sh standalone guard appears BEFORE the first symlink`);
  }
  assert(/\[\s*!\s*-f\s+["']?\$STANDALONE_DIR\/server\.js["']?\s*\][\s\S]*?exit 1/.test(src),
    `deploy-prod.sh exits 1 when STANDALONE_DIR/server.js missing`);
  assert(/\[\s*!\s*-d\s+["']?\$STANDALONE_DIR\/\.next\/static["']?\s*\][\s\S]*?exit 1/.test(src),
    `deploy-prod.sh exits 1 when STANDALONE_DIR/.next/static missing`);

  // 2c — Setup URL print is gated AFTER DEPLOY_OK. The previous code
  // printed the secret BEFORE the gate (and even on failed deploys).
  const setupUrlIdx = src.indexOf("SETUP URL");
  const deployOkGateIdx = src.search(/if\s+\[\s+"\$DEPLOY_OK"\s+!=\s+"1"\s+\];\s*then\s*\n\s*exit 1\s*\n\s*fi/);
  assert(setupUrlIdx > 0, `deploy-prod.sh has a 'SETUP URL' label somewhere`);
  assert(deployOkGateIdx > 0, `deploy-prod.sh has the 'if DEPLOY_OK != 1; then exit 1; fi' gate`);
  if (setupUrlIdx > 0 && deployOkGateIdx > 0) {
    assert(setupUrlIdx > deployOkGateIdx,
      `deploy-prod.sh prints SETUP URL only AFTER the DEPLOY_OK gate (no secret leak on failure)`);
  }
  // Defense: no setup URL print BEFORE the gate.
  const beforeGate = src.slice(0, deployOkGateIdx);
  assert(!/echo\s+["']?>>>\s*SETUP URL\s*<<</.test(beforeGate),
    `deploy-prod.sh has no 'echo >>> SETUP URL <<<' before the DEPLOY_OK gate`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (failed > 0) {
  console.error(`\n${failed} assertion(s) FAILED out of ${assertions}`);
  process.exit(1);
}
console.log(`\n✅ All ${assertions} assertions passed`);
