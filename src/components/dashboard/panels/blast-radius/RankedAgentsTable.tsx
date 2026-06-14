// Most Permissive Agents — Block C.

import { C, F } from "../../constants";
import { Badge, CollapsibleCard, Table } from "../../shared";
import { Tooltip } from "../../tooltip";
import type {
  BlastRadiusBand,
  EvidenceLevel,
  RankedAgent,
} from "@/lib/services/permissiveness/types";

function permissiveAgentsTitle() {
  return (
    <Tooltip as="span" placement="right" variant="detail" content={<span><strong>Most Permissive Agents</strong> — agents ranked by their <em>worst-case blast radius</em>, which is the highest-scoring edge they hold across every reachable surface. An agent that can reach a high-impact surface with weak containment ranks higher than one that&apos;s only reachable on hardened paths. &quot;Why&quot; names the factors driving that worst score so you can see what to tighten first.</span>}>
      <span style={{ borderBottom: `1px dotted currentColor`, cursor: "help" }}>Most Permissive Agents</span>
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

export function RankedAgentsTable({ agents }: { agents: RankedAgent[] }) {
  if (agents.length === 0) {
    return (
      <CollapsibleCard title={permissiveAgentsTitle()} accent={C.orange} defaultOpen={false} count={0}>
        <div style={{ fontSize: 12, color: C.txS, padding: "12px 0" }}>
          No reachability edges found — no comm surfaces have Hermes agents bound to them. This is
          a genuine zero (not 'unknown'): scanner ran cleanly but found no agent-to-surface edges.
        </div>
      </CollapsibleCard>
    );
  }

  const rows = agents.map((a, i) => {
    const band = a.blastRadius.band;
    const bandBg = bandColor(band);
    const unknown = a.blastRadius.confidence === "unknown";
    return [
      <span key="i" style={{ color: C.txS, fontFamily: F.mono }}>#{i + 1}</span>,
      <span key="n" style={{ color: C.tx, fontWeight: 700 }}>{a.agentName}</span>,
      <span key="sr" style={{ color: C.txS, fontSize: 11, fontFamily: F.mono }}>
        {a.surfacesReachable.join(", ")}
      </span>,
      <span key="p" style={{ color: C.txS, fontSize: 11, fontFamily: F.mono }}>{a.worstPath}</span>,
      <span key="dt" style={{ color: a.dangerousToolCount > 0 ? C.warn : C.txS, fontWeight: a.dangerousToolCount > 0 ? 700 : 400 }}>
        {a.dangerousToolCount}
      </span>,
      <span key="al" style={{ color: C.txS, fontSize: 11, fontFamily: F.mono }}>{a.worstAllowlist}</span>,
      <Badge key="ct" label={a.containmentState} color={a.containmentState === "unsandboxed" ? C.orange : C.txT} />,
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
        {unknown ? "—" : `${band.toUpperCase()} · ${a.blastRadius.numeric}`}
      </span>,
      <span key="why" style={{ color: C.txS, fontSize: 11 }}>{a.whyRisky}</span>,
      <span key="conf" style={{ color: confidenceColor(a.blastRadius.confidence), fontSize: 10, fontFamily: F.mono }}>
        {a.blastRadius.confidence}
      </span>,
    ];
  });

  return (
    <CollapsibleCard title={permissiveAgentsTitle()} accent={C.orange} defaultOpen={false} count={agents.length}>
      <div style={{ fontSize: 11, color: C.txS, marginBottom: 8 }}>
        Ranked by worst-case edge blast radius across surfaces the agent is reachable on. The
        &quot;Why&quot; column names the top multiplicative factors from the edge score. Unknown-confidence
        scores render as &apos;—&apos;.
      </div>
      <Table
        headers={["#", "Agent", "Surfaces", "Path", "Danger Tools", "Allowlist", "Containment", "Blast radius", "Why", "Conf."]}
        rows={rows}
      />
    </CollapsibleCard>
  );
}
