/**
 * phase6-producers.ts
 *
 * Five upstream row producers for the dispatch-ready triage families:
 *
 *   - update-cve       — one ActionRow per CVE record (top-10 by CVSS).
 *   - auth-rbac        — RBAC-off + overprovisioned-role detector.
 *   - blast-radius     — top-3 most-recent CRIT alerts → blast graph.
 *   - policy-warning   — low-confidence + stale Shield-rule scanner.
 *   - correlation      — multi-source signals sharing a session_id within 10m.
 *
 * Each producer:
 *   - reads already-fetched dashboard data (no new server routes),
 *   - caps its output (top-N) so the queue can't be flooded,
 *   - returns ActionRow[] whose rawSource.kind matches a Phase 5 resolver,
 *   - emits zero rows when its data isn't available (best-effort v1).
 *
 * Pure: no I/O, no fetch, no side effects. Imported by ActionQueue.tsx for
 * runtime composition AND by scripts/verify-phase6-producers.ts for hermetic
 * testing without spinning up React.
 *
 * Verb-led copy uses the canonical 11-verb taxonomy from types.ts —
 * scripts/verify-action-verbs.ts catches drift.
 */

import { computeActionPriority } from "./scoring";
import type {
  ActionRow,
  EvidenceConfidence,
  IncidentFamily,
  Severity,
  SuggestedAction,
} from "./types";
import type {
  CveRecord,
  AuthScanData,
  ShieldRuleSummary,
  ActiveAlert,
  TrustAuditFinding,
  DegradedState,
  DegradedReason,
  InstalledVersionsData,
} from "./data-hooks";
import type { CorrelationFinding } from "../../triage/correlation-resolver";
import type { BlastRadiusFinding } from "../../triage/blast-radius-resolver";
import type { AuthRbacFinding } from "../../triage/auth-rbac-resolver";
import type { UpdateCveFinding } from "../../triage/update-cve-resolver";
import type { PolicyWarningFinding } from "../../triage/policy-warning-resolver";

// ---------------------------------------------------------------------------
// Operator + permission helper — mirror of ActionQueue.tsx (client copy of
// the RBAC role matrix). Authoritative enforcement is server-side.
// ---------------------------------------------------------------------------

export interface Operator {
  username: string;
  role: string;
  displayName?: string;
}

const ROLE_PERMS: Record<string, ReadonlySet<string>> = {
  admin: new Set([
    "dashboard:view", "audit:read", "tokens:read", "infrastructure:read",
    "alerts:read", "policies:read", "system:manage",
  ]),
  security_manager: new Set([
    "dashboard:view", "audit:read", "tokens:read",
    "alerts:read", "policies:read",
  ]),
  operator: new Set([
    "dashboard:view", "audit:read", "tokens:read",
    "alerts:read", "policies:read",
  ]),
  viewer: new Set([
    "dashboard:view", "alerts:read", "tokens:read", "policies:read",
  ]),
  auditor: new Set([
    "dashboard:view", "audit:read", "tokens:read",
  ]),
};

function hasPerm(op: Operator | undefined, perm: string): boolean {
  if (!op) return true;
  return (ROLE_PERMS[op.role] ?? new Set()).has(perm);
}

// ---------------------------------------------------------------------------
// Severity mapper — mirrors mapSeverity in ActionQueue.tsx for the
// correlation detector's alert severity normalization.
// ---------------------------------------------------------------------------

function mapAlertSeverity(raw: string | undefined): Severity {
  switch (raw) {
    case "CRITICAL": return "CRIT";
    case "HIGH":     return "HIGH";
    case "MEDIUM":   return "MED";
    case "LOW":      return "LOW";
    default:         return "WARN";
  }
}

// ---------------------------------------------------------------------------
// Degraded-source banner row — Item 3 polish 2026-05-08
//
// When a Phase 6 producer's data source is unreachable, the producer emits
// ONE banner row (severity WARN, suggestedAction "Diagnose · <family> data
// source", clickTarget configuration tab) instead of silently emitting
// zero. This lets operators distinguish "no findings" from "couldn't read
// source" — the prior behaviour silently degraded to empty arrays.
//
// Banner rows intentionally omit `rawSource` so the dispatch in
// ActionQueue.tsx falls through to the generic action-row resolver.
// We don't add a new "degraded" rawSource kind — the generic resolver's
// "resolver not implemented yet" stages read fine for an informational
// banner, and adding a kind would require new dispatch + new resolver.
// ---------------------------------------------------------------------------

/** Per-family display labels for banner copy. Family is the producer
 *  name, NOT the IncidentFamily taxonomy — we want operators to see
 *  "CVE feed" not "infrastructure". */
const FAMILY_LABELS: Record<string, string> = {
  "update-cve":     "CVE feed",
  "auth-rbac":      "Auth scan",
  "policy-warning": "Shield rules",
};

/** Per-reason copy snippet. Drives the banner's title + action.detail. */
const REASON_COPY: Record<DegradedReason, { titleSuffix: string; detail: string }> = {
  "auth": {
    titleSuffix: "auth required, sign back in",
    detail: "Auth required",
  },
  "unreachable": {
    titleSuffix: "endpoint unreachable, check connectivity",
    detail: "Endpoint unreachable",
  },
  "missing-endpoint": {
    titleSuffix: "endpoint not configured on this instance",
    detail: "Missing endpoint",
  },
};

