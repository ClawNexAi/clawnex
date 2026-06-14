/**
 * Config Updates API
 * GET  /api/config/updates           -- check for available updates
 * POST /api/config/updates/clawkeeper   -- trigger Clawkeeper update
 * POST /api/config/updates/defenseclaw  -- check DefenseClaw rules status
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { queryOne, run } from "@/lib/db/index";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getConfigValue(key: string): string | null {
  const row = queryOne<{ value: string }>(
    "SELECT value FROM config_defaults WHERE key = ?",
    [key],
  );
  return row?.value ?? null;
}

function setConfigValue(key: string, value: string): void {
  run(
    `INSERT INTO config_defaults (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?`,
    [key, value, new Date().toISOString(), value, new Date().toISOString()],
  );
}

interface ClawkeeperState {
  /** Operator-facing string for display: "installed (YYYY-MM-DD)" or "not installed". */
  displayVersion: string;
  /** True if the binary exists on disk and is executable. */
  exists: boolean;
  /** File modification time of the binary, used as the "installed when" signal
   *  for update-availability comparison against the upstream release date.
   *  Clawkeeper has no --version flag, so mtime is the only signal we can rely on. */
  mtime: Date | null;
}

async function getInstalledClawkeeperState(): Promise<ClawkeeperState> {
  const bin = process.env.CLAWKEEPER_BINARY || path.join(os.homedir(), ".local", "bin", "clawkeeper.sh");
  try {
    const fs = await import('node:fs');
    fs.accessSync(bin, fs.constants.X_OK);
    const stats = fs.statSync(bin);
    const dateStr = stats.mtime.toISOString().split('T')[0];
    return {
      displayVersion: `installed (${dateStr})`,
      exists: true,
      mtime: stats.mtime,
    };
  } catch {
    return { displayVersion: "not installed", exists: false, mtime: null };
  }
}

