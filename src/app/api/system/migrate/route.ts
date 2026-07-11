/**
 * Migration Package API
 * POST /api/system/migrate — creates a migration bundle with DB + config
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission, getOperatorFromRequest } from '@/lib/rbac/guard';
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { run, getDbPath } from "@/lib/db/index";
import { resolveVacuumBackupPath, sanitizeForensicEvidenceFromBackup, vacuumIntoResolved } from "@/lib/db/vacuum-into";
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { CLAWNEX_VERSION } from "@/lib/version";

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
    const installDir = process.cwd();
    const migrateDir = path.join(installDir, "backups", "migration");
    if (!fs.existsSync(migrateDir)) fs.mkdirSync(migrateDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const bundleName = `clawnex-migration-${timestamp}`;
    const bundleDir = path.join(migrateDir, bundleName);
    fs.mkdirSync(bundleDir, { recursive: true });

    // 1. Archive DB
    // Codex 2026-05-17 #4: previously hardcoded installDir/sentinel.db,
    // missing the actual live DB on post-rebrand installs (clawnex.db) or
    // wherever DATABASE_PATH points. Reuse the canonical resolver so the
    // migration bundle ACTUALLY contains operator data — and keep the
    // basename inside the bundle matching the source so the destination
    // host doesn't have to guess which filename to expect.
    const dbPath = getDbPath();
    const dbBasename = dbPath === ":memory:" ? "clawnex.db" : path.basename(dbPath);
    if (dbPath !== ":memory:" && fs.existsSync(dbPath)) {
      // Validate upfront — both branches re-use the same resolved
      // absolute path so the fallback can't bypass validation.
      const safeBundleDbPath = resolveVacuumBackupPath(bundleDir, dbBasename);
      try { vacuumIntoResolved(safeBundleDbPath); }
      catch { fs.copyFileSync(dbPath, safeBundleDbPath); }
      sanitizeForensicEvidenceFromBackup(safeBundleDbPath);
    }

    // 2. Copy .env if exists
    const envPath = path.join(installDir, ".env");
    if (fs.existsSync(envPath)) {
      fs.copyFileSync(envPath, path.join(bundleDir, ".env"));
    }

    // Lock down DB and env in the bundle (basename derives from the live
    // DB path so a post-rebrand install bundles clawnex.db, not sentinel.db).
    try { fs.chmodSync(path.join(bundleDir, dbBasename), 0o600); } catch {}
    try { fs.chmodSync(path.join(bundleDir, ".env"), 0o600); } catch {}

    // 3. Copy LiteLLM config — the live file is config.yaml (not litellm_config.yaml)
    const litellmDir = path.join(bundleDir, "litellm");
    fs.mkdirSync(litellmDir, { recursive: true });
    const litellmConfig = path.join(installDir, "litellm", "config.yaml");
    if (fs.existsSync(litellmConfig)) {
      fs.copyFileSync(litellmConfig, path.join(litellmDir, "config.yaml"));
    }
    const litellmLogger = path.join(installDir, "litellm", "clawnex_logger.py");
    if (fs.existsSync(litellmLogger)) {
      fs.copyFileSync(litellmLogger, path.join(bundleDir, "litellm", "clawnex_logger.py"));
    }

    // Lock down litellm config AFTER copy
    try { fs.chmodSync(path.join(litellmDir, "config.yaml"), 0o600); } catch {}

    // 4. Create migration manifest
    const manifest = {
      version: CLAWNEX_VERSION,
      created: new Date().toISOString(),
      source: require("node:os").hostname(),
      contents: {
        database: fs.existsSync(path.join(bundleDir, dbBasename)),
        databaseFilename: dbBasename,
        env: fs.existsSync(path.join(bundleDir, ".env")),
        litellmConfig: fs.existsSync(path.join(bundleDir, "litellm", "config.yaml")),
      },
      instructions: [
        "1. Transfer this bundle to the new host",
        "2. Run the deploy script: bash deploy/deploy.sh",
        `3. Copy ${dbBasename} to the new installation directory`,
        "4. Copy .env to the new installation directory",
        "5. Copy litellm/ config files to the new installation",
        "6. Restart all services: npm run dev (or pm2 restart)",
      ],
    };
    fs.writeFileSync(path.join(bundleDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    // 5. Create tar.gz
    let tarFile = "";
    try {
      tarFile = `${bundleName}.tar.gz`;
      execSync(`cd "${migrateDir}" && tar -czf "${tarFile}" "${bundleName}"`, { timeout: 30000 });
      // Lock down the tarball
      try { fs.chmodSync(path.join(migrateDir, tarFile), 0o600); } catch {}
      // Clean up the uncompressed directory
      execSync(`rm -rf "${bundleDir}"`, { timeout: 5000 });
    } catch {
      tarFile = ""; // tar failed, keep the directory
    }

    // Audit log
    try {
      const operator = getOperatorFromRequest(request);
      const actor = operator?.username || 'operator';
      run(
        `INSERT INTO audit_log (id, actor, action, resource_type, source, detail, created_at) VALUES (?, ?, 'migration_package', 'system', 'clawnex', ?, datetime('now'))`,
        [require("crypto").randomUUID(), actor, `Migration package created: ${tarFile || bundleName}`]
      );
    } catch {}

    // Adversarial review finding #A5 (2026-04-24): do NOT echo an absolute
    // filesystem path back to the caller. The tarball contains sentinel.db
    // (password hashes, session tokens, API keys) plus .env; an absolute-path
    // echo chains with any hypothetical LFI to upgrade enumeration to direct
    // secret theft. Chmod 0600 is already applied to the tarball above.
    // Bundle filename is sufficient — the known location is documented in
    // the admin UI + deployment guide.
    return NextResponse.json({
      ok: true,
      bundle: tarFile || bundleName,
      location: "backups/migration/ (relative to the ClawNex install directory)",
      manifest,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Migrate] Error:", err);
    return NextResponse.json({ error: "Migration package creation failed" }, { status: 500 });
  }
}