/** Build a single degraded-source banner row.
 *
 *  Returned as an `ActionRow` like any other queue row, with WARN
 *  severity (operators should notice, not be alarmed) and verb
 *  "Diagnose" (canonical taxonomy entry for "source degraded; first
 *  job is determining the operational cause"). `rawSource` is omitted
 *  so the dispatch falls through to the generic action-row resolver. */
function degradedBannerRow(
  family: "update-cve" | "auth-rbac" | "policy-warning",
  degraded: DegradedState,
): ActionRow {
  const label = FAMILY_LABELS[family] ?? family;
  const copy = REASON_COPY[degraded.reason];
  const incidentType = "data-source-degraded";
  return {
    id: `${family}-source-degraded`,
    severity: "WARN" as Severity,
    title: `${label} unreachable — ${copy.titleSuffix}`,
    source: `${family}-source-degraded`,
    evidence: { kind: "fallback", label: "Best match — fallback by session + ±60s" } as EvidenceConfidence,
    ageMs: 0,
    suggestedAction: {
      verb: "Diagnose",
      target: `${family} data source`,
      detail: copy.detail,
    } as SuggestedAction,
    buttonLabel: "Diagnose ▸",
    // configuration tab focuses on data source health; the focus key is
    // a soft hint for the configuration panel — unrecognised values
    // are tolerated by the navigation layer.
    clickTarget: { tab: "configuration", opts: { focus: "data-sources" } },
    // Operators should see degraded-source banners regardless of perm
    // — knowing the source is down is itself the actionable signal.
    restricted: false,
    priorityScore: computeActionPriority({ severity: "WARN", ageMs: 0, evidenceKind: "fallback" }),
    family: "infrastructure" as IncidentFamily,
    incidentType,
    // Intentional: no rawSource → falls through to generic action-row
    // resolver. No new "degraded" kind dispatch (per brief constraint).
  };
}

// ---------------------------------------------------------------------------
// Installed-version helper — Item 1 polish 2026-05-08
//
// When a CVE's packageName matches a known component (ClawNex itself,
// the colocated OpenClaw install) we surface the real installed version
// in the row's previewField + Affected Object / Fix-Control summary.
// Previously every row carried the placeholder "installed" which read
// poorly ("lodash at installed across the install" / "OpenClaw at
// installed → 2026.4.10").
//
// Lookup is case-insensitive against the package-token portion of the
// CVE title. Pure: takes already-fetched InstalledVersionsData.
// Returns undefined for unknown packages — the resolver conditions on
// falsy currentVersion and renders package-only copy without the
// "→ fixedVersion" arrow on the current side.
// ---------------------------------------------------------------------------

function getInstalledVersion(
  packageName: string,
  versions: InstalledVersionsData | null,
): string | undefined {
  if (!versions) return undefined;
  const lower = packageName.toLowerCase();
  // ClawNex aliases — exact "clawnex" or self-reference "self".
  if (lower === "clawnex" || lower === "self") {
    return versions.clawnex ?? undefined;
  }
  // OpenClaw aliases — exact, multi-package "OpenClaw/Clawdbot",
  // any starts-with "openclaw" form. Multi-package preservation:
  // extractCveCopy keeps "OpenClaw/Clawdbot" intact; the full token is
  // passed to this helper, so we lower + startsWith to match either
  // bare "openclaw" or the slash form.
  if (lower === "openclaw" || lower === "openclaw/clawdbot" || lower.startsWith("openclaw")) {
    return versions.openclaw ?? undefined;
  }
  // Unknown package — leave undefined; resolver renders package-only.
  return undefined;
}

function parseJsonStringArray(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** Compare calendar/semver-like versions without coercing 2026.5.10 into a
 * decimal number. Numeric identifiers sort numerically; prereleases sort
 * before the corresponding stable release. */
export function compareCveVersions(left: string, right: string): number {
  const tokenize = (value: string): Array<number | string> => value
    .trim()
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .filter(Boolean)
    .map((part) => /^\d+$/.test(part) ? Number(part) : part.toLowerCase());
  const a = tokenize(left);
  const b = tokenize(right);
  const stableLength = Math.max(3, Math.min(a.length, b.length));
  const max = Math.max(a.length, b.length, stableLength);
  for (let i = 0; i < max; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === bv) continue;
    // Missing numeric core identifiers behave as zero. Missing prerelease
    // identifiers mean the version is stable, which sorts after prerelease.
    if (av === undefined) {
      if (typeof bv === "number" && bv === 0) continue;
      return typeof bv === "number" ? -1 : 1;
    }
    if (bv === undefined) {
      if (typeof av === "number" && av === 0) continue;
      return typeof av === "number" ? 1 : -1;
    }
    if (typeof av === "number" && typeof bv === "number") return av < bv ? -1 : 1;
    if (typeof av === "number") return -1;
    if (typeof bv === "number") return 1;
    return av < bv ? -1 : 1;
  }
  return 0;
}

