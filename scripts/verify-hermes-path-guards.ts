#!/usr/bin/env tsx
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const root = fs.mkdtempSync(path.join(os.homedir(), ".clawnex-hermes-path-"));
const hermesHome = path.join(root, ".hermes");
const prodProfile = path.join(hermesHome, "profiles", "prod");
const devProfile = path.join(hermesHome, "profiles", "dev");

process.env.HERMES_HOME = hermesHome;

function mkdirp(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function writeStateDb(dbPath: string) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      source TEXT,
      started_at INTEGER
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      session_id TEXT,
      role TEXT,
      content TEXT,
      timestamp INTEGER
    );
  `);
  const now = Math.floor(Date.now() / 1000);
  db.prepare("INSERT INTO sessions (id, source, started_at) VALUES (?, ?, ?)").run("s1", "discord", now);
  db.prepare("INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)").run(
    1,
    "s1",
    "user",
    "content is intentionally not inspected here",
    now,
  );
  db.close();
}

mkdirp(path.join(prodProfile, "skills", "triage"));
mkdirp(devProfile);
mkdirp(path.join(hermesHome, "profiles", "bad profile"));
fs.writeFileSync(path.join(hermesHome, "active_profile"), "prod\n");
fs.writeFileSync(path.join(hermesHome, "channel_directory.json"), JSON.stringify({ discord: {} }));
fs.writeFileSync(path.join(prodProfile, "skills", "triage", "SKILL.md"), "Uses `browser_navigate` and `file_read`.\n");
writeStateDb(path.join(hermesHome, "state.db"));

async function main() {
  const diagnostics = await import("../src/lib/services/hermes-diagnostics");
  const scanner = await import("../src/lib/services/permissiveness/scanners/hermes");

  const diag = diagnostics.diagnoseHermes(hermesHome);
  assert.equal(diag.available, true, "valid Hermes home remains readable");
  assert.equal(diag.activeProfile, "prod", "safe active profile is honored");
  assert.deepEqual(diag.profiles.names, ["dev", "prod"], "unsafe profile directory names are ignored");
  assert.equal(diag.tools.count, 2, "valid profile skills are still scanned");

  const outside = diagnostics.diagnoseHermes("/etc");
  assert.equal(outside.available, false, "absolute paths outside the user home are rejected");
  assert.match(outside.statusDetail ?? "", /home directory/, "outside path reports the home-boundary invariant");

  const symlinkHome = path.join(root, "hermes-symlink");
  try {
    fs.symlinkSync("/etc", symlinkHome, "dir");
    const symlinkDiag = diagnostics.diagnoseHermes(symlinkHome);
    assert.equal(symlinkDiag.available, false, "symlinked Hermes homes resolving outside user home are rejected");
    assert.match(symlinkDiag.statusDetail ?? "", /resolves outside/, "symlink rejection explains the realpath escape");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }

  fs.writeFileSync(path.join(hermesHome, "active_profile"), "../etc\n");
  const unsafeActive = diagnostics.diagnoseHermes(hermesHome);
  assert.equal(unsafeActive.activeProfile, null, "unsafe active_profile content is ignored when multiple profiles exist");
  assert.equal(unsafeActive.activeProfileSource, "none", "unsafe active_profile content is not reported as trusted");

  const scan = scanner.scanHermes();
  assert.deepEqual(scan.profiles.map((profile) => profile.id).sort(), ["dev", "prod"], "scanner ignores unsafe profile directory names");

  const arbitrarySkillScan = scanner.scanProfileSkills("/etc");
  assert.equal(arbitrarySkillScan.scannedDir, null, "skill scanner rejects arbitrary absolute directories");
  assert.equal(arbitrarySkillScan.toolUnion.length, 0, "rejected skill scan returns no tools");

  const nestedProfileScan = scanner.scanProfileSkills(path.join(prodProfile, "skills"));
  assert.equal(nestedProfileScan.scannedDir, null, "skill scanner only accepts direct Hermes profile directories");

  console.log("verify-hermes-path-guards: PASS");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {}
  });
