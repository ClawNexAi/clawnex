/**
 * ClawNex Structured Logger — JSON line logging with automatic rotation.
 *
 * Writes one JSON object per line to `logs/clawnex.jsonl`. Each entry includes
 * an ISO-8601 timestamp, severity level, source subsystem, human-readable
 * message, and optional structured data payload.
 *
 * Before every write, the rotation module is consulted to ensure the log file
 * stays within the configured size limit. Rotation is transparent to callers.
 *
 * All I/O is synchronous (`fs.appendFileSync`) and defensive — logging must
 * never throw or crash the application.
 *
 * @module services/logger
 */

import fs from 'node:fs';
import path from 'node:path';
import { maybeRotate } from './log-rotation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Severity levels for log entries. */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/** Subsystem that produced the log entry. */
export type LogSource = 'shield' | 'watcher' | 'connector' | 'system' | 'api';

/** Shape of a single JSON line in the log file. */
export interface LogEntry {
  ts: string;
  level: LogLevel;
  source: LogSource;
  msg: string;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Resolve the log file path relative to the project root. */
function getLogPath(): string {
  return path.resolve(process.cwd(), 'logs', 'clawnex.jsonl');
}

/** Resolve the logs directory, creating it if necessary. */
function ensureLogsDir(): void {
  const dir = path.resolve(process.cwd(), 'logs');
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // Directory may have been created by another process
    }
  }
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Write a structured log entry to `logs/clawnex.jsonl`.
 *
 * Each call:
 * 1. Ensures the logs directory exists.
 * 2. Asks `maybeRotate()` to rotate the file if it exceeds the size limit.
 * 3. Appends a single JSON line with a trailing newline.
 *
 * @param level  - Severity: DEBUG, INFO, WARN, or ERROR.
 * @param source - Subsystem identifier (shield, watcher, connector, system, api).
 * @param msg    - Human-readable log message.
 * @param data   - Optional structured payload for machine consumption.
 */
export function log(
  level: LogLevel,
  source: LogSource,
  msg: string,
  data?: Record<string, unknown>,
): void {
  try {
    ensureLogsDir();

    const filePath = getLogPath();

    // Rotate before writing if the file is over the size limit
    maybeRotate(filePath);

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      source,
      msg,
      ...(data !== undefined ? { data } : {}),
    };

    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (err) {
    // Last-resort fallback — never throw from the logger
    console.error('[ClawNex Logger] Write failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

/**
 * Log an INFO-level entry.
 * @param source - Subsystem identifier.
 * @param msg    - Human-readable message.
 * @param data   - Optional structured payload.
 */
export function logInfo(source: LogSource, msg: string, data?: Record<string, unknown>): void {
  log('INFO', source, msg, data);
}

/**
 * Log a WARN-level entry.
 * @param source - Subsystem identifier.
 * @param msg    - Human-readable message.
 * @param data   - Optional structured payload.
 */
export function logWarn(source: LogSource, msg: string, data?: Record<string, unknown>): void {
  log('WARN', source, msg, data);
}

/**
 * Log an ERROR-level entry.
 * @param source - Subsystem identifier.
 * @param msg    - Human-readable message.
 * @param data   - Optional structured payload.
 */
export function logError(source: LogSource, msg: string, data?: Record<string, unknown>): void {
  log('ERROR', source, msg, data);
}

/**
 * Log a DEBUG-level entry.
 * @param source - Subsystem identifier.
 * @param msg    - Human-readable message.
 * @param data   - Optional structured payload.
 */
export function logDebug(source: LogSource, msg: string, data?: Record<string, unknown>): void {
  log('DEBUG', source, msg, data);
}
