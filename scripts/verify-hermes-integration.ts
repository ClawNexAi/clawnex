#!/usr/bin/env tsx
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "clawnex-hermes-"));
const hermesHome = path.join(root, ".hermes");
const clawnexDb = path.join(root, "clawnex.db");

process.env.HERMES_HOME = hermesHome;
process.env.DATABASE_PATH = clawnexDb;
process.env.CLAWNEX_TEST_SKIP_DB_SEED = "1";

function mkdirp(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

mkdirp(path.join(hermesHome, "profiles", "prod", "skills", "triage"));
fs.writeFileSync(path.join(hermesHome, "active_profile"), "prod\n");
fs.writeFileSync(path.join(hermesHome, "channel_directory.json"), JSON.stringify({ discord: {}, slack: {} }));
fs.writeFileSync(path.join(hermesHome, "profiles", "prod", "skills", "triage", "SKILL.md"), "# Triage\nUses `browser_navigate` for review.\n");

const hermesDbPath = path.join(hermesHome, "state.db");
const hdb = new Database(hermesDbPath);
hdb.exec(`
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    source TEXT,
    model TEXT,
    title TEXT,
    billing_provider TEXT,
    started_at INTEGER,
    estimated_cost_usd REAL
  );
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    session_id TEXT,
    role TEXT,
    content TEXT,
    tool_calls TEXT,
    timestamp INTEGER,
    finish_reason TEXT
  );
`);
const now = Math.floor(Date.now() / 1000);
hdb.prepare("INSERT INTO sessions (id, source, model, title, billing_provider, started_at, estimated_cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
  "s1",
  "discord",
  "openrouter/auto",
  "Demo",
  "openrouter",
  now,
  0.001,
);
hdb.prepare("INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)").run(
  1,
  "s1",
  "user",
  "baseline message before watcher starts",
  now,
);
hdb.close();

async function main() {
  const { diagnoseHermes } = await import("../src/lib/services/hermes-diagnostics");
  const diag = diagnoseHermes(hermesHome);

  assert.equal(diag.available, true);
  assert.equal(diag.status, "live");
  assert.equal(diag.activeProfile, "prod");
  assert.deepEqual(diag.channels.configured, ["discord", "slack"]);
  assert.deepEqual(diag.channels.observed, ["discord"]);
  assert.equal(diag.skills.count, 1);
  assert.equal(diag.tools.count, 1);
  assert.deepEqual(diag.tools.names, ["browser_navigate"]);
  assert.equal(diag.sessions.last24h, 1);
  assert.equal(diag.messages.lastId, 1);

  const { getDb, queryOne } = await import("../src/lib/db/index");
  getDb();
  const watcher = await import("../src/lib/services/hermes-watcher");
  watcher.initializeHermesWatcher();
  assert.equal(watcher.getHermesWatcherStats().lastProcessedId, 1);

  const hdb2 = new Database(hermesDbPath);
  hdb2.prepare("INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)").run(
    2,
    "s1",
    "user",
    "new message visible to ClawNex shield",
    now + 1,
  );
  hdb2.close();

  watcher.pollHermesMessages();

  const cursor = queryOne<{ last_message_id: number }>("SELECT last_message_id FROM hermes_ingest_cursors LIMIT 1");
  assert.equal(cursor?.last_message_id, 2);

  const event = queryOne<{ source_id: string; message_id: number; content_hash: string; shield_verdict: string; traffic_id: string }>(
    "SELECT source_id, message_id, content_hash, shield_verdict, traffic_id FROM hermes_events WHERE message_id = 2",
  );
  assert.equal(event?.source_id, "hermes:profile:prod:channel:discord");
  assert.equal(event?.message_id, 2);
  assert.equal(event?.content_hash.length, 16);
  assert.equal(event?.shield_verdict, "ALLOW");
  assert.ok(event?.traffic_id);

  const rawLeak = queryOne<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM hermes_events WHERE content_hash LIKE '%new message visible%'",
  );
  assert.equal(rawLeak?.cnt, 0);

  console.log("verify-hermes-integration: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
