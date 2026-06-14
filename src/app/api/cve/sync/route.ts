/**
 * CVE Sync API
 * POST /api/cve/sync — fetches latest CVE data from OpenClawCVEs repo and stores in DB
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from "@/lib/middleware/localhost-guard";
import { run, queryOne } from "@/lib/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CVE_URL = "https://raw.githubusercontent.com/jgamblin/OpenClawCVEs/main/cves.json";
const GHSA_URL = "https://raw.githubusercontent.com/jgamblin/OpenClawCVEs/main/ghsa-advisories.json";

interface CveRecord {
  cve_id: string;
  severity: string;
  cvss: number | null;
  title: string;
  date_published: string;
  ghsa_id: string;
}

interface GhsaRecord {
  ghsa_id: string;
  cve_id: string | null;
  severity: string;
  title: string;
  published: string;
  html_url: string;
  packages: string[];
  affected_versions: string[];
  fixed_versions: string[];
  fixed_version: string;
  cwes: string[];
}

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
    // Fetch both data sources in parallel
    const [cveRes, ghsaRes] = await Promise.allSettled([
      fetch(CVE_URL, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "ClawNex-CVE-Sync/1.0" } }),
      fetch(GHSA_URL, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "ClawNex-CVE-Sync/1.0" } }),
    ]);

    let cves: CveRecord[] = [];
    let ghsas: GhsaRecord[] = [];

    if (cveRes.status === "fulfilled" && cveRes.value.ok) {
      cves = await cveRes.value.json();
    }
    if (ghsaRes.status === "fulfilled" && ghsaRes.value.ok) {
      ghsas = await ghsaRes.value.json();
    }

    if (cves.length === 0) {
      return NextResponse.json({ error: "Failed to fetch CVE data from GitHub" }, { status: 502 });
    }

    // Build GHSA lookup for enrichment
    const ghsaMap = new Map<string, GhsaRecord>();
    for (const g of ghsas) {
      if (g.cve_id) ghsaMap.set(g.cve_id, g);
      ghsaMap.set(g.ghsa_id, g);
    }

    // Upsert CVE records
    let inserted = 0;
    let updated = 0;
    const now = new Date().toISOString();

    for (const cve of cves) {
      const ghsa = ghsaMap.get(cve.cve_id) || (cve.ghsa_id ? ghsaMap.get(cve.ghsa_id) : null);

      const existing = queryOne<{ cve_id: string }>(
        "SELECT cve_id FROM cve_records WHERE cve_id = ?", [cve.cve_id]
      );

      if (existing) {
        run(
          `UPDATE cve_records SET severity = ?, cvss = ?, title = ?, date_published = ?, ghsa_id = ?,
           affected_versions = ?, fixed_version = ?, cwes = ?, packages = ?, html_url = ?, synced_at = ?
           WHERE cve_id = ?`,
          [
            cve.severity?.toUpperCase() || "",
            cve.cvss,
            cve.title,
            cve.date_published,
            cve.ghsa_id || ghsa?.ghsa_id || "",
            ghsa ? JSON.stringify(ghsa.affected_versions) : "",
            ghsa?.fixed_version || "",
            ghsa ? JSON.stringify(ghsa.cwes) : "",
            ghsa ? JSON.stringify(ghsa.packages) : "",
            ghsa?.html_url || "",
            now,
            cve.cve_id,
          ]
        );
        updated++;
      } else {
        run(
          `INSERT INTO cve_records (cve_id, severity, cvss, title, date_published, ghsa_id, affected_versions, fixed_version, cwes, packages, html_url, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            cve.cve_id,
            cve.severity?.toUpperCase() || "",
            cve.cvss,
            cve.title,
            cve.date_published,
            cve.ghsa_id || ghsa?.ghsa_id || "",
            ghsa ? JSON.stringify(ghsa.affected_versions) : "",
            ghsa?.fixed_version || "",
            ghsa ? JSON.stringify(ghsa.cwes) : "",
            ghsa ? JSON.stringify(ghsa.packages) : "",
            ghsa?.html_url || "",
            now,
          ]
        );
        inserted++;
      }
    }

    // Audit log. Same fix as threat-intel/check (CX-R14-10): use the real
    // schema columns (resource_type, resource_id, source) so the row actually
    // lands. The prior INSERT silently failed inside the try/catch and CVE
    // syncs never made it into the audit trail.
    try {
      run(
        `INSERT INTO audit_log (id, actor, action, resource_type, resource_id, detail, source, created_at)
         VALUES (?, 'cve-sync', 'cve_sync', 'integration', 'github', ?, 'dashboard', datetime('now'))`,
        [require("crypto").randomUUID(), `Synced ${cves.length} CVEs (${inserted} new, ${updated} updated) from OpenClawCVEs`]
      );
    } catch {}

    return NextResponse.json({
      synced: cves.length,
      inserted,
      updated,
      ghsaEnriched: ghsas.length,
      timestamp: now,
    });
  } catch (err) {
    console.error("[CVE Sync] Error:", err);
    return NextResponse.json({ error: "CVE sync failed" }, { status: 500 });
  }
}
