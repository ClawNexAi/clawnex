/**
 * Config Updates API
 * GET  /api/config/updates           -- check for available updates
 * POST /api/config/updates/clawkeeper   -- compatibility no-op for built-in scanner
 * POST /api/config/updates/defenseclaw  -- check DefenseClaw rules status
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { queryOne, run } from "@/lib/db/index";
import { findHostSecurityScanner } from "@/lib/services/host-security/scanner-path";
import path from "node:path";
import os from "node:os";

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
  /** Operator-facing string for display. */
  displayVersion: string;
  /** True if the bundled or explicitly configured scanner exists. */
  exists: boolean;
  /** File modification time of the scanner script. */
  mtime: Date | null;
}

async function getInstalledClawkeeperState(): Promise<ClawkeeperState> {
  const scanner = findHostSecurityScanner();
  if (scanner) {
    if (scanner.source === "bundled") {
      return {
        displayVersion: "built into ClawNex",
        exists: true,
        mtime: scanner.mtime,
      };
    }
    const dateStr = scanner.mtime.toISOString().split('T')[0];
    const label = scanner.source === "env" ? "configured binary" : "legacy binary";
    return {
      displayVersion: `${label} (${dateStr})`,
      exists: true,
      mtime: scanner.mtime,
    };
  }

  return { displayVersion: "not installed", exists: false, mtime: null };
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

    // --- Clawkeeper / ClawNex Host Security ---
    // The scanner is now bundled with ClawNex. We keep the JSON key as
    // `clawkeeper` for UI compatibility, but no longer call GitHub or
    // download a third-party script at runtime.
    const clawkeeperState = await getInstalledClawkeeperState();
    const installedVersion = clawkeeperState.displayVersion;

    const clawkeeperUpdateAvailable = false;
    const clawkeeperLatestVersion: string | null = null;
    const clawkeeperLatestDate: string | null = null;
    const clawkeeperReleaseUrl: string | null = null;

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
        name: "Host Security Scanner",
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
      const newVersion = (await getInstalledClawkeeperState()).displayVersion;
      return NextResponse.json({
        status: "updated",
        newVersion,
        output: "Host security scanner is bundled with ClawNex; no external update is required.",
      });
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
