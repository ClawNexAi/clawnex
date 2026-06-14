/**
 * ClawNex Log Rotation — file-based rotation and retention for JSONL logs.
 *
 * Provides two capabilities:
 * 1. **Rotation** — when a log file exceeds a size threshold, rename it with
 *    a numeric suffix (.1.jsonl, .2.jsonl, ...) and shift older files up.
 *    At most `maxFiles` rotated files are kept; the oldest is deleted.
 * 2. **Cleanup** — delete rotated log files older than a configurable
 *    retention period (read from config_defaults, default 14 days).
 *
 * All I/O is defensive — errors are caught and logged to stderr so that
 * log rotation never crashes the application.
 *
 * @module services/log-rotation
 */

import fs from 'node:fs';
import path from 'node:path';
import { queryOne } from '../db/index';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConfigDefault {
  key: string;
  value: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

/**
 * Check if the log file at `filePath` exceeds `maxSizeMB` and rotate if so.
 *
 * Rotation scheme:
 *   clawnex.jsonl  -> clawnex.1.jsonl  (newest rotated)
 *   clawnex.1.jsonl -> clawnex.2.jsonl
 *   ...
 *   clawnex.(maxFiles).jsonl is deleted
 *
 * @param filePath   - Absolute path to the active log file.
 * @param maxSizeMB  - Maximum size in megabytes before rotation (default 10).
 * @param maxFiles   - Maximum number of rotated files to keep (default 5).
 */
export function maybeRotate(
  filePath: string,
  maxSizeMB?: number,
  maxFiles?: number,
): void {
  try {
    if (!fs.existsSync(filePath)) return;

    const resolvedMaxSize = maxSizeMB ?? getConfigNumber('log_max_size_mb', 10);
    const resolvedMaxFiles = maxFiles ?? getConfigNumber('log_max_rotated_files', 5);
    const maxBytes = resolvedMaxSize * 1024 * 1024;

    const stat = fs.statSync(filePath);
    if (stat.size < maxBytes) return;

    // Build rotated file name: /path/to/clawnex.jsonl -> /path/to/clawnex.N.jsonl
    const ext = path.extname(filePath);                       // .jsonl
    const base = filePath.slice(0, -ext.length);              // /path/to/clawnex

    // Shift existing rotated files up by 1 (highest number first to avoid overwrites)
    for (let i = resolvedMaxFiles; i >= 1; i--) {
      const src = `${base}.${i}${ext}`;
      if (i === resolvedMaxFiles) {
        // Delete the oldest rotated file
        try { fs.unlinkSync(src); } catch { /* file may not exist */ }
      } else {
        const dst = `${base}.${i + 1}${ext}`;
        try { fs.renameSync(src, dst); } catch { /* file may not exist */ }
      }
    }

    // Rotate current file to .1
    fs.renameSync(filePath, `${base}.1${ext}`);
  } catch (err) {
    // Never throw — rotation failure must not crash the app
    console.error('[ClawNex Log Rotation] maybeRotate error:', err);
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Delete rotated log files in `logsDir` that are older than `retentionDays`.
 *
 * Scans for files matching `*.N.jsonl` pattern and removes those whose
 * mtime exceeds the retention window.
 *
 * @param logsDir        - Directory containing log files.
 * @param retentionDays  - Maximum age in days. If omitted, reads
 *                         `retention_logs_days` from config_defaults (default 14).
 * @returns Number of files deleted.
 */
export function cleanupOldLogs(logsDir: string, retentionDays?: number): number {
  let deleted = 0;
  try {
    const days = retentionDays ?? getConfigNumber('retention_logs_days', 14);
    if (days <= 0) return 0; // 0 = unlimited retention

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const entries = fs.readdirSync(logsDir);

    // Match rotated files: something.N.jsonl
    const rotatedPattern = /\.\d+\.jsonl$/;

    for (const entry of entries) {
      if (!rotatedPattern.test(entry)) continue;

      const fullPath = path.join(logsDir, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(fullPath);
          deleted++;
        }
      } catch {
        // Ignore per-file errors
      }
    }
  } catch (err) {
    console.error('[ClawNex Log Rotation] cleanupOldLogs error:', err);
  }
  return deleted;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read a numeric config value from the config_defaults table.
 * Falls back to `fallback` if the key is missing or the DB is unavailable.
 */
function getConfigNumber(key: string, fallback: number): number {
  try {
    const row = queryOne<ConfigDefault>('SELECT value FROM config_defaults WHERE key = ?', [key]);
    if (row?.value) {
      const n = Number(row.value);
      if (!Number.isNaN(n) && n >= 0) return n;
    }
  } catch {
    // DB may not be initialized yet during early startup
  }
  return fallback;
}
