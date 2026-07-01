/**
 * Infrastructure Logs API
 * GET /api/infrastructure/logs
 *
 * Returns the last N lines from logs/clawnex.jsonl with optional filtering
 * by severity level and source subsystem.
 *
 * Query params:
 *   ?lines=100   — number of lines to return (default 100, max 500)
 *   ?level=ERROR  — filter by log level (INFO, WARN, ERROR, DEBUG)
 *   ?source=shield — filter by source subsystem
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import fs from "node:fs";
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { getStructuredLogPath } from "@/lib/services/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LogEntry {
  ts: string;
  level: string;
  source: string;
  msg: string;
  data?: Record<string, unknown>;
}

// CX-R14-11: cap how much of the log file we ever touch. Without this,
// a misconfigured / unrotated clawnex.jsonl growing to hundreds of MB would
// OOM the Node process on every panel render. Tail the last `MAX_TAIL_BYTES`
// from the file regardless of total size; line-splitting happens after the
// bounded buffer is in memory.
const MAX_TAIL_BYTES = 4 * 1024 * 1024;  // 4 MB — comfortable headroom over 500 lines × 8KB

/**
 * Read the last `maxLines` lines from a file with a hard memory cap.
 * - If the file is <= MAX_TAIL_BYTES, read the whole thing (small case).
 * - Otherwise, open a read stream from `(size - MAX_TAIL_BYTES)` to the end,
 *   discard the first (likely-partial) line, and return the tail.
 *
 * No path manipulation, no streaming-line-parser dependency — just a single
 * bounded fs.readSync into a fixed buffer.
 */
function readLastLines(filePath: string, maxLines: number): string[] {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return [];
    const size = stat.size;

    if (size <= MAX_TAIL_BYTES) {
      const content = fs.readFileSync(fd, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      return lines.slice(-maxLines);
    }

    // Large file — read only the trailing window.
    const buf = Buffer.alloc(MAX_TAIL_BYTES);
    const start = size - MAX_TAIL_BYTES;
    fs.readSync(fd, buf, 0, MAX_TAIL_BYTES, start);
    const text = buf.toString("utf-8");
    // Drop the first line — it's almost certainly a partial line from where
    // we sliced into the file mid-record.
    const idx = text.indexOf("\n");
    const usable = idx === -1 ? text : text.slice(idx + 1);
    const lines = usable.split("\n").filter((l) => l.trim().length > 0);
    return lines.slice(-maxLines);
  } catch {
    return [];
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* nothing left to do */ }
    }
  }
}

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'dashboard:view');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const { searchParams } = new URL(request.url);

    // Parse query params
    const requestedLines = Math.min(
      Math.max(1, parseInt(searchParams.get("lines") || "100", 10) || 100),
      500,
    );
    const levelFilter = (searchParams.get("level") || "").toUpperCase();
    const sourceFilter = (searchParams.get("source") || "").toLowerCase();

    const logFile = getStructuredLogPath();

    // Read more lines than requested so we have enough after filtering
    const readCount = levelFilter || sourceFilter ? requestedLines * 5 : requestedLines;
    const rawLines = readLastLines(logFile, Math.min(readCount, 2500));

    // Parse and filter
    let entries: LogEntry[] = [];
    for (const line of rawLines) {
      try {
        const parsed = JSON.parse(line) as LogEntry;
        if (levelFilter && parsed.level !== levelFilter) continue;
        if (sourceFilter && parsed.source !== sourceFilter) continue;
        entries.push(parsed);
      } catch {
        // Skip malformed lines
      }
    }

    // Take the last N entries after filtering
    const total = entries.length;
    entries = entries.slice(-requestedLines);

    return NextResponse.json({
      entries,
      total,
      file: "clawnex.jsonl",
    });
  } catch (err) {
    console.error("[Logs API] GET error:", err);
    return NextResponse.json(
      { error: "Failed to read log entries" },
      { status: 500 },
    );
  }
}
