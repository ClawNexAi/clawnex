// Exposure Matrix — Block B of the Blast Radius panel.
//
// Table row per surface. Click-to-expand reveals the 9-dimension posture
// breakdown per profile layer. Every claim carries a confidence pill.
// not_integrated surfaces are dimmed with an explicit placeholder label.
//
// Spec: docs/superpowers/specs/2026-04-23-blast-radius-permissiveness-design.md §7 Block B

import { useState } from "react";
import { C, F } from "../../constants";
import { Badge, CollapsibleCard, Table } from "../../shared";
import { Tooltip } from "../../tooltip";
import type {
  Surface,
  PermissionPosture,
  HermesProfileLayer,
  BlastRadiusBand,
  EvidenceLevel,
  AudienceType,
} from "@/lib/services/permissiveness/types";

interface Props {
  surfaces: Surface[];
  onDrillTo?: (tabId: string) => void;
}

function bandColor(band: BlastRadiusBand): string {
  switch (band) {
    case "critical": return C.danger;
    case "high": return C.orange;
    case "medium": return C.warn;
    case "low": return C.green;
    case "minimal":
    default: return C.txT;
  }
}

function audienceColor(a: AudienceType): string {
  switch (a) {
    case "public": return C.danger;
    case "group_open":
    case "guild_open": return C.orange;
    case "workspace_restricted":
    case "group_restricted":
    case "guild_restricted":
    case "private_dm": return C.green;
    case "localhost_only": return C.cyan;
    default: return C.txT;
  }
}

function confidenceColor(c: EvidenceLevel): string {
  switch (c) {
    case "verified_runtime": return C.green;
    case "verified_config": return C.green;
    case "verified_filesystem": return C.cyan;
    case "heuristic_inference": return C.warn;
    case "unknown":
    default: return C.txT;
  }
}

function BlastRadiusCell({ score, confidence }: { score: number; band: BlastRadiusBand; confidence: EvidenceLevel }) {
  // internal reviewer rule: when any input is unknown, render '—' dimmed, never 0.
  if (confidence === "unknown") {
    return (
      <span style={{ color: C.txG, fontStyle: "italic", fontWeight: 600 }}>—</span>
    );
  }
  return <span style={{ color: C.tx, fontWeight: 700 }}>{score}</span>;
}

function integrationBadge(s: Surface) {
  if (s.integrationStatus === "shipped") return null;
  return <Badge label="not_integrated" color={C.txT} />;
}

