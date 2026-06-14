/**
 * Threat Intel Check — polls GitHub for latest commits on Pliny repos.
 * POST /api/threat-intel/check
 *
 * Compares latest commit SHA to stored value. If changed, marks source
 * as "update_available" and creates an alert.
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { run, queryOne } from "@/lib/db/index";
import { createAlert } from "@/lib/services/alert-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPOS = [
  { name: "L1B3RT4S", repo: "elder-plinius/L1B3RT4S" },
  { name: "ST3GG", repo: "elder-plinius/ST3GG" },
  { name: "G0DM0D3", repo: "elder-plinius/G0DM0D3" },
  { name: "P4RS3LT0NGV3", repo: "elder-plinius/P4RS3LT0NGV3" },
];

async function getLatestCommit(repo: string): Promise<{ sha: string; message: string; date: string } | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits?per_page=1`, {
      headers: { "Accept": "application/vnd.github.v3+json", "User-Agent": "ClawNex-ThreatIntel/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return {
      sha: data[0].sha,
      message: data[0].commit?.message?.slice(0, 100) || "",
      date: data[0].commit?.author?.date || new Date().toISOString(),
    };
  } catch { return null; }
}

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

  const results: Array<{ name: string; status: string; sha?: string; message?: string }> = [];
  let updatesFound = 0;

  for (const source of REPOS) {
    const commit = await getLatestCommit(source.repo);
    if (!commit) {
      results.push({ name: source.name, status: "error" });
      continue;
    }

    // Get previously stored commit SHA
    const key = `threat_intel_${source.name}`;
    let prevData: { lastCommit?: string } = {};
    try {
      const row = queryOne<{ value: string }>(`SELECT value FROM config_defaults WHERE key = ?`, [key]);
      if (row?.value) prevData = JSON.parse(row.value);
    } catch {}

    const isNew = prevData.lastCommit && prevData.lastCommit !== commit.sha;
    const status = isNew ? "update_available" : "active";

    // Store the check result
    const storeData = JSON.stringify({
      lastChecked: new Date().toISOString(),
      lastCommit: commit.sha,
      lastMessage: commit.message,
      lastCommitDate: commit.date,
      status,
    });

    try {
      run(`INSERT OR REPLACE INTO config_defaults (key, value) VALUES (?, ?)`, [key, storeData]);
    } catch {}

    if (isNew) {
      updatesFound++;
      createAlert(
        `Threat Intel Update: ${source.name}`,
        `New commit detected in ${source.repo}: "${commit.message}". Review for new jailbreak techniques and update shield rules if needed.`,
        "MEDIUM",
        "threat-intel"
      );
    }

    results.push({ name: source.name, status, sha: commit.sha, message: commit.message });
  }

  // Audit log the check. Schema columns are resource_type + resource_id +
  // source (NOT NULL) — the prior INSERT used `resource` with no `source`,
  // so the constraint was violating silently inside the try/catch and every
  // threat-intel check was missing from the audit trail (CX-R14-10).
  try {
    run(
      `INSERT INTO audit_log (id, actor, action, resource_type, resource_id, detail, source, created_at)
       VALUES (?, 'threat-intel', 'intel_check', 'integration', 'github', ?, 'dashboard', datetime('now'))`,
      [require("crypto").randomUUID(), `Checked ${REPOS.length} repos. ${updatesFound} updates found.`]
    );
  } catch {}

  return NextResponse.json({
    checked: results.length,
    updatesFound,
    results,
    timestamp: new Date().toISOString(),
  });
}
