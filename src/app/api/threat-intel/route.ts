/**
 * Threat Intelligence API — returns intel source status and Pliny rule counts.
 * GET /api/threat-intel
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import { queryAll } from "@/lib/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTEL_SOURCES = [
  { name: "L1B3RT4S", repo: "elder-plinius/L1B3RT4S", desc: "Master jailbreak prompt library", rulePrefix: "JAIL-PLINY" },
  { name: "ST3GG", repo: "elder-plinius/ST3GG", desc: "Steganographic payload hiding", rulePrefix: "STEG-PLINY" },
  { name: "G0DM0D3", repo: "elder-plinius/G0DM0D3", desc: "GODMODE activation variants", rulePrefix: "JAIL-PLINY-GODMODE" },
  { name: "P4RS3LT0NGV3", repo: "elder-plinius/P4RS3LT0NGV3", desc: "Encoding/obfuscation techniques", rulePrefix: "ENC-PLINY" },
];

// Rule counts per source (static — updated when new rules are added)
const RULE_COUNTS: Record<string, number> = {
  "L1B3RT4S": 10,  // All JAIL-PLINY-* rules
  "ST3GG": 3,      // STEG-PLINY-*
  "G0DM0D3": 0,    // Covered by L1B3RT4S GODMODE rules
  "P4RS3LT0NGV3": 3, // ENC-PLINY-*
};

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

  // Get last check times from DB
  let checkData: Array<{ source: string; last_checked: string; last_commit: string; status: string }> = [];
  try {
    checkData = queryAll<{ source: string; last_checked: string; last_commit: string; status: string }>(
      "SELECT key as source, value as last_checked, '' as last_commit, 'active' as status FROM config_defaults WHERE key LIKE 'threat_intel_%'"
    );
  } catch {}

  const checkMap = new Map(checkData.map(c => [c.source.replace("threat_intel_", ""), c]));

  const sources = INTEL_SOURCES.map(s => {
    const check = checkMap.get(s.name);
    let parsedData: { lastChecked?: string; lastCommit?: string; status?: string } = {};
    if (check) {
      try { parsedData = JSON.parse(check.last_checked); } catch {}
    }
    return {
      name: s.name,
      repo: s.repo,
      desc: s.desc,
      ruleCount: RULE_COUNTS[s.name] || 0,
      lastChecked: parsedData.lastChecked || null,
      lastCommit: parsedData.lastCommit || null,
      status: parsedData.status || "active",
    };
  });

  return NextResponse.json({
    sources,
    totalPlinyRules: Object.values(RULE_COUNTS).reduce((a, b) => a + b, 0),
    totalSources: INTEL_SOURCES.length,
  });
}