function comparatorMatches(version: string, comparator: string): boolean {
  const match = comparator.trim().match(/^(<=|>=|<|>|=)?\s*v?([0-9][0-9A-Za-z.+-]*)$/);
  if (!match) return false;
  const relation = compareCveVersions(version, match[2]);
  switch (match[1] || "=") {
    case "<": return relation < 0;
    case "<=": return relation <= 0;
    case ">": return relation > 0;
    case ">=": return relation >= 0;
    default: return relation === 0;
  }
}

/** GHSA ranges are stored as JSON strings such as
 * ["< 2026.5.26"] or [">= 2026.1.20, < 2026.2.1"]. Entries are ORed;
 * comma-separated comparators inside one entry are ANDed. */
export function isVersionAffected(version: string, encodedRanges: string | undefined): boolean {
  return parseJsonStringArray(encodedRanges).some((range) => {
    const comparators = range.split(",").map((part) => part.trim()).filter(Boolean);
    return comparators.length > 0 && comparators.every((part) => comparatorMatches(version, part));
  });
}

function cveAppliesToInstalledComponent(cve: CveRecord, installedVersions: InstalledVersionsData | null): boolean {
  const { packageName } = extractCveCopy(cve);
  const currentVersion = getInstalledVersion(packageName, installedVersions);
  if (!currentVersion) return false;

  const packages = parseJsonStringArray(cve.packages).map((name) => name.toLowerCase());
  const lowerPackage = packageName.toLowerCase();
  const targetsOpenClaw = lowerPackage.startsWith("openclaw")
    || packages.some((name) => name.endsWith("/openclaw") || name.endsWith("/clawdbot"));
  const targetsClawNex = lowerPackage === "clawnex"
    || packages.some((name) => name.endsWith("/clawnex"));
  if (!targetsOpenClaw && !targetsClawNex) return false;

  return isVersionAffected(currentVersion, cve.affected_versions);
}

// ---------------------------------------------------------------------------
// Family 1 — update-cve
// ---------------------------------------------------------------------------

function cveSeverityToActionSeverity(s: string | undefined): Severity {
  switch ((s ?? "").toUpperCase()) {
    case "CRITICAL": return "CRIT";
    case "HIGH":     return "HIGH";
    case "MEDIUM":   return "MED";
    case "LOW":      return "LOW";
    default:         return "WARN";
  }
}

/**
 * Derive (packageName, fixedVersion) from a CVE record.
 *
 * The CVE feed has been observed in three shapes, all of which need to land
 * as readable "Update policy · <package> → <version>" copy:
 *
 *   1. Title carries package context — pattern "<Package> < <version> - <desc>"
 *      (the GHSA / OpenClaw feed shape seen on staging). fixed_version is just
 *      the bare version like "2026.3.13".
 *   2. fixed_version carries embedded package — "<package> <version>" (the
 *      legacy demo-data shape, e.g. "api-gateway 4.2.1").
 *   3. Anything else — fall back to title's first word.
 *
 * internal reviewer 2026-05-08 flagged a regression where shape #1 was being parsed as
 * if it were shape #2, producing copy like "Update policy · 2026.4.10" with
 * the version mistakenly rendered as the package name. This rewrite tries
 * shape #1 first, then #2, then the fallback — matches all three.
 */
function extractCveCopy(cve: { title?: string; fixed_version?: string }): { packageName: string; fixedVersion: string | undefined } {
  const title = cve.title ?? "";
  const fixed = cve.fixed_version ?? "";

  // Strip trailing non-word punctuation from a captured package token so
  // the row reads "OpenClaw → 2026.4.14" instead of "OpenClaw: → 2026.4.14"
  // when the CVE title is "OpenClaw: subsys < 2026.4.14 - desc". internal reviewer
  // 2026-05-08 polish — leaves embedded slashes / dashes / dots in place,
  // only trims trailing punctuation. Multi-package "OpenClaw/Clawdbot" is
  // preserved.
  const trimTail = (s: string) => s.replace(/[^\w]+$/, "") || s;

  // Shape #1: title pattern "<Package> < <vulnerable-version>". The cutoff
  // version in the title is typically the same as fixed_version, so we use
  // fixed_version (or the matched version) as the upgrade target.
  const ltMatch = title.match(/^([^\s<]+)\s*<\s*([\d][\w.+\-]*)/);
  if (ltMatch) {
    return {
      packageName: trimTail(ltMatch[1]),
      fixedVersion: fixed || ltMatch[2] || undefined,
    };
  }

  // Shape #2: fixed_version with embedded package, e.g. "api-gateway 4.2.1".
  // Heuristic: split on last space ONLY when the right-hand side looks like
  // a version (digits + dots/dashes). Otherwise it's likely a bare version.
  if (fixed) {
    const lastSpace = fixed.lastIndexOf(" ");
    if (lastSpace > 0) {
      const tail = fixed.slice(lastSpace + 1).trim();
      const looksLikeVersion = /^\d[\w.+\-]*$/.test(tail);
      if (looksLikeVersion) {
        return {
          packageName: trimTail(fixed.slice(0, lastSpace).trim()),
          fixedVersion: tail,
        };
      }
    }
    // Bare version (no space) or non-version tail — fall back to title's
    // first word for package context.
    const titleFirst = title.split(/\s+/)[0] || "unknown";
    return { packageName: trimTail(titleFirst), fixedVersion: fixed };
  }

  // No useful info anywhere — degrade gracefully.
  return {
    packageName: trimTail(title.split(/\s+/)[0] || "unknown"),
    fixedVersion: undefined,
  };
}

