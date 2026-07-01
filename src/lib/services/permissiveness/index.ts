// Blast Radius + Permissiveness — public entry.
//
// scan() orchestrates scanners (openclaw + hermes + runtime surfaces),
// composes the Surface[] list, derives surface-level blast-radius from each
// comm surface's runtime-enforcing posture, evaluates posture lints, runs
// dangerous-combo evaluation against agent tool lists where available, and
// builds rankings.
//
// MVP honesty contract: where SP-1 doesn't yet join per-agent reachability
// (tool lists, routing path, containment) the orchestrator emits edges with
// confidence=unknown or marks combo findings as evaluable:false with an
// explicit reason — NEVER faked.
//
// Spec: docs/superpowers/specs/2026-04-23-blast-radius-permissiveness-design.md §8

import { getCached, setCached, clearCache } from "./cache";
import { evaluateAllCombos } from "./dangerous-combos";
import { evaluateLints } from "./posture-lints";
import {
  applySuppressions as applyRiskSuppressions,
  autoExpire as autoExpireRiskAcceptances,
  autoRevokeOnEvidenceChange as autoRevokeRA,
} from "../risk-acceptance";
import {
  aggregateMax,
  computeEdgeScore,
  MIN_CONFIDENCE,
  reduceConfidence,
} from "./scoring";
import { classifyBotIdentity } from "./token-matching";
import {
  classifyAgentPath,
  scanOpenClaw,
  type OpenClawAgent,
  type OpenClawBinding,
  type OpenClawLayer,
} from "./scanners/openclaw";
import {
  scanHermes,
  type HermesScanResult,
} from "./scanners/hermes";
import { scanRuntimeSurfaces } from "./scanners/runtime-surfaces";
import type {
  AllowlistState,
  AudienceType,
  BlastRadiusScore,
  BotIdentity,
  ContainmentState,
  EvidenceLevel,
  EnforcerRuntime,
  HermesProfileLayer,
  PermissionPosture,
  PermissivenessReport,
  RankedAgent,
  RankedSurface,
  RoutingPath,
  Surface,
  SurfaceReachability,
} from "./types";

export { clearCache };

export interface ScanOpts {
  refresh?: boolean;
}

