// Blast-radius scoring — pure function surface.
//
// Formula (per reachability edge):
//   raw = audience × allowlist × containment × routing × (tool_risk + combo_bonus + lint_bonus)
//   numeric = clamp(raw × 100 / MAX_RAW, 0, 100)
//
// Aggregation:
//   Surface-level blast radius = MAX(edge scores)   (worst-case principle)
//   Agent-level permissiveness  = MAX(edge scores)
//
// Confidence propagation:
//   All inputs walk the ladder: verified_runtime > verified_config >
//   verified_filesystem > heuristic_inference > unknown.
//   effectiveBlastRadius.confidence = MIN of all input confidences.
//   Any `unknown` input collapses the whole claim to `unknown`.
//
// Spec: docs/superpowers/specs/2026-04-23-blast-radius-permissiveness-design.md §5

import type {
  AllowlistState,
  AudienceType,
  BlastRadiusBand,
  BlastRadiusScore,
  ContainmentState,
  EvidenceLevel,
  RoutingPath,
} from "./types";

// ---------- Factor tables ----------

export const AUDIENCE_FACTOR: Record<AudienceType, number> = {
  private_dm: 1,
  group_restricted: 1.5,
  group_open: 3,
  guild_restricted: 2,
  guild_open: 4,
  public: 5,
  localhost_only: 0.5,
  workspace_restricted: 1.5,
  unknown: 2.5,
};

export const ALLOWLIST_FACTOR: Record<AllowlistState, number> = {
  enforcing_tight: 1,
  enforcing_broad: 1.3,
  partial: 2,
  missing: 3.5,
  enterprise_placeholder: 3.5,
  unavailable: 2.5,
};

export const CONTAINMENT_FACTOR: Record<ContainmentState, number> = {
  sandboxed: 0.5,
  unsandboxed: 1.5,
  unknown: 1.0,
};

export const ROUTING_FACTOR: Record<RoutingPath, number> = {
  routed: 1.0,
  direct: 1.3,
  unknown: 1.1,
};

export const TOOL_RISK_CAP = 30;
export const TOOL_RISK_WEIGHT = { LOW: 1, MEDIUM: 3, HIGH: 6 } as const;
export const DANGEROUS_COMBO_BONUS = 5;
export const POSTURE_LINT_BONUS = 2;

// Calibrated worst-case edge:
//   public (5) × missing (3.5) × unsandboxed (1.5) × direct (1.3) ×
//   (tool_risk=30 + 2 combos × 5 + 1 lint × 2) = 5 × 3.5 × 1.5 × 1.3 × 42 = 1433.25
export const MAX_RAW = 5 * 3.5 * 1.5 * 1.3 * (30 + 2 * DANGEROUS_COMBO_BONUS + 1 * POSTURE_LINT_BONUS);

// ---------- Confidence ladder ----------

const LADDER: Record<EvidenceLevel, number> = {
  verified_runtime: 4,
  verified_config: 3,
  verified_filesystem: 2,
  heuristic_inference: 1,
  unknown: 0,
};

export function MIN_CONFIDENCE(a: EvidenceLevel, b: EvidenceLevel): EvidenceLevel {
  return LADDER[a] <= LADDER[b] ? a : b;
}

export function reduceConfidence(levels: EvidenceLevel[]): EvidenceLevel {
  if (levels.length === 0) return "unknown";
  return levels.reduce<EvidenceLevel>((acc, l) => MIN_CONFIDENCE(acc, l), levels[0]);
}

// ---------- Scoring ----------

export interface EdgeScoreInput {
  audience: AudienceType;
  allowlist: AllowlistState;
  containment: ContainmentState;
  routing: RoutingPath;
  toolRisks: Array<"LOW" | "MEDIUM" | "HIGH">;
  triggeredCombos: number;
  triggeredLints: number;
  confidences: {
    audience: EvidenceLevel;
    allowlist: EvidenceLevel;
    containment: EvidenceLevel;
    routing: EvidenceLevel;
    tools: EvidenceLevel;
    combos: EvidenceLevel;
    lints: EvidenceLevel;
  };
}

function bandFor(numeric: number): BlastRadiusBand {
  if (numeric < 20) return "minimal";
  if (numeric < 40) return "low";
  if (numeric < 60) return "medium";
  if (numeric < 80) return "high";
  return "critical";
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function computeEdgeScore(input: EdgeScoreInput): BlastRadiusScore {
  const audience = AUDIENCE_FACTOR[input.audience];
  const allowlist = ALLOWLIST_FACTOR[input.allowlist];
  const containment = CONTAINMENT_FACTOR[input.containment];
  const routing = ROUTING_FACTOR[input.routing];
  const toolRisk = Math.min(
    TOOL_RISK_CAP,
    input.toolRisks.reduce((s, r) => s + TOOL_RISK_WEIGHT[r], 0),
  );
  const comboBonus = input.triggeredCombos * DANGEROUS_COMBO_BONUS;
  const lintBonus = input.triggeredLints * POSTURE_LINT_BONUS;

  const inner = toolRisk + comboBonus + lintBonus;
  const raw = audience * allowlist * containment * routing * inner;
  const numeric = clamp(Math.round((raw * 100) / MAX_RAW), 0, 100);

  const rawFactors: Record<string, number> = {
    audience,
    allowlist,
    containment,
    routing,
    toolRisk,
    comboBonus,
    lintBonus,
    inner,
    raw,
  };

  const drivers = extractDrivers(rawFactors);
  const confidence = reduceConfidence(Object.values(input.confidences));

  return { numeric, band: bandFor(numeric), drivers, confidence, rawFactors };
}

export function extractDrivers(
  rawFactors: Record<string, number>,
  topN = 5,
): { factor: string; contribution: number }[] {
  // Rank multiplicative contributors by how much they inflate vs their neutral baseline.
  // Audience neutral = 1 (private_dm); allowlist neutral = 1 (enforcing_tight); etc.
  const neutrals: Record<string, number> = {
    audience: 1,
    allowlist: 1,
    containment: 1,
    routing: 1,
  };
  const entries: { factor: string; contribution: number }[] = [];
  for (const key of ["audience", "allowlist", "containment", "routing"]) {
    const v = rawFactors[key];
    if (typeof v === "number") {
      entries.push({ factor: key, contribution: v - neutrals[key] });
    }
  }
  if (typeof rawFactors.toolRisk === "number") {
    entries.push({ factor: "toolRisk", contribution: rawFactors.toolRisk / 6 });
  }
  if (typeof rawFactors.comboBonus === "number" && rawFactors.comboBonus > 0) {
    entries.push({ factor: "dangerousCombos", contribution: rawFactors.comboBonus / DANGEROUS_COMBO_BONUS });
  }
  if (typeof rawFactors.lintBonus === "number" && rawFactors.lintBonus > 0) {
    entries.push({ factor: "postureLints", contribution: rawFactors.lintBonus / POSTURE_LINT_BONUS });
  }
  return entries
    .filter((e) => e.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, topN);
}

// ---------- Aggregation (MAX) ----------

const ZERO_SCORE: BlastRadiusScore = {
  numeric: 0,
  band: "minimal",
  drivers: [],
  confidence: "unknown",
  rawFactors: {},
};

export function aggregateMax(edges: BlastRadiusScore[]): BlastRadiusScore {
  if (edges.length === 0) return { ...ZERO_SCORE };
  return edges.reduce((max, e) => (e.numeric > max.numeric ? e : max), edges[0]);
}

export const aggregateSurfaceScore = aggregateMax;
export const aggregateAgentScore = aggregateMax;