/** One row per CVE record, capped to top 10 by CVSS.
 *
 *  Item 1 (2026-05-08): when packageName matches ClawNex / OpenClaw, we
 *  populate `UpdateCveFinding.currentVersion` with the real installed
 *  version from /api/system/version (passed in as `installedVersions`)
 *  instead of the bare "installed" placeholder. Unknown packages leave
 *  currentVersion undefined → resolver renders package-only copy.
 *
 *  Item 3 (2026-05-08): when the CVE feed is unreachable, returns a
 *  single banner row instead of silently emitting zero. The producer
 *  reads `degraded` from useCveData()'s payload — non-undefined means
 *  the source is down. */
export function cveToRows(
  cves: CveRecord[],
  installedVersions: InstalledVersionsData | null,
  degraded: DegradedState | undefined,
  operator: Operator | undefined,
): ActionRow[] {
  // Item 3: degraded short-circuit — emit one banner, skip normal flow.
  if (degraded) return [degradedBannerRow("update-cve", degraded)];

  if (!Array.isArray(cves) || cves.length === 0) return [];
  // The CVE feed is an advisory catalogue, not a finding list. Only emit an
  // action when the installed component is known and its version satisfies a
  // published affected range. Unknown/unparseable records stay visible in the
  // Security Posture catalogue but must never become upgrade instructions.
  const top = cves
    .filter((cve) => cveAppliesToInstalledComponent(cve, installedVersions))
    .sort((a, b) => {
      const av = a.cvss ?? 0;
      const bv = b.cvss ?? 0;
      if (av !== bv) return bv - av;
      return (a.cve_id ?? "").localeCompare(b.cve_id ?? "");
    })
    .slice(0, 10);

  return top.map((cve) => {
    const sev = cveSeverityToActionSeverity(cve.severity);
    const { packageName, fixedVersion } = extractCveCopy(cve);
    const fullTitle = `${cve.cve_id}: ${cve.title ?? ""}`.trim();
    const title = fullTitle.length > 80 ? fullTitle.slice(0, 79) + "…" : fullTitle;
    const target = fixedVersion ? `${packageName} → ${fixedVersion}` : packageName;
    const ageMs = 0;
    const restricted = !hasPerm(operator, "alerts:read");
    // Item 1: resolve currentVersion only for known components. Unknown
    // packages → undefined → resolver renders without the version arrow.
    const currentVersion = getInstalledVersion(packageName, installedVersions);

    const finding: UpdateCveFinding = {
      id: `cve-${cve.cve_id}`,
      title,
      severity: sev,
      packageName,
      currentVersion,
      fixedVersion,
      cveIds: [cve.cve_id],
      cveScore: cve.cvss ?? undefined,
    };

    return {
      id: `cve-${cve.cve_id}`,
      severity: sev,
      title,
      source: "cve-database",
      evidence: { kind: "exact", label: "Exact (audit_event_id)" } as EvidenceConfidence,
      ageMs,
      suggestedAction: { verb: "Update policy", target, detail: cve.cve_id } as SuggestedAction,
      buttonLabel: "Update policy ▸",
      clickTarget: { tab: "securityPosture", opts: { focus: cve.cve_id } },
      restricted,
      priorityScore: computeActionPriority({ severity: sev, ageMs, evidenceKind: "exact" }),
      family: "infrastructure" as const,
      incidentType: "cve-update",
      rawSource: { kind: "update-cve", finding } as ActionRow["rawSource"],
    };
  });
}

// ---------------------------------------------------------------------------
// Family 2 — auth-rbac
// ---------------------------------------------------------------------------

/** RBAC scan: rbac_off + overprovisioned_role detectors. Capped to 5.
 *
 *  Item 3 (2026-05-08): when /api/auth/status is unreachable, returns a
 *  single banner row. We surface degraded only when the canonical RBAC
 *  probe (auth/status) fails — operators[] empty alone is the expected
 *  shape for non-admin operators (route is admin-only). The hook does
 *  the discrimination; this producer just trusts data.degraded. */