export function ExposureMatrix({ surfaces, onDrillTo }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = surfaces.map((s) => {
    const isDimmed = s.integrationStatus !== "shipped";
    const isExpanded = expanded === s.id;
    const band = s.effectiveBlastRadius.band;
    const bandBg = bandColor(band);

    return [
      // Surface + expand chevron
      <button
        key="surface"
        onClick={() => setExpanded(isExpanded ? null : s.id)}
        style={{
          background: "transparent",
          border: 0,
          cursor: s.integrationStatus === "shipped" ? "pointer" : "default",
          color: isDimmed ? C.txT : C.tx,
          fontFamily: F.mono,
          fontSize: 12,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: 0,
        }}
        disabled={s.integrationStatus !== "shipped"}
      >
        <span style={{ color: C.txS, fontSize: 10 }}>
          {s.integrationStatus === "shipped" ? (isExpanded ? "▼" : "▶") : " "}
        </span>
        {s.name}
      </button>,
      // Agents
      <span key="agents" style={{ color: isDimmed ? C.txT : C.tx }}>
        {s.reachability.length}
      </span>,
      // Audience
      isDimmed ? (
        <span key="aud" style={{ color: C.txT }}>—</span>
      ) : (
        <Badge
          key="aud"
          label={worstAudience(s)}
          color={audienceColor(worstAudience(s))}
        />
      ),
      // Allowlist
      isDimmed ? (
        <span key="allow" style={{ color: C.txT }}>—</span>
      ) : (
        <span key="allow" style={{ color: C.txS, fontSize: 11, fontFamily: F.mono }}>
          {worstAllowlist(s)}
        </span>
      ),
      // Path
      isDimmed ? (
        <span key="path" style={{ color: C.txT }}>—</span>
      ) : (
        <span key="path" style={{ color: C.txS, fontSize: 11, fontFamily: F.mono }}>
          {worstPath(s)}
        </span>
      ),
      // Bot identity
      isDimmed ? (
        <span key="bot" style={{ color: C.txT }}>—</span>
      ) : (
        <Badge
          key="bot"
          label={s.botIdentity}
          color={s.botIdentity === "dual_bot" ? C.warn : C.txS}
        />
      ),
      // Enforcer
      <span key="enf" style={{ color: isDimmed ? C.txT : C.tx, fontSize: 11, fontFamily: F.mono }}>
        {s.enforcerRuntime}
      </span>,
      // Blast radius
      <span
        key="br"
        style={{
          padding: "2px 8px",
          borderRadius: 4,
          background: `${bandBg}22`,
          color: bandBg,
          fontWeight: 700,
          fontSize: 11,
          fontFamily: F.mono,
          // v0.8.1 fix: keep "MINIMAL · 0" on a single line. Without nowrap
          // the badge wraps in narrow columns, splitting band-label from
          // numeric across two visual rows (operator-reported formatting bug).
          whiteSpace: "nowrap",
          display: "inline-block",
        }}
      >
        {band.toUpperCase()}
        {" · "}
        <BlastRadiusCell
          score={s.effectiveBlastRadius.numeric}
          band={band}
          confidence={s.effectiveBlastRadius.confidence}
        />
      </span>,
      // Confidence
      <span key="conf" style={{ color: confidenceColor(s.confidence), fontSize: 10, fontFamily: F.mono }}>
        {s.confidence}
      </span>,
      // Integration placeholder
      integrationBadge(s) ?? <span key="int" />,
    ];
  });

  return (
    <CollapsibleCard title={
      <Tooltip as="span" placement="right" variant="detail" content={<span><strong>Surface / Channel Exposure Matrix</strong> — every <em>surface</em> (an HTTP endpoint, MCP tool, file system path, Discord/Slack channel) cross-referenced against the agents that can reach it. Each row shows the <em>posture</em> covering that surface — audience, authentication, allowlist, containment, routing — and which evidence sources verified it. Expand a row to see the 9-dimension permission breakdown per Hermes profile layer. The most useful drill-down for &quot;who can do what, where, and how bad if it broke?&quot;</span>}>
        <span style={{ borderBottom: `1px dotted currentColor`, cursor: "help" }}>Surface / Channel Exposure Matrix</span>
      </Tooltip>
    } accent={C.brand} defaultOpen={false} count={surfaces.length}>
      <div style={{ fontSize: 11, color: C.txS, marginBottom: 8 }}>
        Click a shipped surface row to expand its 9-dimension posture. <strong>not_integrated</strong> rows are
        honest placeholders — these surfaces are modeled but the discovery adapter has not shipped.
      </div>
      <Table
        headers={[
          "Surface",
          "Agents",
          "Audience",
          "Allowlist",
          "Path",
          "Bot identity",
          "Enforcer",
          "Blast radius",
          "Conf.",
          "",
        ]}
        rows={rows}
      />
      {expanded && (
        <SurfaceDetail
          surface={surfaces.find((s) => s.id === expanded)!}
          onDrillTo={onDrillTo}
          onClose={() => setExpanded(null)}
        />
      )}
    </CollapsibleCard>
  );
}

function worstAudience(s: Surface): AudienceType {
  if (s.reachability.length === 0) return "unknown";
  // Pick edge with highest numeric score.
  const worst = s.reachability.reduce((acc, r) =>
    r.edgeBlastRadius.numeric > acc.edgeBlastRadius.numeric ? r : acc,
  );
  return worst.effectiveAudience;
}

function worstAllowlist(s: Surface): string {
  if (s.reachability.length === 0) return "—";
  const worst = s.reachability.reduce((acc, r) =>
    r.edgeBlastRadius.numeric > acc.edgeBlastRadius.numeric ? r : acc,
  );
  return worst.effectiveAllowlist;
}

function worstPath(s: Surface): string {
  if (s.reachability.length === 0) return "—";
  const worst = s.reachability.reduce((acc, r) =>
    r.edgeBlastRadius.numeric > acc.edgeBlastRadius.numeric ? r : acc,
  );
  return worst.path;
}

