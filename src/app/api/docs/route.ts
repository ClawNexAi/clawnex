import { NextRequest, NextResponse } from "next/server";
import { isRbacEnabled, requireSession, requirePermission } from '@/lib/rbac/guard';
import { requireLocalhost } from '@/lib/middleware/localhost-guard';
import fs from "fs";
import path from "path";

const DOCS_DIR = path.join(process.cwd(), "docs");
const ROOT_DIR = process.cwd();

// These four operator-facing docs live at the repository root, not under
// docs/. They are whitelisted in ALLOWED_DOCS but must be read from ROOT_DIR,
// otherwise the Help → Documentation cards for them 404.
const ROOT_DOCS = new Set([
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "SUPPORT.md",
]);

// Operator-facing and governance-facing docs.
// Internal architecture / planning docs are held back by design.
// Paths are relative to DOCS_DIR. Subdirectory paths (e.g. policies/01-*.md)
// are permitted only for entries in this whitelist; no traversal is allowed.
const ALLOWED_DOCS = new Set([
  // Operator-facing manuals and release notes
  "06-basic-user-manual.md",
  "07-advanced-user-manual.md",
  "17-troubleshooting-guide.md",
  "10-api-reference.md",
  "14-data-dictionary.md",
  "19-api-mcp-integration-guide.md",
  "13-release-notes.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "SUPPORT.md",

  // Governance — overview / summaries
  "governance-index.md",
  "governance-one-pager.md",
  "policy-evidence-checklist.md",

  // Governance — policies
  "policies/README.md",
  "policies/01-information-security-policy.md",
  "policies/02-access-control-policy.md",
  "policies/03-incident-response-policy.md",
  "policies/04-change-management-policy.md",
  "policies/05-vendor-third-party-risk-policy.md",
  "policies/06-risk-management-policy.md",
  "policies/07-secure-sdlc-policy.md",
  "policies/08-data-classification-policy.md",
  "policies/09-data-retention-and-disposal-policy.md",
  "policies/10-bcp-dr-policy.md",
  "policies/11-cryptographic-controls-policy.md",
  "policies/12-asset-management-policy.md",
  "policies/13-vulnerability-management-policy.md",
  "policies/14-acceptable-use-policy.md",

  // Governance — registers
  "registers/risk-register.md",
  "registers/vendor-inventory-register.md",
]);

// Only allow reading whitelisted .md entries. Subdirectory paths are
// permitted when present in the whitelist; traversal (".."), absolute
// paths, and NUL bytes are rejected.
function sanitizeFilename(raw: string): string | null {
  if (!raw) return null;
  if (raw.includes("\0")) return null;
  if (raw.includes("..")) return null;
  // Normalize Windows-style separators, strip any leading slash.
  const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized.endsWith(".md")) return null;
  if (!ALLOWED_DOCS.has(normalized)) return null;
  return normalized;
}

/**
 * GET /api/docs?file=06-basic-user-manual.md — returns raw markdown content.
 * GET /api/docs — returns list of available doc files (whitelist, sorted).
 */
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

  const file = request.nextUrl.searchParams.get("file");

  // No file param = list available docs (whitelist-backed; subdir paths supported).
  if (!file) {
    const files = Array.from(ALLOWED_DOCS).sort();
    return NextResponse.json({ files });
  }

  const safeName = sanitizeFilename(file);
  if (!safeName) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const baseDir = ROOT_DOCS.has(safeName) ? ROOT_DIR : DOCS_DIR;
  const filePath = path.join(baseDir, safeName);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: `File not found: ${safeName}` }, { status: 404 });
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return NextResponse.json({ file: safeName, content });
  } catch {
    return NextResponse.json({ error: "Failed to read file" }, { status: 500 });
  }
}