export function authRbacScan(data: AuthScanData | null, operator: Operator | undefined): ActionRow[] {
  // Item 3: degraded short-circuit — emit one banner, skip normal flow.
  if (data?.degraded) return [degradedBannerRow("auth-rbac", data.degraded)];

  if (!data) return [];
  const out: ActionRow[] = [];
  const restricted = !hasPerm(operator, "system:manage");

  if (data.rbacEnabled === false) {
    const finding: AuthRbacFinding = {
      id: "rbac-off",
      title: "RBAC is disabled",
      severity: "CRIT",
      kind: "rbac_off",
      evidence: ["config.rbac.enabled === false"],
    };
    out.push({
      id: "auth-rbac-off",
      severity: "CRIT",
      title: "RBAC is disabled — all routes default-allow",
      source: "auth-rbac",
      evidence: { kind: "exact", label: "Exact (audit_event_id)" } as EvidenceConfidence,
      ageMs: 0,
      suggestedAction: { verb: "Restrict capability", target: "RBAC", detail: "Enable RBAC in /api/config/defaults" } as SuggestedAction,
      buttonLabel: "Restrict capability ▸",
      clickTarget: { tab: "accessControl" },
      restricted,
      priorityScore: computeActionPriority({ severity: "CRIT", ageMs: 0, evidenceKind: "exact" }),
      family: "trust-audit" as const,
      incidentType: "rbac-rbac_off",
      rawSource: { kind: "auth-rbac", finding } as ActionRow["rawSource"],
    });
  }

  if (data.rbacEnabled && Array.isArray(data.operators)) {
    const activeAdmins = data.operators.filter((o) => o.role === "admin" && o.is_active === 1);
    if (activeAdmins.length === 1) {
      const admin = activeAdmins[0];
      const finding: AuthRbacFinding = {
        id: `auth-rbac-overprov-${admin.id}`,
        title: `Single admin account "${admin.username}"`,
        severity: "HIGH",
        kind: "overprovisioned_role",
        principal: admin.username,
        evidence: ["only one active admin operator"],
      };
      out.push({
        id: `auth-rbac-overprov-${admin.id}`,
        severity: "HIGH",
        title: `Sole admin account: ${admin.username}`,
        source: "auth-rbac",
        evidence: { kind: "fallback", label: "Best match — fallback by session + ±60s" } as EvidenceConfidence,
        ageMs: 0,
        suggestedAction: { verb: "Restrict capability", target: "admin role", detail: "Add second admin or downscope" } as SuggestedAction,
        buttonLabel: "Restrict capability ▸",
        clickTarget: { tab: "accessControl" },
        restricted,
        priorityScore: computeActionPriority({ severity: "HIGH", ageMs: 0, evidenceKind: "fallback" }),
        family: "trust-audit" as const,
        incidentType: "rbac-overprovisioned_role",
        rawSource: { kind: "auth-rbac", finding } as ActionRow["rawSource"],
      });
    }
  }

  return out.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Family 3 — blast-radius
// ---------------------------------------------------------------------------

// Item 2 (2026-05-08): widen the propagation-vector heuristic beyond
// shared_session_template. The original implementation marked
// `vector: "shared_session_template"` whenever ≥2 alerts shared a session
// id and "unknown" otherwise — too coarse to drive the resolver's
// vector-driven Fix-Control verb (Rotate credential / Restrict capability /
// Contain agent). The new derivation runs four detectors in priority order:
//
//   1. shared_credential — alert titles/descriptions contain credential
//      keywords AND alerts share session. Highest priority because a
//      leaked secret is the highest-stakes containment problem.
//   2. shared_tool — alert titles share a tool/connector token. Drives
//      "Restrict capability" — narrowing the tool grant.
//   3. shared_policy — multiple shield-source alerts share a rule-key
//      prefix. Drives "Update policy".
//   4. shared_session_template — original behaviour: alerts share session
//      id (no other markers). Lowest priority among matched vectors.
//   5. unknown — no marker matches; the today's default.
//
// Hardcoded keyword lists per the operator's no-premature-abstraction rule. The
// shape is small enough (5–10 strings each) that a config file would be
// over-engineering for v1.1.

const CREDENTIAL_KEYWORDS = [
  "auth", "token", "credential", "secret", "key",
  "password", "apikey", "bearer",
] as const;

/** Tool/connector tokens for shared_tool detection. Sourced from the
 *  trust-audit surfaceId taxonomy + common integrations. Operator-visible
 *  patterns, lowercased for substring match. */
const TOOL_TOKENS = [
  "discord", "slack", "telegram", "github", "openclaw",
  "litellm", "claude", "openai",
] as const;

/** Shield rule-key prefixes from src/lib/shield/rules.ts. Hardcoded
 *  here rather than imported — the rules file is large and we only
 *  need the prefix taxonomy (10 prefixes), not the rule definitions.
 *  Kept in sync with rules.ts manually; verify-action-verbs would catch
 *  drift if a new prefix landed and we cared about it here. */
const SHIELD_RULE_PREFIXES = [
  "C2", "CMD", "COG", "ENC", "FIN",
  "JAIL", "PATH", "SEC", "STEG", "TRUST",
] as const;

/** Combined searchable text from an alert — title + any description-ish
 *  field. Lowercase for keyword matching. */
function alertText(a: ActiveAlert): string {
  return `${a.title ?? ""} ${a.source ?? ""}`.toLowerCase();
}

/** Return the first SHIELD_RULE_PREFIXES match in the alert title (e.g.
 *  "CMD-EXEC-EVAL", "JAIL-PLINY-OP-X" → "CMD" / "JAIL"), or null when no
 *  prefix matches. Case-insensitive on the title; prefix taxonomy is
 *  uppercase. */
function shieldRulePrefix(a: ActiveAlert): string | null {
  const title = (a.title ?? "").toUpperCase();
  for (const p of SHIELD_RULE_PREFIXES) {
    // Match "<PREFIX>-" at start or after non-word boundary so "ENC-..."
    // matches but "ENCRYPTED" doesn't.
    const re = new RegExp(`(^|\\W)${p}-`);
    if (re.test(title)) return p;
  }
  return null;
}

/** Item 2: derive a propagation vector from a cluster of alerts that
 *  already share a session id. Runs detectors in priority order
 *  (credential → tool → policy → session_template) and returns the
 *  first match, or "unknown" if no detector fires.
 *
 *  Pure: no I/O. Public for verifier coverage in
 *  scripts/verify-phase6-producers.ts. */
export function deriveBlastVector(alerts: ActiveAlert[]): BlastRadiusFinding["vector"] {
  if (!Array.isArray(alerts) || alerts.length === 0) return "unknown";

  // 1. shared_credential — any alert text matches a credential keyword.
  for (const a of alerts) {
    const text = alertText(a);
    for (const kw of CREDENTIAL_KEYWORDS) {
      if (text.includes(kw)) return "shared_credential";
    }
  }

  // 2. shared_tool — ≥2 alerts share a tool token (case-insensitive
  //    substring). We require ≥2 to avoid mis-classifying a single
  //    alert that happens to mention "discord" once.
  const toolHits = new Map<string, number>();
  for (const a of alerts) {
    const text = alertText(a);
    for (const tok of TOOL_TOKENS) {
      if (text.includes(tok)) {
        toolHits.set(tok, (toolHits.get(tok) ?? 0) + 1);
      }
    }
  }
  for (const count of Array.from(toolHits.values())) {
    if (count >= 2) return "shared_tool";
  }

  // 3. shared_policy — ≥2 shield-source alerts share a rule-key prefix.
  //    "shield-source" is anything where alert.source contains "shield"
  //    OR the title carries a SHIELD_RULE_PREFIX (the title is set by
  //    the shield rule's `title` field on match).
  const prefixHits = new Map<string, number>();
  for (const a of alerts) {
    const isShield =
      (a.source ?? "").toLowerCase().includes("shield") ||
      shieldRulePrefix(a) !== null;
    if (!isShield) continue;
    const prefix = shieldRulePrefix(a);
    if (prefix) prefixHits.set(prefix, (prefixHits.get(prefix) ?? 0) + 1);
  }
  for (const count of Array.from(prefixHits.values())) {
    if (count >= 2) return "shared_policy";
  }

  // 4. shared_session_template — at least 2 alerts share a session id.
  //    This is the original behaviour for the unknown-vector clusters.
  //    Caller already filters to alerts that share a session, so we
  //    only need to confirm ≥2 affected.
  if (alerts.length >= 2) return "shared_session_template";

  return "unknown";
}

/** Take top-3 most-recent CRIT alerts; compute blast-radius vector via
 *  deriveBlastVector (Item 2 polish 2026-05-08 — was previously a binary
 *  shared_session_template / unknown). */
export function blastRadiusFromAlerts(alerts: ActiveAlert[], operator: Operator | undefined): ActionRow[] {
  if (!Array.isArray(alerts) || alerts.length === 0) return [];

  const crits = alerts
    .filter((a) => (a.severity ?? "").toUpperCase() === "CRITICAL")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 3);

  if (crits.length === 0) return [];

  const restricted = !hasPerm(operator, "alerts:read");
  const now = Date.now();
  const WINDOW_MS = 24 * 3600_000;

  return crits.map((root) => {
    const rootCreated = new Date(root.created_at).getTime();
    const rootSession = (root as unknown as { session_id?: string }).session_id;

    // Build the affected-alerts cluster (root + same-session siblings within
    // the 24h window). Vector derivation runs over this cluster.
    const cluster: ActiveAlert[] = [root];
    const affected = new Set<string>();
    if (rootSession) affected.add(rootSession);
    for (const sib of alerts) {
      if (sib.id === root.id) continue;
      const sibCreated = new Date(sib.created_at).getTime();
      if (Math.abs(now - sibCreated) > WINDOW_MS) continue;
      const sibSession = (sib as unknown as { session_id?: string }).session_id;
      if (sibSession && sibSession === rootSession) {
        affected.add(sibSession);
        cluster.push(sib);
      }
    }
    const affectedSessionIds = Array.from(affected);
    const affectedCount = affectedSessionIds.length;

    // Item 2: derive vector from the full cluster (root + siblings).
    // When the cluster is just the root alone, deriveBlastVector still
    // checks the keywords on the single alert — a single CRIT mentioning
    // "credential" gets shared_credential rather than unknown, which
    // matches operator intent (credential exposure is the headline
    // regardless of how many siblings share the session).
    const vector: BlastRadiusFinding["vector"] = deriveBlastVector(cluster);

    const sev: Severity = "CRIT";
    const ageMs = Math.max(0, now - rootCreated);

    const finding: BlastRadiusFinding = {
      id: `blast-${root.id}`,
      title: `Blast radius for "${root.title ?? "alert"}"`,
      severity: sev,
      rootSignalId: root.id,
      rootSignalKind: "alert",
      affectedSessionIds,
      vector,
      windowStartMs: rootCreated,
      windowEndMs: now,
      evidence: rootSession ? [`shared session: ${rootSession}`] : undefined,
    };

    return {
      id: `blast-${root.id}`,
      severity: sev,
      title: `Blast radius for ${root.title ?? "alert"}: ${affectedCount} affected`,
      source: "blast-radius",
      evidence: { kind: "fallback", label: "Best match — fallback by session + ±60s" } as EvidenceConfidence,
      ageMs,
      suggestedAction: { verb: "Diagnose", target: "blast graph", detail: `${affectedCount} session${affectedCount === 1 ? "" : "s"}` } as SuggestedAction,
      buttonLabel: "Diagnose ▸",
      clickTarget: { tab: "agents" },
      restricted,
      priorityScore: computeActionPriority({ severity: sev, ageMs, evidenceKind: "fallback" }),
      family: "alert" as const,
      incidentType: "blast-radius",
      rawSource: { kind: "blast-radius", finding } as ActionRow["rawSource"],
    };
  });
}

