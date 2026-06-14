/**
 * Access Control API
 * GET /api/access-control -- returns deny lists and path/URL check functions
 */

import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { ALL_RULES } from "@/lib/shield/rules";
import { requireLocalhost } from "@/lib/middleware/localhost-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Denied files/extensions from the shield rules + workspace reader
const DENIED_FILES = [
  ".env", ".env.local", ".env.production",
  ".pem", ".key", ".p12", ".pfx", ".jks",
  "id_rsa", "id_ed25519", "id_ecdsa",
  "credentials.json", "service-account.json",
  ".ssh/", ".gnupg/",
];

const DENIED_PATHS = [
  "/etc/passwd", "/etc/shadow", "/etc/hosts",
  "/proc/", "/sys/", "/dev/",
  "../../", "../",
  ".git/", "node_modules/",
];

const DENIED_EXTENSIONS = [
  ".pem", ".key", ".p12", ".pfx", ".jks",
  ".env", ".secret", ".credential",
];

// Path traversal patterns
const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//g,
  /\.\.%2[fF]/g,
  /\.\.\\/g,
  /%2[eE]%2[eE]%2[fF]/g,
];

// Dangerous URL patterns
const DANGEROUS_URL_PATTERNS = [
  { pattern: /^https?:\/\/(?:10\.\d|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|127\.0\.0\.|localhost|0\.0\.0\.0)/i, reason: "Internal/private IP" },
  { pattern: /^https?:\/\/169\.254\.169\.254/i, reason: "AWS metadata endpoint (SSRF)" },
  { pattern: /^http:\/\//i, reason: "Non-HTTPS URL" },
  { pattern: /[;|`$()]/, reason: "Shell metacharacters in URL" },
];

function checkPath(pathStr: string): { allowed: boolean; reason: string } {
  for (const pat of PATH_TRAVERSAL_PATTERNS) {
    pat.lastIndex = 0;
    if (pat.test(pathStr)) {
      return { allowed: false, reason: "Path traversal detected" };
    }
  }
  const lower = pathStr.toLowerCase();
  for (const denied of DENIED_PATHS) {
    if (lower.includes(denied.toLowerCase())) {
      return { allowed: false, reason: `Denied path: ${denied}` };
    }
  }
  for (const denied of DENIED_FILES) {
    if (lower.endsWith(denied.toLowerCase()) || lower.includes(`/${denied.toLowerCase()}`)) {
      return { allowed: false, reason: `Denied file: ${denied}` };
    }
  }
  for (const ext of DENIED_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return { allowed: false, reason: `Denied extension: ${ext}` };
    }
  }
  return { allowed: true, reason: "Path is allowed" };
}

function checkUrl(url: string): { allowed: boolean; reason: string } {
  for (const { pattern, reason } of DANGEROUS_URL_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(url)) {
      return { allowed: false, reason };
    }
  }
  return { allowed: true, reason: "URL is allowed" };
}

// Gather rule categories from shield rules
function getRuleCatalog(): Array<{ rule: string; desc: string; status: string; sev: string; category: string }> {
  const categories = new Map<string, { count: number; severities: Set<string> }>();
  for (const r of ALL_RULES) {
    if (!categories.has(r.category)) {
      categories.set(r.category, { count: 0, severities: new Set() });
    }
    const cat = categories.get(r.category)!;
    cat.count++;
    cat.severities.add(r.severity);
  }

  return [
    { rule: "PATH-001", desc: "Block path traversal (../)", status: "active", sev: "CRITICAL", category: "path_guard" },
    { rule: "PATH-002", desc: "Block sensitive file access", status: "active", sev: "CRITICAL", category: "path_guard" },
    { rule: "URL-001", desc: "Block non-HTTPS URLs", status: "active", sev: "HIGH", category: "url_safety" },
    { rule: "URL-002", desc: "Block internal IP access (SSRF)", status: "active", sev: "HIGH", category: "url_safety" },
    { rule: "NET-001", desc: "Egress domain allowlist", status: "active", sev: "MEDIUM", category: "network" },
    { rule: "FS-001", desc: "File boundary enforcement", status: "active", sev: "HIGH", category: "filesystem" },
    ...Array.from(categories.entries()).map(([cat, data], i) => ({
      rule: `SHD-${String(i + 1).padStart(3, "0")}`,
      desc: `Shield: ${cat} (${data.count} rules)`,
      status: "active",
      sev: data.severities.has("CRITICAL") ? "CRITICAL" : data.severities.has("HIGH") ? "HIGH" : "MEDIUM",
      category: cat,
    })),
  ];
}

export async function GET(request: NextRequest) {
  if (isRbacEnabled()) {
    const auth = requireSession(request);
    if (auth instanceof NextResponse) return auth;
    const perm = requirePermission(auth.operator, 'access_lists:read');
    if (perm) return perm;
  } else {
    const guard = requireLocalhost(request);
    if (guard) return guard;
  }

  try {
    const { searchParams } = new URL(request.url);
    const pathToCheck = searchParams.get("checkPath");
    const urlToCheck = searchParams.get("checkUrl");

    const response: Record<string, unknown> = {
      deniedFiles: DENIED_FILES,
      deniedPaths: DENIED_PATHS,
      deniedExtensions: DENIED_EXTENSIONS,
      ruleCatalog: getRuleCatalog(),
      totalShieldRules: ALL_RULES.length,
    };

    if (pathToCheck) {
      response.pathCheck = { path: pathToCheck, ...checkPath(pathToCheck) };
    }

    if (urlToCheck) {
      response.urlCheck = { url: urlToCheck, ...checkUrl(urlToCheck) };
    }

    return NextResponse.json(response);
  } catch (err) {
    console.error("[API /access-control] Error:", err);
    return NextResponse.json({ error: "Failed to fetch access control data" }, { status: 500 });
  }
}
