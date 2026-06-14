// Most Exposed Surfaces — Block D.

import { C, F } from "../../constants";
import { CollapsibleCard, Table } from "../../shared";
import { Tooltip } from "../../tooltip";
import type {
  BlastRadiusBand,
  EvidenceLevel,
  RankedSurface,
} from "@/lib/services/permissiveness/types";

function exposedSurfacesTitle() {
  return (
    <Tooltip as="span" placement="right" variant="detail" content={<span><strong>Most Exposed Surfaces</strong> — surfaces (HTTP endpoints, MCP tools, channels) ranked by their <em>worst-case blast radius</em>. The number reflects the most permissive agent that can reach this surface, weighted by the surface&apos;s own audience size and containment posture. Tighten the top entries first to shrink your attack surface.</span>}>
      <span style={{ borderBottom: `1px dotted currentColor`, cursor: "help" }}>Most Exposed Surfaces</span>
    </Tooltip>
  );
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

function confidenceColor(c: EvidenceLevel): string {
  if (c === "unknown") return C.txT;
  if (c === "heuristic_inference") return C.warn;
  if (c === "verified_filesystem") return C.cyan;
  return C.green;
}

export function RankedSurfacesTable({
  surfaces,
  onDrillTo,
}: {
  surfaces: RankedSurface[];
  onDrillTo?: (tabId: string) => void;
}) {
  if (surfaces.length === 0) {
    return (
      <CollapsibleCard title={exposedSurfacesTitle()} accent={C.danger} defaultOpen={false} count={0}>
        <div style={{ fontSize: 12, color: C.txS, padding: "12px 0" }}>
          No shipped surfaces found — scan returned an empty list. Check /api/permissiveness health.
        </div>
      </CollapsibleCard>
    );
  }

  const rows = surfaces.map((s, i) => {
    const band = s.blastRadius.band;
    const bandBg = bandColor(band);
    const unknown = s.blastRadius.confidence === "unknown";
    return [
      <span key="i" style={{ color: C.txS, fontFamily: F.mono }}>#{i + 1}</span>,
      <span key="n" style={{ color: C.tx, fontWeight: 700 }}>{s.surfaceId}</span>,
      <span key="ag" style={{ color: C.tx }}>{s.agentCount}</span>,
      // When no agents reach a surface (or scope can't be determined), the
      // raw enum falls through to "unknown" / "missing". Render those as `—`
      // muted+italic to match the BlastRadius column's existing convention,
      // so operators don't read the row as a system fault — operator-flagged
      // 2026-05-08 from internal dogfood.
      <span key="aud" style={{
        color: s.worstAudience === "unknown" ? C.txG : C.txS,
        fontSize: 11,
        fontFamily: F.mono,
        fontStyle: s.worstAudience === "unknown" ? "italic" : "normal",
      }}>{s.worstAudience === "unknown" ? "—" : s.worstAudience}</span>,
      <span key="al" style={{
        color: s.worstAllowlist === "missing" ? C.txG : C.txS,
        fontSize: 11,
        fontFamily: F.mono,
        fontStyle: s.worstAllowlist === "missing" ? "italic" : "normal",
      }}>{s.worstAllowlist === "missing" ? "—" : s.worstAllowlist}</span>,
      <span
        key="br"
        style={{
          padding: "2px 8px",
          borderRadius: 4,
          background: `${bandBg}22`,
          color: unknown ? C.txG : bandBg,
          fontWeight: 700,
          fontSize: 11,
          fontFamily: F.mono,
          fontStyle: unknown ? "italic" : "normal",
        }}
      >
        {unknown ? "—" : `${band.toUpperCase()} · ${s.blastRadius.numeric}`}
      </span>,
      <span key="conf" style={{ color: confidenceColor(s.blastRadius.confidence), fontSize: 10, fontFamily: F.mono }}>
        {s.blastRadius.confidence}
      </span>,
      <span key="drill" style={{ display: "flex", gap: 4 }}>
        {s.drillLinks.map((d) => (
          <button
            key={d.tabId}
            onClick={() => onDrillTo?.(d.tabId)}
            disabled={!onDrillTo}
            style={{
              background: `${C.cyan}22`,
              border: `1px solid ${C.cyan}55`,
              color: C.cyan,
              fontSize: 10,
              fontFamily: F.mono,
              padding: "2px 6px",
              borderRadius: 3,
              cursor: onDrillTo ? "pointer" : "default",
            }}
          >
            → {d.label}
          </button>
        ))}
      </span>,
    ];
  });

  return (
    <CollapsibleCard title={exposedSurfacesTitle()} accent={C.danger} defaultOpen={false} count={surfaces.length}>
      <div style={{ fontSize: 11, color: C.txS, marginBottom: 8 }}>
        Ranked by worst-case reachability edge per surface. Drill links jump to the panel that lets
        you actually do something about it.
      </div>
      <Table
        headers={["#", "Surface", "Agents", "Worst audience", "Worst allowlist", "Blast radius", "Conf.", "Drill"]}
        rows={rows}
      />
    </CollapsibleCard>
  );
}
