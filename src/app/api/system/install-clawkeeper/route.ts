/**
 * Install Clawkeeper API
 * POST /api/system/install-clawkeeper — downloads and installs clawkeeper.sh
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { run } from "@/lib/db/index";

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
    const installDir = path.join(os.homedir(), ".local", "bin");
    const clawkeeperPath = path.join(installDir, "clawkeeper.sh");

    // Check if already installed
    if (fs.existsSync(clawkeeperPath)) {
      return NextResponse.json({ ok: true, status: "already_installed", path: clawkeeperPath });
    }

    // Create install directory
    if (!fs.existsSync(installDir)) {
      fs.mkdirSync(installDir, { recursive: true });
    }

    // Full supply-chain integrity check (CX-R13-02 + new-assessment CRIT #4).
    // Three layers: commit-pinned URL, SHA-256 checksum verify, shebang+size
    // sanity. See the matching block in src/app/api/config/updates/route.ts
    // for full rationale + the pin-refresh procedure. Both routes must use
    // the same constants — keep them in sync when refreshing.
    const CLAWKEEPER_PINNED_SHA = "fd041dc670e8b8cd0aad00a54fa4251f279fc0d2";
    const CLAWKEEPER_SHA256 = "e288603da69f71c6c0c922e6efdae14b652a13e7b850bacfd99aa3af55c32418";
    try {
      const sourceUrl = `https://raw.githubusercontent.com/rad-security/clawkeeper/${CLAWKEEPER_PINNED_SHA}/clawkeeper.sh`;
      execSync(`curl -fsSL --max-time 20 -o "${clawkeeperPath}" "${sourceUrl}"`, {
        timeout: 30000,
        stdio: "pipe",
      });
      const stat = fs.statSync(clawkeeperPath);
      if (stat.size < 100) {
        return NextResponse.json({
          ok: false,
          error: `Downloaded clawkeeper.sh suspiciously small (${stat.size} bytes) — refusing to install`,
        }, { status: 502 });
      }
      const bytes = fs.readFileSync(clawkeeperPath);
      const head = bytes.slice(0, 64).toString("utf8");
      if (!head.startsWith("#!") || !/(bash|sh)\b/.test(head)) {
        return NextResponse.json({
          ok: false,
          error: "Downloaded clawkeeper.sh has no bash/sh shebang — refusing to install",
        }, { status: 502 });
      }
      const { createHash } = require("node:crypto") as typeof import("node:crypto");
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (actual !== CLAWKEEPER_SHA256) {
        try { fs.unlinkSync(clawkeeperPath); } catch {}
        return NextResponse.json({
          ok: false,
          error: "Clawkeeper checksum mismatch — refusing to install",
          detail: `Expected ${CLAWKEEPER_SHA256}, got ${actual}. The upstream pin may need refresh, or the download was tampered with.`,
        }, { status: 502 });
      }
      execSync(`chmod +x "${clawkeeperPath}"`, { timeout: 5000, stdio: "pipe" });
    } catch (err) {
      return NextResponse.json({
        ok: false,
        error: "Failed to download Clawkeeper",
        detail: err instanceof Error ? err.message : "Unknown error",
      }, { status: 502 });
    }

    // Verify installation
    const installed = fs.existsSync(clawkeeperPath);

    // Audit log
    try {
      run(
        `INSERT INTO audit_log (id, actor, action, resource, detail, created_at) VALUES (?, 'operator', 'clawkeeper_install', 'system', ?, datetime('now'))`,
        [require("crypto").randomUUID(), installed ? `Clawkeeper installed at ${clawkeeperPath}` : "Clawkeeper install failed"]
      );
    } catch {}

    if (installed) {
      return NextResponse.json({ ok: true, status: "installed", path: clawkeeperPath });
    } else {
      return NextResponse.json({ ok: false, error: "Installation completed but binary not found" }, { status: 500 });
    }
  } catch (err) {
    console.error("[Install Clawkeeper] Error:", err);
    return NextResponse.json({ error: "Installation failed" }, { status: 500 });
  }
}