export async function scan(opts: ScanOpts = {}): Promise<PermissivenessReport> {
  if (!opts.refresh) {
    const hit = getCached();
    if (hit) {
      return {
        ...hit,
        meta: {
          ...hit.meta,
          cached: true,
          cacheAgeMs: Date.now() - new Date(hit.generatedAt).getTime(),
        },
      };
    }
  }

  const t0 = Date.now();
  const generatedAt = new Date().toISOString();

  const openclaw = scanOpenClaw();
  const hermes = scanHermes();
  const runtimeSurfaces = (() => {
    try {
      return scanRuntimeSurfaces();
    } catch {
      return [] as Surface[];
    }
  })();

  // Comm surfaces — combine OpenClaw declaration with per-profile Hermes runtime posture.
  const discord = buildCommSurface("discord", "Discord", openclaw, hermes);
  const telegram = buildCommSurface("telegram", "Telegram", openclaw, hermes);
  const slack = buildCommSurface("slack", "Slack", openclaw, hermes);

  // Honest placeholders.
  const webhook = buildNotIntegrated("webhook", "Webhook");

  const surfaces: Surface[] = [
    discord,
    telegram,
    slack,
    ...runtimeSurfaces,
    webhook,
  ];

  // Populate reachability edges per comm surface (Hermes profile posture + OpenClaw bindings).
  for (const s of [discord, telegram, slack]) {
    if (s.integrationStatus !== "shipped") continue;
    const hermesEdges = deriveCommReachability(s, hermes);
    const openclawEdges = deriveOpenClawCommReachability(s, openclaw);
    s.reachability = [...hermesEdges, ...openclawEdges];
    s.effectiveBlastRadius = aggregateMax(s.reachability.map((r) => r.edgeBlastRadius));
    s.confidence = MIN_CONFIDENCE(
      s.confidence,
      reduceConfidence(s.reachability.map((r) => r.confidence)),
    );
  }

  // LiteLLM proxy surface gets every OpenClaw agent as a reachability edge —
  // these agents live inside the OpenClaw runtime and their LLM traffic
  // (routed or direct) classifies the edge honestly.
  const litellmSurface = surfaces.find((s) => s.id === "litellm-proxy");
  if (litellmSurface) {
    litellmSurface.reachability = deriveOpenClawRuntimeReachability(litellmSurface, openclaw);
    litellmSurface.effectiveBlastRadius = aggregateMax(
      litellmSurface.reachability.map((r) => r.edgeBlastRadius),
    );
    litellmSurface.confidence = MIN_CONFIDENCE(
      litellmSurface.confidence,
      reduceConfidence(litellmSurface.reachability.map((r) => r.confidence)),
    );
  }

  // v0.8.0: sweep expired risk acceptances first.
  try {
    autoExpireRiskAcceptances();
  } catch (err) {
    console.warn("[permissiveness] risk-acceptance autoExpire failed:", err);
  }

  // Posture lints (runs against live surfaces; catches the reviewer's live telegram case).
  const postureLints = evaluateLints(surfaces);

  // Dangerous combos — joined per edge. OpenClaw edges carry tool lists from
  // cfg.agents.list[].tools.allow; Hermes comm-agent edges carry tool unions
  // extracted (heuristic) from <profile>/skills/**/SKILL.md. Combos remain
  // evaluable:false (with an explicit reason) only when no tools could be
  // discovered — never fabricated.
  const combosByAgent: ReturnType<typeof evaluateAllCombos> = [];
  const seen = new Set<string>();
  const edgeBearingSurfaces = surfaces.filter((s) => s.reachability.length > 0);
  for (const s of edgeBearingSurfaces) {
    for (const r of s.reachability) {
      const key = `${r.agentId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const findings = evaluateAllCombos(r.agentId, r.toolIds).map((f) => ({
        ...f,
        reason: f.evaluable
          ? f.reason
          : r.toolIds.length === 0
            ? "Agent declares no tools in scanned config. For OpenClaw agents with tools:null a global fallback policy may apply; for Hermes comm-agents no SKILL.md under <profile>/skills/ matched a known tool needle (or skills/ dir is absent). Re-evaluate after the next scanner pass or when skills are added."
            : f.reason,
      }));
      combosByAgent.push(...findings);
    }
  }

  // v0.8.0: apply risk-acceptance suppressions BEFORE rankings so suppressed
  // combos/lints don't drive the surface scores. Evidence-delta auto-revoke
  // runs first so any acceptance whose evidence shifted re-activates here.
  try {
    autoRevokeRA(
      "blast_radius_combo",
      combosByAgent.filter((c) => c.evaluable).map((c) => ({
        rule_id: c.comboId,
        agent_id: c.agentId,
        surface_id: null,
        evidence: c.evidence.map((e) => e.tool),
      })),
    );
    autoRevokeRA(
      "blast_radius_lint",
      postureLints.map((l) => ({
        rule_id: l.ruleId,
        agent_id: null,
        surface_id: l.surfaceId,
        evidence: [l.field, l.value],
      })),
    );
  } catch (err) {
    console.warn("[permissiveness] risk-acceptance evidence-delta sweep failed:", err);
  }

  const comboPartition = applyRiskSuppressions(combosByAgent, (c) => ({
    source_panel: "blast_radius_combo" as const,
    rule_id: c.comboId,
    agent_id: c.agentId,
    surface_id: null,
    evidence: c.evidence.map((e) => e.tool),
  }));
  const dangerousCombosActive = comboPartition.active;
  const dangerousCombosSuppressed = comboPartition.suppressed.map((s) => ({
    finding: s.finding,
    acceptance: {
      id: s.acceptance.id,
      scope_level: s.acceptance.scope_level,
      accepted_by: s.acceptance.accepted_by,
      accepted_at: s.acceptance.accepted_at,
      reason: s.acceptance.reason,
      expires_at: s.acceptance.expires_at,
    },
  }));

  const lintPartition = applyRiskSuppressions(postureLints, (l) => ({
    source_panel: "blast_radius_lint" as const,
    rule_id: l.ruleId,
    agent_id: null,
    surface_id: l.surfaceId,
    evidence: [l.field, l.value],
  }));
  const postureLintsActive = lintPartition.active;
  const postureLintsSuppressed = lintPartition.suppressed.map((s) => ({
    finding: s.finding,
    acceptance: {
      id: s.acceptance.id,
      scope_level: s.acceptance.scope_level,
      accepted_by: s.acceptance.accepted_by,
      accepted_at: s.acceptance.accepted_at,
      reason: s.acceptance.reason,
      expires_at: s.acceptance.expires_at,
    },
  }));

  // Rankings — include EVERY surface with reachability edges so OpenClaw runtime
  // agents (on litellm-proxy) and bound agents (on discord/telegram/slack) all
  // show up. Surface IDs are collected from the containing surface directly,
  // not parsed out of agent IDs.
  const rankings = {
    mostPermissiveAgents: buildAgentRanking(edgeBearingSurfaces),
    mostExposedSurfaces: buildSurfaceRanking(surfaces),
  };

  // Panel-wide confidence = MIN across shipped surfaces.
  const shippedConfidences = surfaces
    .filter((s) => s.integrationStatus === "shipped")
    .map((s) => s.confidence);
  const panelWideConfidence = shippedConfidences.length
    ? reduceConfidence(shippedConfidences)
    : ("unknown" as EvidenceLevel);

  const report: PermissivenessReport = {
    generatedAt,
    profiles: hermes.profiles.map((p) => ({
      id: p.id,
      active: p.active,
      activationSource: p.activationSource,
      source: p.source,
    })),
    surfaces,
    // v0.8.0: dangerousCombos field still carries ACTIVE combos so the v0.7.x
    // panel renders only un-suppressed; the gross + suppressed lists are
    // available as separate fields for the panel's Accepted Risks section.
    dangerousCombos: dangerousCombosActive,
    dangerousCombosSuppressed,
    postureLints: postureLintsActive,
    postureLintsSuppressed,
    rankings,
    meta: {
      scanDurationMs: Date.now() - t0,
      cached: false,
      cacheAgeMs: 0,
      panelWideConfidence,
    },
  };

  setCached(report);
  return report;
}

// ---------- surface builders ----------

function buildCommSurface(
  id: "discord" | "telegram" | "slack",
  name: string,
  oc: OpenClawLayer,
  hm: HermesScanResult,
): Surface {
  const openclawLayer = (oc as any)[id] as PermissionPosture | null | undefined;
  const hermesLayers: HermesProfileLayer[] = hm.profiles
    .map((p) => {
      const posture = (p as any)[id] as PermissionPosture | null | undefined;
      if (!posture) return null;
      return {
        profileId: p.id,
        active: p.active,
        activationSource: p.activationSource as HermesProfileLayer["activationSource"],
        posture,
      } satisfies HermesProfileLayer;
    })
    .filter((x): x is HermesProfileLayer => x !== null);

  // Token identity: prefer active profile's token; else first profile's; else null.
  const activeLayer = hermesLayers.find((l) => l.active) ?? hermesLayers[0];
  const activeHash = activeLayer?.posture.botToken.value?.hash ?? null;
  const openclawHash = openclawLayer?.botToken.value?.hash ?? null;
  const botIdentity: BotIdentity = classifyBotIdentity({
    openclawToken: openclawHash,
    hermesToken: activeHash,
  });

  const enforcerRuntime: EnforcerRuntime =
    activeLayer && openclawLayer
      ? botIdentity === "dual_bot" || botIdentity === "single_bot_hermes_enforces"
        ? "hermes"
        : "openclaw"
      : activeLayer
        ? "hermes"
        : openclawLayer
          ? "openclaw"
          : "none";

  const layersForConf: EvidenceLevel[] = [];
  if (openclawLayer) layersForConf.push("verified_config");
  for (const _l of hermesLayers) layersForConf.push("verified_config");
  const confidence: EvidenceLevel = layersForConf.length ? reduceConfidence(layersForConf) : "unknown";

  return {
    id,
    name,
    kind: "comm-channel",
    integrationStatus: "shipped",
    openclawLayer: openclawLayer ?? null,
    hermesLayer: hermesLayers,
    enforcerRuntime,
    botIdentity,
    reachability: [],
    effectiveBlastRadius: {
      numeric: 0,
      band: "minimal",
      drivers: [],
      confidence,
      rawFactors: {},
    },
    confidence,
  };
}

function buildNotIntegrated(id: string, name: string): Surface {
  return {
    id,
    name,
    kind: "comm-channel",
    integrationStatus: "not_integrated",
    enforcerRuntime: "not_applicable",
    botIdentity: "not_applicable",
    reachability: [],
    effectiveBlastRadius: {
      numeric: 0,
      band: "minimal",
      drivers: [],
      confidence: "unknown",
      rawFactors: {},
    },
    confidence: "unknown",
  };
}

// ---------- reachability derivation ----------

/** Classify an individual tool name as LOW / MEDIUM / HIGH risk for tool_risk scoring.
 *  Same rubric ToolsAccess uses (see src/app/api/tools/route.ts). */
function toolRiskFor(tool: string): "LOW" | "MEDIUM" | "HIGH" {
  const lower = tool.toLowerCase();
  if (/^(bash|exec|shell|run_command|execute|group:exec|group:fs|file_write|fs_write|write|edit)$/.test(lower)) return "HIGH";
  if (/^(browser|fetch|web_fetch|web_search|web_browse|http_post|webhook|delegate|dispatch_agent|call_agent|send|email|post|config_write|edit_config|systemctl|service_control|restart|reload)$/.test(lower)) return "MEDIUM";
  return "LOW";
}

function classifyTools(toolIds: string[]): {
  risks: Array<"LOW" | "MEDIUM" | "HIGH">;
  dangerousCount: number;
} {
  const risks: Array<"LOW" | "MEDIUM" | "HIGH"> = [];
  let dangerousCount = 0;
  for (const t of toolIds) {
    const r = toolRiskFor(t);
    risks.push(r);
    if (r === "HIGH" || r === "MEDIUM") dangerousCount++;
  }
  return { risks, dangerousCount };
}

function deriveOpenClawCommReachability(
  surface: Surface,
  openclaw: OpenClawLayer,
): SurfaceReachability[] {
  const edges: SurfaceReachability[] = [];
  if (!["discord", "telegram", "slack"].includes(surface.id)) return edges;

  const agentsById = new Map<string, OpenClawAgent>();
  for (const a of openclaw.agents) agentsById.set(a.id, a);

  // Group bindings by agentId so one agent with multiple peer bindings yields one edge (not N).
  const bindingsByAgent = new Map<string, OpenClawBinding[]>();
  for (const b of openclaw.bindings) {
    if (b.channel !== surface.id) continue;
    const list = bindingsByAgent.get(b.agentId) ?? [];
    list.push(b);
    bindingsByAgent.set(b.agentId, list);
  }

  Array.from(bindingsByAgent.entries()).forEach(([agentId, binds]) => {
    const agent = agentsById.get(agentId);
    if (!agent) return; // binding references missing agent — skip honestly

    const pathClassification = classifyAgentPath(agent.model, openclaw.routingByModelPrefix);
    const path: RoutingPath = pathClassification === "unknown" ? "unknown" : pathClassification;

    const { risks, dangerousCount } = classifyTools(agent.toolIds);

    // Audience derivation for openclaw-bound edges: reuses the openclaw-declared
    // posture on the surface (deriveAudience expects the Hermes posture shape,
    // so we approximate from the surface's openclawLayer).
    const ocPosture = surface.openclawLayer ?? null;
    const audience: AudienceType = ocPosture
      ? deriveAudience(surface.id, ocPosture)
      : "unknown";
    const allowlist: AllowlistState = ocPosture ? deriveAllowlist(ocPosture) : "unknown" as unknown as AllowlistState;
    const allowlistFallback: AllowlistState = ocPosture ? allowlist : "missing";

    const lintCount = (evaluateLints([surface]) ?? []).length;
    const combos = evaluateAllCombos(`openclaw:${agent.id}`, agent.toolIds).filter((c) => c.evaluable).length;

    const toolsConf = agent.toolsDeclared ? "verified_config" : "unknown";
    const edgeBlastRadius = computeEdgeScore({
      audience,
      allowlist: allowlistFallback,
      containment: "unknown",
      routing: path,
      toolRisks: risks,
      triggeredCombos: combos,
      triggeredLints: lintCount,
      confidences: {
        audience: ocPosture ? ocPosture.dmAccessGate.provenance.level : "unknown",
        allowlist: ocPosture ? ocPosture.dmAccessGate.provenance.level : "unknown",
        containment: "unknown",
        routing: pathClassification === "unknown" ? "unknown" : "verified_config",
        tools: toolsConf,
        combos: toolsConf,
        lints: ocPosture ? ocPosture.dmAccessGate.provenance.level : "unknown",
      },
    });

    edges.push({
      agentId: `openclaw:${agent.id}`,
      agentName: agent.name,
      path,
      pathDetails: `via openclaw.bindings[${binds.length}] (model=${agent.model || "?"})`,
      toolIds: agent.toolIds,
      dangerousToolCount: dangerousCount,
      containmentState: "unknown",
      effectiveAudience: audience,
      effectiveAllowlist: allowlistFallback,
      edgeBlastRadius,
      confidence: edgeBlastRadius.confidence,
    });
  });

  return edges;
}

function deriveOpenClawRuntimeReachability(
  surface: Surface,
  openclaw: OpenClawLayer,
): SurfaceReachability[] {
  // Every OpenClaw agent lives in the OpenClaw runtime; expose that on the
  // litellm-proxy surface (the existing trust-audit surface for OpenClaw).
  // Edges carry the agent's real tool list and per-agent routing classification.
  const edges: SurfaceReachability[] = [];
  for (const agent of openclaw.agents) {
    const pathClassification = classifyAgentPath(agent.model, openclaw.routingByModelPrefix);
    const path: RoutingPath = pathClassification === "unknown" ? "unknown" : pathClassification;
    const { risks, dangerousCount } = classifyTools(agent.toolIds);

    const toolsConf = agent.toolsDeclared ? "verified_config" : "unknown";
    const combos = evaluateAllCombos(`openclaw-runtime:${agent.id}`, agent.toolIds).filter((c) => c.evaluable).length;

    const edgeBlastRadius = computeEdgeScore({
      audience: "localhost_only",
      allowlist: "enforcing_tight", // OpenClaw runtime is localhost-gated by the gateway token
      containment: "unknown",
      routing: path,
      toolRisks: risks,
      triggeredCombos: combos,
      triggeredLints: 0,
      confidences: {
        audience: "verified_config",
        allowlist: "verified_config",
        containment: "unknown",
        routing: pathClassification === "unknown" ? "unknown" : "verified_config",
        tools: toolsConf,
        combos: toolsConf,
        lints: "verified_config",
      },
    });

    edges.push({
      agentId: `openclaw-runtime:${agent.id}`,
      agentName: agent.name,
      path,
      pathDetails: `openclaw runtime · model=${agent.model || "?"}`,
      toolIds: agent.toolIds,
      dangerousToolCount: dangerousCount,
      containmentState: "unknown",
      effectiveAudience: "localhost_only",
      effectiveAllowlist: "enforcing_tight",
      edgeBlastRadius,
      confidence: edgeBlastRadius.confidence,
    });
  }
  return edges;
}

function deriveCommReachability(
  surface: Surface,
  hermes: HermesScanResult,
): SurfaceReachability[] {
  const edges: SurfaceReachability[] = [];

  for (const profile of hermes.profiles) {
    const posture = (profile as any)[surface.id] as PermissionPosture | null | undefined;
    if (!posture) continue;

    const audience = deriveAudience(surface.id, posture);
    const allowlist = deriveAllowlist(posture);
    const containment: ContainmentState = "unknown"; // SP-1 MVP: no containment introspection
    const routing: RoutingPath = "unknown";          // SP-1 MVP: per-platform routing not joined

    // v0.7.1: skill tool union from <profile>/skills/**/SKILL.md becomes the
    // Hermes comm-agent's tool list. Union across skills, not per-skill — the
    // Hermes runtime loads the whole profile's skill set for the agent.
    const toolIds = Array.isArray(profile.toolUnion) ? profile.toolUnion : [];
    const { risks: toolRisks, dangerousCount: dangerousToolCount } = classifyTools(toolIds);
    const skillsConfidence: EvidenceLevel = toolIds.length > 0 ? "heuristic_inference" : "unknown";

    const lintCount = (evaluateLints([surface]) ?? []).length;
    const combos = evaluateAllCombos(
      `hermes-${surface.id}@${profile.id}`,
      toolIds,
    ).filter((c) => c.evaluable).length;

    const edgeBlastRadius = computeEdgeScore({
      audience,
      allowlist,
      containment,
      routing,
      toolRisks,
      triggeredCombos: combos,
      triggeredLints: lintCount,
      confidences: {
        audience: posture.dmAccessGate.provenance.level,
        allowlist: posture.dmAccessGate.provenance.level,
        containment: "unknown",
        routing: "unknown",
        tools: skillsConfidence,
        combos: skillsConfidence,
        lints: posture.dmAccessGate.provenance.level,
      },
    });

    const pathDetails = toolIds.length > 0
      ? `hermes gateway · tools inferred from ${profile.skills?.length ?? 0} skill(s)`
      : "per-platform routing not joined; no skill-declared tools detected";

    edges.push({
      agentId: `hermes-${surface.id}@${profile.id}`,
      agentName: `hermes-${surface.id}`,
      profileId: profile.id,
      path: routing,
      pathDetails,
      toolIds,
      dangerousToolCount,
      containmentState: containment,
      effectiveAudience: audience,
      effectiveAllowlist: allowlist,
      edgeBlastRadius,
      confidence: edgeBlastRadius.confidence,
    });
  }

  return edges;
}

function deriveAudience(surfaceId: string, posture: PermissionPosture): AudienceType {
  const gag = posture.groupAccessGate.value;
  const dmg = posture.dmAccessGate.value;

  if (surfaceId === "slack") {
    if ((dmg?.allowedUserIds.length ?? 0) > 0) return "workspace_restricted";
    if (posture.allowAllBypass.value) return "public";
    return "unknown";
  }

  if (gag) {
    const hasFreeResponse = gag.freeResponseChannels.length > 0;
    const requireMention = gag.requireMention;
    if (hasFreeResponse || !requireMention) {
      return surfaceId === "telegram" ? "group_open" : "guild_open";
    }
    return surfaceId === "telegram" ? "group_restricted" : "guild_restricted";
  }

  if ((dmg?.allowedUserIds.length ?? 0) > 0) return "private_dm";
  if (posture.allowAllBypass.value) return "public";
  return "unknown";
}

function deriveAllowlist(posture: PermissionPosture): AllowlistState {
  if (posture.allowAllBypass.value) return "missing";
  const dmg = posture.dmAccessGate.value;
  const userCount = dmg?.allowedUserIds.length ?? 0;
  if (userCount === 0) return "missing";
  if (userCount <= 10) return "enforcing_tight";
  return "enforcing_broad";
}

// ---------- rankings ----------

function buildAgentRanking(surfacesWithEdges: Surface[]): RankedAgent[] {
  const byAgent = new Map<string, { edges: SurfaceReachability[]; surfaceIds: Set<string> }>();
  for (const s of surfacesWithEdges) {
    for (const r of s.reachability) {
      const entry = byAgent.get(r.agentId) ?? { edges: [], surfaceIds: new Set<string>() };
      entry.edges.push(r);
      entry.surfaceIds.add(s.id);
      byAgent.set(r.agentId, entry);
    }
  }
  const ranked: RankedAgent[] = [];
  Array.from(byAgent.entries()).forEach(([agentId, entry]) => {
    const { edges, surfaceIds } = entry;
    const blastRadius = aggregateMax(edges.map((e) => e.edgeBlastRadius));
    const worstEdge =
      edges.find((e) => e.edgeBlastRadius.numeric === blastRadius.numeric) ?? edges[0];
    ranked.push({
      agentId,
      agentName: worstEdge.agentName,
      surfacesReachable: Array.from(surfaceIds),
      worstPath: worstEdge.path,
      dangerousToolCount: worstEdge.dangerousToolCount,
      worstAllowlist: worstEdge.effectiveAllowlist,
      containmentState: worstEdge.containmentState,
      blastRadius,
      whyRisky: whyRisky(blastRadius),
    });
  });
  ranked.sort((a, b) => b.blastRadius.numeric - a.blastRadius.numeric);
  return ranked.slice(0, 10);
}

function whyRisky(score: BlastRadiusScore): string {
  if (score.drivers.length === 0) return "no drivers above baseline";
  return score.drivers
    .slice(0, 3)
    .map((d) => d.factor)
    .join(" + ");
}

function buildSurfaceRanking(surfaces: Surface[]): RankedSurface[] {
  const out: RankedSurface[] = [];
  for (const s of surfaces) {
    if (s.integrationStatus !== "shipped") continue;
    const worst = aggregateMax(s.reachability.map((r) => r.edgeBlastRadius));
    const worstAudience: AudienceType =
      s.reachability.find((r) => r.edgeBlastRadius.numeric === worst.numeric)?.effectiveAudience ??
      "unknown";
    const worstAllowlist: AllowlistState =
      s.reachability.find((r) => r.edgeBlastRadius.numeric === worst.numeric)?.effectiveAllowlist ??
      "missing";
    out.push({
      surfaceId: s.id,
      agentCount: s.reachability.length,
      worstAudience,
      worstAllowlist,
      blastRadius: s.effectiveBlastRadius,
      drillLinks: [
        { label: "Tools & Access", tabId: "toolsAccess" },
        { label: "Agents", tabId: "agents" },
        { label: "Routing", tabId: "routing" },
      ],
    });
  }
  out.sort((a, b) => b.blastRadius.numeric - a.blastRadius.numeric);
  return out.slice(0, 10);
}

// Re-export types for convenience.
export * from "./types";
