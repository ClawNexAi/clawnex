/**
 * Hermes Agent Database Connection
 *
 * Singleton read-only better-sqlite3 connection to ~/.hermes/state.db.
 * Hermes-Agent stores its session and message data in a SQLite database
 * (WAL mode, schema v6). ClawNex reads this as a peer gateway instance.
 *
 * READ-ONLY access. ClawNex never writes to the Hermes database.
 *
 * @module services/hermes-db
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import os from "os";

const HERMES_HOME = process.env.HERMES_HOME || path.join(os.homedir(), ".hermes");
const STATE_DB_PATH = path.join(HERMES_HOME, "state.db");

let cachedDb: Database.Database | null = null;
let openAttempted = false;

export function getHermesDb(): Database.Database | null {
  if (cachedDb) return cachedDb;
  if (openAttempted) return null;
  openAttempted = true;
  if (!fs.existsSync(STATE_DB_PATH)) return null;
  try {
    const db = new Database(STATE_DB_PATH, { readonly: true, fileMustExist: true });
    db.pragma("busy_timeout = 3000");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const tableNames = new Set(tables.map(t => t.name));
    if (!tableNames.has("sessions") || !tableNames.has("messages")) {
      console.warn("[HermesDB] state.db missing expected tables — skipping");
      db.close();
      return null;
    }
    cachedDb = db;
    console.log(`[HermesDB] Opened read-only connection to ${STATE_DB_PATH}`);
    return db;
  } catch (err) {
    console.warn(`[HermesDB] Failed to open ${STATE_DB_PATH}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export function isHermesAvailable(): boolean { return getHermesDb() !== null; }
export function getHermesHome(): string { return HERMES_HOME; }
export function closeHermesDb(): void {
  if (cachedDb) { try { cachedDb.close(); } catch {} cachedDb = null; openAttempted = false; }
}
export function resetHermesDb(): void { closeHermesDb(); openAttempted = false; }