async function fetchGitHubCommitDate(repo: string, filePath: string): Promise<string | null> {
  try {
    const url = `https://api.github.com/repos/${repo}/commits?path=${encodeURIComponent(filePath)}&per_page=1`;
    const res = await fetch(url, {
      headers: { "Accept": "application/vnd.github.v3+json", "User-Agent": "ClawNex-Sentinel/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      return data[0].commit?.committer?.date || data[0].commit?.author?.date || null;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchGitHubLatestRelease(repo: string): Promise<{ version: string; date: string; url: string } | null> {
  try {
    const url = `https://api.github.com/repos/${repo}/releases/latest`;
    const res = await fetch(url, {
      headers: { "Accept": "application/vnd.github.v3+json", "User-Agent": "ClawNex-Sentinel/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      version: data.tag_name || "unknown",
      date: data.published_at || data.created_at || "",
      url: data.html_url || "",
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET /api/config/updates -- check for updates
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'config:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const now = new Date().toISOString();

    // --- DefenseClaw Rules ---
    const lastRulesUpdate = getConfigValue("defenseclaw_rules_last_update") || "2026-03-31";
    const rulesVersion = getConfigValue("defenseclaw_rules_version") || "v2026-03-31";
    const rulesCount = getConfigValue("defenseclaw_rules_count") || "163";

    let defenseclawUpdateAvailable = false;
    let defenseclawLatestCommit: string | null = null;

    const lastCheck = getConfigValue("updates_last_checked");
    const cachedDefenseclawDate = getConfigValue("defenseclaw_latest_commit_date");
    const cachedClawkeeperVersion = getConfigValue("clawkeeper_latest_version");

    // Use cached data if checked within last 5 minutes
    const cacheValid = lastCheck && (Date.now() - new Date(lastCheck).getTime()) < 300000;

    if (cacheValid && cachedDefenseclawDate) {
      defenseclawLatestCommit = cachedDefenseclawDate;
    } else {
      defenseclawLatestCommit = await fetchGitHubCommitDate(
        "cisco-ai-defense/defenseclaw",
        "internal/gateway/rules.go",
      );
      if (defenseclawLatestCommit) {
        setConfigValue("defenseclaw_latest_commit_date", defenseclawLatestCommit);
      }
    }

    if (defenseclawLatestCommit) {
      defenseclawUpdateAvailable = new Date(defenseclawLatestCommit) > new Date(lastRulesUpdate);
    }

    // --- Clawkeeper ---
    const clawkeeperState = await getInstalledClawkeeperState();
    const installedVersion = clawkeeperState.displayVersion;

    let clawkeeperUpdateAvailable = false;
    let clawkeeperLatestVersion: string | null = null;
    let clawkeeperLatestDate: string | null = null;
    let clawkeeperReleaseUrl: string | null = null;

    if (cacheValid && cachedClawkeeperVersion) {
      clawkeeperLatestVersion = cachedClawkeeperVersion;
      clawkeeperLatestDate = getConfigValue("clawkeeper_latest_date");
      clawkeeperReleaseUrl = getConfigValue("clawkeeper_release_url");
    } else {
      const release = await fetchGitHubLatestRelease("rad-security/clawkeeper");
      if (release) {
        clawkeeperLatestVersion = release.version;
        clawkeeperLatestDate = release.date;
        clawkeeperReleaseUrl = release.url;
        setConfigValue("clawkeeper_latest_version", release.version);
        setConfigValue("clawkeeper_latest_date", release.date);
        setConfigValue("clawkeeper_release_url", release.url);
      }
    }

    // Clawkeeper has no --version flag, so installed "version" is just a
    // date-stamped string ("installed (YYYY-MM-DD)") derived from file
    // mtime — comparing it against the upstream semver tag would never
    // match (the prior implementation set updateAvailable=true forever).
    // Compare the file's mtime against the upstream release date instead:
    // if the local file was modified before the latest release was
    // published, an update is available.
    if (clawkeeperState.exists && clawkeeperState.mtime && clawkeeperLatestDate) {
      const releasePublishedAt = new Date(clawkeeperLatestDate);
      if (!Number.isNaN(releasePublishedAt.getTime())) {
        clawkeeperUpdateAvailable = clawkeeperState.mtime.getTime() < releasePublishedAt.getTime();
      }
    }

    // --- OpenClaw ---
    let openclawInstalled = "unknown";
    let openclawLatestVersion: string | null = null;
    let openclawLatestDate: string | null = null;
    let openclawReleaseUrl: string | null = null;
    let openclawUpdateAvailable = false;

    // Read installed version from OpenClaw's update-check.json
    try {
      const fs = await import('node:fs');
      const updateCheckPath = path.join(os.homedir(), ".openclaw", "update-check.json");
      const raw = fs.readFileSync(updateCheckPath, "utf-8");
      const updateCheck = JSON.parse(raw);
      openclawInstalled = updateCheck.lastNotifiedVersion || updateCheck.lastAvailableVersion || updateCheck.currentVersion || updateCheck.version || "unknown";
    } catch {
      openclawInstalled = "unknown";
    }

    const cachedOpenclawVersion = getConfigValue("openclaw_latest_version");
    if (cacheValid && cachedOpenclawVersion) {
      openclawLatestVersion = cachedOpenclawVersion;
      openclawLatestDate = getConfigValue("openclaw_latest_date");
      openclawReleaseUrl = getConfigValue("openclaw_release_url");
    } else {
      const release = await fetchGitHubLatestRelease("openclaw/openclaw");
      if (release) {
        openclawLatestVersion = release.version;
        openclawLatestDate = release.date;
        openclawReleaseUrl = release.url;
        setConfigValue("openclaw_latest_version", release.version);
        setConfigValue("openclaw_latest_date", release.date);
        setConfigValue("openclaw_release_url", release.url);
      }
    }

    if (openclawLatestVersion && openclawInstalled !== "unknown" && openclawInstalled !== "installed") {
      const installed = openclawInstalled.replace(/^v/, "").replace(/[^0-9.]/g, "");
      const latest = openclawLatestVersion.replace(/^v/, "").replace(/[^0-9.]/g, "");
      openclawUpdateAvailable = installed !== latest && latest > installed;
    }

    // Save last checked time
    setConfigValue("updates_last_checked", now);

    return NextResponse.json({
      defenseclaw: {
        name: "DefenseClaw Rules",
        currentVersion: rulesVersion,
        ruleCount: parseInt(rulesCount, 10),
        lastUpdate: lastRulesUpdate,
        latestCommitDate: defenseclawLatestCommit,
        updateAvailable: defenseclawUpdateAvailable,
      },
      clawkeeper: {
        name: "Clawkeeper",
        installedVersion,
        latestVersion: clawkeeperLatestVersion,
        latestDate: clawkeeperLatestDate,
        releaseUrl: clawkeeperReleaseUrl,
        updateAvailable: clawkeeperUpdateAvailable,
      },
      openclaw: {
        name: "OpenClaw",
        installedVersion: openclawInstalled,
        latestVersion: openclawLatestVersion,
        latestDate: openclawLatestDate,
        releaseUrl: openclawReleaseUrl,
        updateAvailable: openclawUpdateAvailable,
      },
      lastChecked: now,
    });
  } catch (err) {
    console.error("[API /config/updates GET] Error:", err);
    return NextResponse.json({ error: "Failed to check for updates" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/config/updates -- handle update actions
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'config:write');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const body = await request.json();
    const { action } = body as { action?: string };

    if (action === "clawkeeper") {
      // Full supply-chain integrity check (CX-R14-04 + recurring R13-02 +
      // new-assessment CRIT #4). Three layers:
      //
      //   1. Commit-pinned URL — fetch from a specific commit SHA in
      //      rad-security/clawkeeper rather than `main`. Upstream can push
      //      new versions of clawkeeper.sh without us silently picking them
      //      up; the pin is a deliberate decision.
      //
      //   2. SHA-256 checksum verify — after download, compute the
      //      SHA-256 of the file bytes and compare against CLAWKEEPER_SHA256.
      //      A CDN compromise or MITM that returns altered bytes fails the
      //      compare and the file is rejected before chmod +x.
      //
      //   3. Shebang + size sanity — defense in depth. A 0-byte response
      //      or an HTML error page still gets rejected even before the
      //      checksum step.
      //
      // To refresh the pin (e.g., when upstream lands a real improvement):
      //   curl -fsSL https://api.github.com/repos/rad-security/clawkeeper/commits/main \
      //     | jq -r .sha
      //   curl -fsSL https://raw.githubusercontent.com/rad-security/clawkeeper/<sha>/clawkeeper.sh \
      //     | shasum -a 256
      // Update both CLAWKEEPER_PINNED_SHA + CLAWKEEPER_SHA256 below + the
      // matching constants in src/app/api/system/install-clawkeeper/route.ts.
      const CLAWKEEPER_PINNED_SHA = "fd041dc670e8b8cd0aad00a54fa4251f279fc0d2";
      const CLAWKEEPER_SHA256 = "e288603da69f71c6c0c922e6efdae14b652a13e7b850bacfd99aa3af55c32418";
      try {
        const clawkeeperPath = path.join(os.homedir(), ".local", "bin", "clawkeeper.sh");
        const sourceUrl = `https://raw.githubusercontent.com/rad-security/clawkeeper/${CLAWKEEPER_PINNED_SHA}/clawkeeper.sh`;
        await execFileAsync("mkdir", ["-p", path.dirname(clawkeeperPath)], { timeout: 5_000 });
        await execFileAsync("curl", ["-fsSL", "--max-time", "20", "-o", clawkeeperPath, sourceUrl], {
          timeout: 30_000,
        });
        const fs = await import("node:fs/promises");
        const stat = await fs.stat(clawkeeperPath);
        if (stat.size < 100) {
          throw new Error(`Downloaded clawkeeper.sh suspiciously small (${stat.size} bytes) — refusing to install`);
        }
        const bytes = await fs.readFile(clawkeeperPath);
        const head = bytes.slice(0, 64).toString("utf8");
        if (!head.startsWith("#!") || !/(bash|sh)\b/.test(head)) {
          throw new Error("Downloaded clawkeeper.sh has no bash/sh shebang — refusing to install");
        }
        const { createHash } = await import("node:crypto");
        const actual = createHash("sha256").update(bytes).digest("hex");
        if (actual !== CLAWKEEPER_SHA256) {
          // Delete the suspect file so a re-run doesn't accidentally chmod+x it.
          await fs.unlink(clawkeeperPath).catch(() => {});
          throw new Error(
            `Clawkeeper checksum mismatch — refusing to install. ` +
            `Expected ${CLAWKEEPER_SHA256}, got ${actual}. ` +
            `The upstream may have been updated (refresh CLAWKEEPER_SHA256 + CLAWKEEPER_PINNED_SHA) ` +
            `or the download was tampered with.`
          );
        }
        await execFileAsync("chmod", ["+x", clawkeeperPath], { timeout: 5_000 });
        const output = `Installed clawkeeper.sh (${stat.size} bytes, sha256-verified) at ${clawkeeperPath}`;

        const newVersion = (await getInstalledClawkeeperState()).displayVersion;

        return NextResponse.json({
          status: "updated",
          newVersion,
          output,
        });
      } catch (err) {
        const execErr = err as { stdout?: string; stderr?: string; message?: string };
        return NextResponse.json({
          status: "error",
          error: execErr.message || "Update failed",
          output: (execErr.stdout || "") + (execErr.stderr || ""),
        }, { status: 500 });
      }
    }

    if (action === "defenseclaw") {
      // Just check status for now (actual rule porting is complex)
      const latestCommit = await fetchGitHubCommitDate(
        "cisco-ai-defense/defenseclaw",
        "internal/gateway/rules.go",
      );

      return NextResponse.json({
        status: "checked",
        latestCommitDate: latestCommit,
        message: "DefenseClaw rules check complete. Manual rule porting required for updates.",
      });
    }

    if (action === "check") {
      // Force refresh -- clear cache and re-check
      setConfigValue("updates_last_checked", "");
      return NextResponse.json({ status: "cache_cleared", message: "Cache cleared. Refresh to check for updates." });
    }

    return NextResponse.json({ error: "Unknown action. Use 'clawkeeper', 'defenseclaw', or 'check'." }, { status: 400 });
  } catch (err) {
    console.error("[API /config/updates POST] Error:", err);
    return NextResponse.json({ error: "Update action failed" }, { status: 500 });
  }
}
