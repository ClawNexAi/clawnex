import assert from 'node:assert/strict';
import fs from 'node:fs';

const core = fs.readFileSync(new URL('../apps/macos/ClawNexLauncher/Sources/ClawNexLauncher/LauncherCore.swift', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../apps/macos/ClawNexLauncher/Sources/ClawNexLauncher/ClawNexLauncherApp.swift', import.meta.url), 'utf8');
const build = fs.readFileSync(new URL('../apps/macos/ClawNexLauncher/build-app.sh', import.meta.url), 'utf8');
const cli = fs.readFileSync(new URL('../scripts/clawnex-session-launcher.cjs', import.meta.url), 'utf8');

assert.match(core, /\["launcher", "snapshot", "--json"\]/, 'native client consumes the versioned CLI snapshot');
assert.ok(core.includes('run \\(shellQuote(harness)) --model \\(shellQuote(model))'), 'native client delegates launch to clawnex run');
assert.match(core, /shellQuote\(directory\)/, 'working directory is shell quoted');
assert.match(core, /\/opt\/homebrew\/bin/, 'GUI process adds the standard Apple Silicon package path');
assert.ok(core.includes('PATH=\\(shellQuote(pathValue))'), 'terminal command receives the deterministic executable path');
assert.match(core, /\/usr\/bin\/ssh/, 'portable launcher supports a remote ClawNex target over SSH');
assert.match(core, /BatchMode=yes/, 'remote inventory never prompts the menu-bar process for credentials');
assert.match(core, /validRemoteHost/, 'remote target is validated before entering an SSH command');
assert.match(core, /case ghostty/, 'native launcher includes a Ghostty adapter');
assert.match(core, /\/usr\/bin\/open/, 'Ghostty launches without Apple Events automation');
assert.match(core, /availableTerminals/, 'terminal choices are discovered on the Mac');
assert.ok(app.includes('Remote over SSH'), 'menu-bar shell exposes the remote target mode');
assert.doesNotMatch(core + app, /LITELLM_MASTER_KEY|CLAWNEX_INGEST_SECRET|x-clawnex-routing-identity/i, 'native app contains no secret contract');
assert.match(app, /MenuBarExtra\s*\{/, 'app is a macOS menu-bar utility');
for (const field of ['MODEL', 'SESSION STARTS IN', 'CODING HARNESSES']) assert.ok(app.includes(field), `app renders ${field}`);
assert.match(app, /filter\(\\\.installed\)/, 'unavailable harnesses are hidden from the launcher');
assert.match(app, /ClawNexMenuBarIcon/, 'menu bar uses the ClawNex brand icon');
assert.match(build, /CFBundleIconFile/, 'bundle declares the official ClawNex app icon');
assert.match(build, /LSUIElement<\/key><true\/>/, 'bundle runs without a Dock icon');
assert.match(cli, /schemaVersion: 1/, 'CLI snapshot is explicitly versioned');
assert.match(cli, /homeDirectory: os\.homedir\(\)/, 'CLI snapshot reports the selected target home directory');
assert.match(cli, /installed: Boolean\(findBinary\(harness\.bin\)\)/, 'CLI owns harness discovery');

console.log('PASS: macOS menu-bar shell consumes the secret-free portable ClawNex launcher contract');
