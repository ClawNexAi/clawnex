import assert from 'node:assert/strict';
import fs from 'node:fs';

const core = fs.readFileSync(new URL('../apps/macos/ClawNexLauncher/Sources/ClawNexLauncher/LauncherCore.swift', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../apps/macos/ClawNexLauncher/Sources/ClawNexLauncher/ClawNexLauncherApp.swift', import.meta.url), 'utf8');
const build = fs.readFileSync(new URL('../apps/macos/ClawNexLauncher/build-app.sh', import.meta.url), 'utf8');
const cli = fs.readFileSync(new URL('../scripts/clawnex-session-launcher.cjs', import.meta.url), 'utf8');

assert.match(core, /\["launcher", "snapshot", "--json"\]/, 'native client consumes the versioned CLI snapshot');
assert.ok(core.includes('run \\(shellQuote(harness)) --model \\(shellQuote(model))'), 'native client delegates launch to clawnex run');
assert.match(core, /shellQuote\(directory\)/, 'working directory is shell quoted');
assert.doesNotMatch(core + app, /LITELLM_MASTER_KEY|CLAWNEX_INGEST_SECRET|x-clawnex-routing-identity/i, 'native app contains no secret contract');
assert.match(app, /MenuBarExtra\("ClawNex Launcher"/, 'app is a macOS menu-bar utility');
for (const field of ['MODEL', 'SESSION OPENS IN', 'CODING HARNESSES']) assert.ok(app.includes(field), `app renders ${field}`);
assert.match(build, /LSUIElement<\/key><true\/>/, 'bundle runs without a Dock icon');
assert.match(cli, /schemaVersion: 1/, 'CLI snapshot is explicitly versioned');
assert.match(cli, /installed: Boolean\(findBinary\(harness\.bin\)\)/, 'CLI owns harness discovery');

console.log('PASS: macOS menu-bar shell consumes the secret-free portable ClawNex launcher contract');