function SurfaceDetail({
  surface,
  onDrillTo,
  onClose,
}: {
  surface: Surface;
  onDrillTo?: (tabId: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        background: `${C.brand}08`,
        border: `1px solid ${C.brand}33`,
        borderRadius: 6,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <strong style={{ color: C.brand, fontFamily: F.mono }}>
          {surface.name} — posture detail
        </strong>
        <div style={{ display: "flex", gap: 6 }}>
          {onDrillTo && (
            <>
              <button
                onClick={() => onDrillTo("toolsAccess")}
                style={drillButtonStyle}
              >
                → Tools & Access
              </button>
              <button
                onClick={() => onDrillTo("accessLists")}
                style={drillButtonStyle}
              >
                → Access Lists
              </button>
              <button onClick={() => onDrillTo("agents")} style={drillButtonStyle}>
                → Agents
              </button>
            </>
          )}
          <button onClick={onClose} style={{ ...drillButtonStyle, background: "transparent" }}>
            Close
          </button>
        </div>
      </div>

      {surface.openclawLayer && (
        <PostureDump title="OpenClaw-declared posture" posture={surface.openclawLayer} />
      )}
      {surface.hermesLayer && surface.hermesLayer.length > 0 && (
        <>
          {surface.hermesLayer.map((layer) => (
            <PostureDump
              key={layer.profileId}
              title={`Hermes-enforced posture — profile "${layer.profileId}"${layer.active ? " (ACTIVE)" : ""}`}
              posture={layer.posture}
            />
          ))}
        </>
      )}
    </div>
  );
}

const drillButtonStyle: React.CSSProperties = {
  background: `${C.brand}22`,
  border: `1px solid ${C.brand}55`,
  color: C.brand,
  fontSize: 10,
  fontFamily: F.mono,
  padding: "3px 8px",
  borderRadius: 4,
  cursor: "pointer",
};

function PostureDump({ title, posture }: { title: string; posture: PermissionPosture }) {
  const rows: [string, React.ReactNode, EvidenceLevel, string][] = [
    ["bot token (prefix)",
      posture.botToken.value ? posture.botToken.value.prefix + "…" : "—",
      posture.botToken.provenance.level,
      posture.botToken.provenance.source,
    ],
    ["DM user allowlist",
      posture.dmAccessGate.value
        ? `${posture.dmAccessGate.value.allowedUserIds.length} users · ${posture.dmAccessGate.value.policyType}`
        : "—",
      posture.dmAccessGate.provenance.level,
      posture.dmAccessGate.provenance.source,
    ],
    ["group access gate",
      posture.groupAccessGate.value
        ? `require_mention=${posture.groupAccessGate.value.requireMention}${posture.groupAccessGate.value.freeResponseChannels.length ? `, ${posture.groupAccessGate.value.freeResponseChannels.length} free-response` : ""}`
        : "—",
      posture.groupAccessGate.provenance.level,
      posture.groupAccessGate.provenance.source,
    ],
    ["channel filter",
      posture.channelFilter.value
        ? `allow:${posture.channelFilter.value.allowedChannels.length}, ignore:${posture.channelFilter.value.ignoredChannels.length}`
        : "—",
      posture.channelFilter.provenance.level,
      posture.channelFilter.provenance.source,
    ],
    ["approval-action allowlist",
      posture.approvalActionAllowlist.value
        ? `${posture.approvalActionAllowlist.value.userIds.length} users${posture.approvalActionAllowlist.value.allowAllBypass ? " + allow-all bypass" : ""}`
        : "—",
      posture.approvalActionAllowlist.provenance.level,
      posture.approvalActionAllowlist.provenance.source,
    ],
    ["home channel",
      posture.homeChannel.value ?? "—",
      posture.homeChannel.provenance.level,
      posture.homeChannel.provenance.source,
    ],
    ["allow-all bypass",
      String(posture.allowAllBypass.value),
      posture.allowAllBypass.provenance.level,
      posture.allowAllBypass.provenance.source,
    ],
    ["pairing-approved users",
      `${posture.pairingApproved.value?.length ?? 0} users`,
      posture.pairingApproved.provenance.level,
      posture.pairingApproved.provenance.source,
    ],
    ["exec approvers",
      posture.execApprovers.value && posture.execApprovers.value.length > 0
        ? `${posture.execApprovers.value.length} users`
        : "—",
      posture.execApprovers.provenance.level,
      posture.execApprovers.provenance.source,
    ],
  ];

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ color: C.txS, fontSize: 11, fontFamily: F.mono, fontWeight: 700, marginBottom: 6 }}>
        {title}
      </div>
      <Table
        headers={["Dimension", "Value", "Confidence", "Source"]}
        rows={rows.map(([dim, val, conf, src]) => [
          <span key="d" style={{ color: C.txS, fontSize: 11, fontFamily: F.mono }}>{dim}</span>,
          <span key="v" style={{ color: C.tx, fontSize: 11, fontFamily: F.mono }}>{val}</span>,
          <span key="c" style={{ color: confidenceColor(conf), fontSize: 10, fontFamily: F.mono }}>{conf}</span>,
          <span key="s" style={{ color: C.txT, fontSize: 10, fontFamily: F.mono }}>{src}</span>,
        ])}
      />
    </div>
  );
}