// ---------------------------------------------------------------------------
// Family 4 — policy-warning
// ---------------------------------------------------------------------------

/** Low-confidence + stale Shield-rule scanner. Caps to 5.
 *
 *  Item 3 (2026-05-08): when /api/shield/history is unreachable, returns
 *  a single banner row. The hook's degraded state is passed in alongside
 *  the rules array (which is empty in the degraded case). */
export function policyWarningScan(
  rules: ShieldRuleSummary[] | null,
  degraded: DegradedState | undefined,
  operator: Operator | undefined,
): ActionRow[] {
  // Item 3: degraded short-circuit — emit one banner, skip normal flow.
  if (degraded) return [degradedBannerRow("policy-warning", degraded)];

  if (!Array.isArray(rules) || rules.length === 0) return [];

  const restricted = !hasPerm(operator, "policies:read");
  const STALE_MS = 30 * 86400_000;
  const now = Date.now();
  const out: ActionRow[] = [];

  for (const r of rules) {
    if (r.firingCount >= 3 && r.avgConfidence > 0 && r.avgConfidence < 0.4) {
      const finding: PolicyWarningFinding = {
        id: `policy-lowconf-${r.ruleKey}`,
        title: `Rule "${r.ruleKey}" low-confidence`,
        severity: "WARN",
        ruleKey: r.ruleKey,
        scope: "shield_rule",
        recentFiringCount: r.firingCount,
        evidence: [`avg confidence ${r.avgConfidence.toFixed(2)} over ${r.firingCount} firings`],
      };
      out.push({
        id: `policy-lowconf-${r.ruleKey}`,
        severity: "WARN",
        title: `Rule '${r.ruleKey}' low-confidence`,
        source: "policy-warning",
        evidence: { kind: "fallback", label: "Best match — fallback by session + ±60s" } as EvidenceConfidence,
        ageMs: 0,
        suggestedAction: { verb: "Update policy", target: r.ruleKey, detail: "low-confidence" } as SuggestedAction,
        buttonLabel: "Update policy ▸",
        clickTarget: { tab: "shield", opts: { focus: r.ruleKey } },
        restricted,
        priorityScore: computeActionPriority({ severity: "WARN", ageMs: 0, evidenceKind: "fallback" }),
        family: "trust-audit" as const,
        incidentType: "policy-low-confidence",
        rawSource: { kind: "policy-warning", finding } as ActionRow["rawSource"],
      });
    }
    if (r.lastFiredMs !== null && now - r.lastFiredMs > STALE_MS) {
      const finding: PolicyWarningFinding = {
        id: `policy-stale-${r.ruleKey}`,
        title: `Rule "${r.ruleKey}" stale`,
        severity: "WARN",
        ruleKey: r.ruleKey,
        scope: "shield_rule",
        recentFiringCount: r.firingCount,
        evidence: [`last fired ${Math.round((now - r.lastFiredMs) / 86400_000)}d ago`],
      };
      out.push({
        id: `policy-stale-${r.ruleKey}`,
        severity: "WARN",
        title: `Rule '${r.ruleKey}' stale`,
        source: "policy-warning",
        evidence: { kind: "fallback", label: "Best match — fallback by session + ±60s" } as EvidenceConfidence,
        ageMs: 0,
        suggestedAction: { verb: "Update policy", target: r.ruleKey, detail: "stale" } as SuggestedAction,
        buttonLabel: "Update policy ▸",
        clickTarget: { tab: "shield", opts: { focus: r.ruleKey } },
        restricted,
        priorityScore: computeActionPriority({ severity: "WARN", ageMs: 0, evidenceKind: "fallback" }),
        family: "trust-audit" as const,
        incidentType: "policy-stale",
        rawSource: { kind: "policy-warning", finding } as ActionRow["rawSource"],
      });
    }
  }

  return out.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Family 5 — correlation
// ---------------------------------------------------------------------------

/** Detect 2+ signals from different source families sharing a session_id
 *  within a 10-minute window. Caps to top 5 clusters. */
export function correlationDetect(
  alerts: ActiveAlert[],
  signals: Array<{ kind: string; severity?: string; detail?: string }>,
  trustAudit: TrustAuditFinding[],
  operator: Operator | undefined,
  /** Override "now" for hermetic testing. Defaults to Date.now(). */
  nowMs: number = Date.now(),
): ActionRow[] {
  if (!Array.isArray(alerts) || alerts.length === 0) return [];

  const restricted = !hasPerm(operator, "alerts:read");
  const WINDOW_MS = 10 * 60_000;

  type FlatSig = {
    id: string;
    kind: "alert" | "cost-signal" | "trust-audit";
    sessionId: string | null;
    ts: number;
    severity: Severity;
  };
  const flat: FlatSig[] = [];

  for (const a of alerts) {
    const sid = (a as unknown as { session_id?: string }).session_id ?? null;
    const ts = new Date(a.created_at).getTime();
    flat.push({
      id: a.id,
      kind: "alert",
      sessionId: sid,
      ts: Number.isFinite(ts) ? ts : nowMs,
      severity: mapAlertSeverity(a.severity),
    });
  }
  for (let i = 0; i < signals.length; i++) {
    const s = signals[i];
    const detail = s.detail ?? "";
    const m = detail.match(/(?:session|agent)[\s:]+([a-zA-Z0-9_-]+)/i);
    flat.push({
      id: `signal-${s.kind}-${i}`,
      kind: "cost-signal",
      sessionId: m ? m[1] : null,
      ts: nowMs,
      severity: s.severity === "high" ? "HIGH" : "WARN",
    });
  }
  for (const f of trustAudit) {
    flat.push({
      id: `audit-${f.id}`,
      kind: "trust-audit",
      sessionId: f.agentId ?? null,
      ts: nowMs,
      severity:
        f.severity === "critical" ? "CRIT" :
        f.severity === "high"     ? "HIGH" :
        f.severity === "medium"   ? "MED"  : "WARN",
    });
  }

  const bySession = new Map<string, FlatSig[]>();
  for (const sig of flat) {
    if (!sig.sessionId) continue;
    const cur = bySession.get(sig.sessionId) ?? [];
    cur.push(sig);
    bySession.set(sig.sessionId, cur);
  }

  const clusters: Array<{
    sessionId: string;
    members: FlatSig[];
    sources: Set<string>;
    maxSev: Severity;
  }> = [];
  bySession.forEach((members, sessionId) => {
    if (members.length < 2) return;
    const kinds = new Set(members.map((m) => m.kind));
    if (kinds.size < 2) return;
    const tss = members.map((m) => m.ts);
    const span = Math.max(...tss) - Math.min(...tss);
    if (span > WINDOW_MS) return;

    const sevRank: Record<Severity, number> = { CRIT: 5, HIGH: 4, MED: 3, WARN: 2, LOW: 1 };
    let maxSev: Severity = "LOW";
    for (const m of members) {
      if (sevRank[m.severity] > sevRank[maxSev]) maxSev = m.severity;
    }
    clusters.push({ sessionId, members, sources: kinds, maxSev });
  });

  const sevRank: Record<Severity, number> = { CRIT: 5, HIGH: 4, MED: 3, WARN: 2, LOW: 1 };
  const top = clusters
    .sort((a, b) => {
      const aScore = a.members.reduce((acc, m) => acc + sevRank[m.severity], 0);
      const bScore = b.members.reduce((acc, m) => acc + sevRank[m.severity], 0);
      return bScore - aScore;
    })
    .slice(0, 5);

  return top.map((c) => {
    const sources = Array.from(c.sources);
    const finding: CorrelationFinding = {
      id: `correlation-${c.sessionId}`,
      title: `${c.members.length} signals correlated on session ${c.sessionId}`,
      severity: c.maxSev,
      correlatedSignalIds: c.members.map((m) => m.id),
      correlatedSources: sources,
      windowStartMs: Math.min(...c.members.map((m) => m.ts)),
      windowEndMs:   Math.max(...c.members.map((m) => m.ts)),
      sharedSessionId: c.sessionId,
      evidence: [`${c.members.length} signals within ${Math.round(WINDOW_MS / 60_000)}m`, `all on session ${c.sessionId}`],
      confidence: c.members.length >= 3 ? "high" : "medium",
    };

    return {
      id: `correlation-${c.sessionId}`,
      severity: c.maxSev,
      title: `${c.members.length} signals correlated on session ${c.sessionId}`,
      source: "correlation-engine",
      evidence: { kind: "exact", label: "Exact (audit_event_id)" } as EvidenceConfidence,
      ageMs: 0,
      suggestedAction: { verb: "Diagnose", target: `${c.members.length}-signal cluster`, detail: sources.join(" + ") } as SuggestedAction,
      buttonLabel: "Diagnose ▸",
      clickTarget: { tab: "auditEvidence" },
      restricted,
      priorityScore: computeActionPriority({ severity: c.maxSev, ageMs: 0, evidenceKind: "exact" }),
      family: "alert" as const,
      incidentType: "correlation",
      rawSource: { kind: "correlation", finding } as ActionRow["rawSource"],
    };
  });
}
