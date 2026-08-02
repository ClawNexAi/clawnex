#!/usr/bin/env tsx
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const root = fs.mkdtempSync(path.join(os.homedir(), ".clawnex-hermes-"));
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
  // A message can outlive its session row after Hermes cleanup. It must still
  // be ingested with honest unavailable metadata instead of being dropped by
  // an inner join.
  hdb2.prepare("INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)").run(
    3,
    "session-pruned-by-hermes",
    "assistant",
    "message remains observable after session metadata cleanup",
    now + 2,
  );
  hdb2.close();

  watcher.pollHermesMessages();

  const cursor = queryOne<{ last_message_id: number }>("SELECT last_message_id FROM hermes_ingest_cursors LIMIT 1");
  assert.equal(cursor?.last_message_id, 3);

  const event = queryOne<{ source_id: string; message_id: number; content_hash: string; shield_verdict: string; traffic_id: string }>(
    "SELECT source_id, message_id, content_hash, shield_verdict, traffic_id FROM hermes_events WHERE message_id = 2",
  );
  assert.match(event?.source_id ?? "", /^hermes:home:[a-f0-9]{12}:profile:prod:channel:discord$/);
  assert.equal(event?.message_id, 2);
  assert.equal(event?.content_hash.length, 16);
  assert.equal(event?.shield_verdict, "ALLOW");
  assert.ok(event?.traffic_id);

  const orphanEvent = queryOne<{ source_id: string; message_id: number; traffic_id: string }>(
    "SELECT source_id, message_id, traffic_id FROM hermes_events WHERE message_id = 3",
  );
  assert.match(orphanEvent?.source_id ?? "", /^hermes:home:[a-f0-9]{12}:profile:prod:channel:unknown-channel$/);
  assert.equal(orphanEvent?.message_id, 3);
  assert.ok(orphanEvent?.traffic_id);

  const trafficAfterFirstPoll = queryOne<{ count: number }>(
    "SELECT COUNT(*) AS count FROM proxy_traffic WHERE source = 'hermes-watcher'",
  );
  assert.equal(trafficAfterFirstPoll?.count, 2);

  // Re-polling the same high-water range must not duplicate traffic or
  // evidence, even if the cursor is repaired or the process is restarted.
  watcher.pollHermesMessages();
  const trafficAfterDuplicatePoll = queryOne<{ count: number }>(
    "SELECT COUNT(*) AS count FROM proxy_traffic WHERE source = 'hermes-watcher'",
  );
  assert.equal(trafficAfterDuplicatePoll?.count, 2);

  const cursorAfterPoll = queryOne<{ last_message_id: number }>("SELECT last_message_id FROM hermes_ingest_cursors LIMIT 1");
  assert.equal(cursorAfterPoll?.last_message_id, 3);

  const rawLeak = queryOne<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM hermes_events WHERE content_hash LIKE '%new message visible%'",
  );
  assert.equal(rawLeak?.cnt, 0);

  console.log("verify-hermes-integration: PASS");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
}).finally(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {}
});
