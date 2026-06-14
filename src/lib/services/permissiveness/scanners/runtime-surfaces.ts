// Runtime-surfaces adapter — thin wrapper over trust-audit/discovery's
// discoverSurfaces(). No new discovery logic in SP-1. Maps the existing
// Surface shape to the permissiveness-lib Surface shape.
//
// Audience / allowlist characterization is seeded from the existing
// `policy` + `publicExposure` fields on each trust-audit surface, which
// gives us honest inputs without fabricating new signals.
//
// Spec: docs/superpowers/specs/2026-04-23-blast-radius-permissiveness-design.md §8

import { discoverSurfaces as trustAuditDiscoverSurfaces } from "@/lib/services/trust-audit/discovery";
import type {
  AudienceType,
  AllowlistState,
  EnforcerRuntime,
  Surface,
} from "../types";

// Map trust-audit.Surface.kind → our enforcer attribution.
const ENFORCER_BY_KIND: Record<string, EnforcerRuntime> = {
  "litellm-proxy": "openclaw",
  "session-watcher": "clawnex",
  "mcp-http": "clawnex",
  "mcp-stdio": "clawnex",
  "api-v1": "clawnex",
  "dashboard": "clawnex",
  "webhook": "none",
};

// Map trust-audit.Surface.policy → our AudienceType / AllowlistState.
function audienceFor(
  policy: "open" | "localhost" | "rbac" | "api-key" | "unknown",
  publicExposure: boolean,
): AudienceType {
  if (publicExposure) return "public";
  if (policy === "localhost") return "localhost_only";
  if (policy === "rbac") return "localhost_only";
  if (policy === "api-key") return "public";
  if (policy === "open") return "public";
  return "unknown";
}

function allowlistFor(
  policy: "open" | "localhost" | "rbac" | "api-key" | "unknown",
): AllowlistState {
  if (policy === "rbac") return "enforcing_tight";
  if (policy === "api-key") return "enforcing_broad";
  if (policy === "localhost") return "enforcing_tight";
  if (policy === "open") return "missing";
  return "unavailable";
}

export function scanRuntimeSurfaces(): Surface[] {
  let raw;
  try {
    raw = trustAuditDiscoverSurfaces();
  } catch {
    return [];
  }
  const out: Surface[] = [];
  for (const s of raw) {
    const enforcerRuntime = ENFORCER_BY_KIND[s.kind] ?? "clawnex";
    // We carry the audience/allowlist derivation as reachability-edge seeds, since runtime
    // surfaces have no per-agent comm enforcement; the effective blast radius is computed
    // by the orchestrator (index.ts) joining agents against these surfaces.
    out.push({
      id: s.kind,
      name: s.name,
      kind: "runtime-endpoint",
      integrationStatus: "shipped",
      enforcerRuntime,
      botIdentity: "not_applicable",
      reachability: [],
      effectiveBlastRadius: {
        numeric: 0,
        band: "minimal",
        drivers: [],
        confidence: "verified_runtime",
        rawFactors: {},
      },
      confidence: "verified_runtime",
    });
  }
  return out;
}

// Helper exposed for the orchestrator — gives it the seed AudienceType and
// AllowlistState per runtime-endpoint surface without repeating the switch.
export function runtimeSurfaceSeed(surfaceId: string): { audience: AudienceType; allowlist: AllowlistState } | null {
  let raw;
  try {
    raw = trustAuditDiscoverSurfaces();
  } catch {
    return null;
  }
  const match = raw.find((s) => s.kind === surfaceId);
  if (!match) return null;
  return {
    audience: audienceFor(match.policy, match.publicExposure),
    allowlist: allowlistFor(match.policy),
  };
}
