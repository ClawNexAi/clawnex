/**
 * Archive DB API
 * POST /api/system/archive — creates a timestamped backup of sentinel.db
 * Returns the backup filename and path.
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission, getOperatorFromRequest } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import * as fs from "node:fs";
import * as path from "node:path";
import { run, getDbPath } from "@/lib/db/index";
import { resolveVacuumBackupPath, vacuumIntoResolved } from "@/lib/db/vacuum-into";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'system:manage');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    // Codex 2026-05-17 #4: previously hardcoded process.cwd()/sentinel.db,
    // which returns 404 on a fresh post-rebrand install where the live DB
    // is clawnex.db (or wherever DATABASE_PATH points). Operators believed
    // their backup ran. Reuse the same resolver getDb() uses so archive,
    // migrate, and uninstall all target the actual live DB.
    const dbPath = getDbPath();
    if (dbPath === ":memory:" || !fs.existsSync(dbPath)) {
      return NextResponse.json({ error: "Database not found" }, { status: 404 });
    }

    const backupDir = path.join(process.cwd(), "backups");
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const backupFile = `clawnex-backup-${timestamp}.db`;
    // Validate UPFRONT — any path-injection shape throws here, before
    // the try/fallback below, so the route's outer try/catch surfaces
    // a clean 500 instead of the fallback silently copying with the
    // bad basename. Both branches below re-use this absolute path so
    // a future change letting user input through `backupFile` can't
    // smuggle past validation via the fs.copyFileSync edge.
    const backupPath = resolveVacuumBackupPath(backupDir, backupFile);

    // VACUUM INTO is the preferred path (consistent snapshot, WAL
    // consolidated). On SQLite-side failure fall back to a plain file
    // copy of the live DB.
    try {
      vacuumIntoResolved(backupPath);
    } catch {
      fs.copyFileSync(dbPath, backupPath);
    }

    // Restrict backup file to owner-only read/write
    fs.chmodSync(backupPath, 0o600);

    const stats = fs.statSync(backupPath);

    // Audit log
    try {
      const operator = getOperatorFromRequest(request);
      const actor = operator?.username || 'operator';
      run(
        `INSERT INTO audit_log (id, actor, action, resource_type, resource_id, detail, source, created_at) VALUES (?, ?, 'db_archive', 'system', NULL, ?, 'dashboard', datetime('now'))`,
        [require("crypto").randomUUID(), actor, `Archived to ${backupFile} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`]
      );
    } catch {}

    return NextResponse.json({
      ok: true,
      filename: backupFile,
      path: backupPath,
      size: stats.size,
      sizeFormatted: `${(stats.size / 1024 / 1024).toFixed(1)}MB`,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Archive] Error:", err);
    return NextResponse.json({ error: "Archive failed" }, { status: 500 });
  }
}
