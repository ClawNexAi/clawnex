// Findings grid — dangerous combos (left) + posture lints (right).
// Non-evaluable combos are collapsed under a summary row with an explicit
// reason — never reported as zero risk.
//
// v0.8.0+: each evaluable combo + each lint card carries an Accept Risk
// button. Suppressed combos/lints render in an Accepted Risks collapsible
// at the bottom of each card.

import { useState } from "react";
import { C, F } from "../../constants";
import { Badge, CollapsibleCard } from "../../shared";
import { Tooltip } from "../../tooltip";
import {
  AcceptRiskButton,
  SuppressedFindingCard,
  AcceptedRisksSection,
} from "../../risk-acceptance/AcceptRiskWidget";
import type {
  DangerousComboFinding,
  PostureLintFinding,
  SuppressedComboFinding,
  SuppressedLintFinding,
} from "@/lib/services/permissiveness/types";
import { findCombo } from "@/lib/services/permissiveness/dangerous-combos";

function sevColor(s: string): string {
  if (s === "critical") return C.danger;
  if (s === "high") return C.orange;
  if (s === "medium") return C.warn;
  return C.green;
}

export function FindingsGrid({
  combos,
  lints,
  combosSuppressed = [],
  lintsSuppressed = [],
  onChange,
}: {
  combos: DangerousComboFinding[];
  lints: PostureLintFinding[];
  combosSuppressed?: SuppressedComboFinding[];
  lintsSuppressed?: SuppressedLintFinding[];
  onChange?: () => void;
}) {
  const evaluable = combos.filter((c) => c.evaluable);
  const skipped = combos.filter((c) => !c.evaluable);

  const comboLabel = combosSuppressed.length > 0
    ? `Dangerous-tool combinations (${evaluable.length} active · ${combosSuppressed.length} accepted · ${skipped.length} skipped)`
    : `Dangerous-tool combinations (${evaluable.length} evaluable · ${skipped.length} skipped)`;
  const lintLabel = lintsSuppressed.length > 0
    ? `Posture-lint findings (${lints.length} active · ${lintsSuppressed.length} accepted)`
    : `Posture-lint findings (${lints.length})`;
  const comboTitle = (
    <Tooltip as="span" placement="right" variant="detail" content={<span><strong>Dangerous tool combinations</strong> — agents that hold a set of tools whose <em>combination</em> creates a worse risk than any single tool would. Examples: <strong>file read + outbound HTTP</strong> = an exfil path; <strong>shell exec + web browse</strong> = a remote-code-execution loop. The list shows what each agent has and what the combo enables. <strong>Skipped</strong> entries don&apos;t have enough evidence to evaluate (tool inventory unknown) — review manually.</span>}>
      <span style={{ borderBottom: `1px dotted currentColor`, cursor: "help" }}>{comboLabel}</span>
    </Tooltip>
  );
  const lintTitle = (
    <Tooltip as="span" placement="right" variant="detail" content={<span><strong>Posture-lint findings</strong> — misconfigurations that aren&apos;t exploits today but violate best-practice and become exploits if conditions change. Examples: an allowlist that mixes channel IDs into user IDs, an agent declared in OpenClaw that Hermes doesn&apos;t actually enforce, a recovery path that bypasses MFA. Think of these as &quot;static analysis for permissions.&quot;</span>}>
      <span style={{ borderBottom: `1px dotted currentColor`, cursor: "help" }}>{lintLabel}</span>
    </Tooltip>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <CollapsibleCard title={comboTitle} accent={C.orange} defaultOpen={false} count={evaluable.length}>
        {evaluable.length === 0 && (
          <div style={{ fontSize: 12, color: C.txS, padding: "8px 0" }}>
            No evaluable combos found. This is NOT a clean bill of health — it means combo evaluation
            did not have enough evidence. See the skipped rows below for reasons.
          </div>
        )}
        {evaluable.map((f, i) => {
          const combo = findCombo(f.comboId);
          return (
            <div key={`${f.comboId}-${f.agentId}-${i}`} style={{ padding: 8, borderBottom: `1px solid ${C.brdS}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 8 }}>
                <strong style={{ color: C.tx, fontSize: 12 }}>{combo?.name ?? f.comboId}</strong>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <AcceptRiskButton
                    query={{
                      source_panel: "blast_radius_combo",
                      rule_id: f.comboId,
                      agent_id: f.agentId,
                      surface_id: null,
                      evidence: f.evidence.map((e) => e.tool),
                    }}
                    onAccepted={onChange}
                  />
                  <Badge label={combo?.severity ?? "medium"} color={sevColor(combo?.severity ?? "medium")} />
                </div>
              </div>
              <div style={{ fontSize: 10, color: C.txS, fontFamily: F.mono }}>agent: {f.agentId}</div>
              <div style={{ fontSize: 10, color: C.txS, marginTop: 2 }}>
                evidence: {f.evidence.map((e) => e.tool).join(", ")}
              </div>
            </div>
          );
        })}

        <AcceptedRisksSection count={combosSuppressed.length}>
          {combosSuppressed.map(({ finding, acceptance }) => {
            const combo = findCombo(finding.comboId);
            return (
              <SuppressedFindingCard
                key={`sup-${acceptance.id}`}
                title={`${combo?.name ?? finding.comboId} on ${finding.agentId}`}
                acceptance={acceptance}
                meta={`evidence: ${finding.evidence.map((e) => e.tool).join(", ")}`}
                onRevoked={onChange}
              />
            );
          })}
        </AcceptedRisksSection>

        <SkippedCombosAccordion skipped={skipped} />
      </CollapsibleCard>

      <CollapsibleCard title={lintTitle} accent={C.warn} defaultOpen={false} count={lints.length}>
        {lints.length === 0 && (
          <div style={{ fontSize: 12, color: C.txS, padding: "8px 0" }}>
            No posture-lint findings on live config. (Scanner ran; no rules fired.)
          </div>
        )}
        {lints.map((f) => (
          <div key={`${f.ruleId}-${f.surfaceId}-${f.field}`} style={{ padding: 8, borderBottom: `1px solid ${C.brdS}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 8 }}>
              <strong style={{ color: C.tx, fontSize: 12 }}>{f.ruleId}</strong>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <AcceptRiskButton
                  query={{
                    source_panel: "blast_radius_lint",
                    rule_id: f.ruleId,
                    agent_id: null,
                    surface_id: f.surfaceId,
                    evidence: [f.field, f.value],
                  }}
                  onAccepted={onChange}
                />
                <Badge label={f.severity} color={sevColor(f.severity)} />
              </div>
            </div>
            <div style={{ fontSize: 10, color: C.txS, fontFamily: F.mono, marginTop: 2 }}>
              field: {f.field}
            </div>
            <div style={{ fontSize: 10, color: C.danger, fontFamily: F.mono, marginTop: 2 }}>
              value: {f.value}
            </div>
            <div style={{ fontSize: 11, color: C.txS, marginTop: 4, lineHeight: 1.4 }}>{f.rationale}</div>
          </div>
        ))}

        <AcceptedRisksSection count={lintsSuppressed.length}>
          {lintsSuppressed.map(({ finding, acceptance }) => (
            <SuppressedFindingCard
              key={`sup-${acceptance.id}`}
              title={`${finding.ruleId} on ${finding.surfaceId}`}
              acceptance={acceptance}
              meta={`field: ${finding.field} · value: ${finding.value}`}
              onRevoked={onChange}
            />
          ))}
        </AcceptedRisksSection>
      </CollapsibleCard>
    </div>
  );
}

function SkippedCombosAccordion({ skipped }: { skipped: DangerousComboFinding[] }) {
  const [open, setOpen] = useState(false);
  if (skipped.length === 0) return null;
  return (
    <div style={{ marginTop: 8, padding: 8, background: `${C.txS}08`, borderRadius: 4 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          background: "transparent",
          border: 0,
          color: C.txS,
          fontSize: 11,
          fontFamily: F.mono,
          cursor: "pointer",
          padding: 0,
        }}
      >
        {open ? "▼" : "▶"} Not evaluable: {skipped.length} (click for reasons)
      </button>
      {open && (
        <div style={{ marginTop: 8, paddingLeft: 12 }}>
          {skipped.map((f, i) => (
            <div key={`sk-${i}`} style={{ fontSize: 10, color: C.txT, marginBottom: 4 }}>
              <span style={{ color: C.txS, fontFamily: F.mono }}>{f.comboId}</span> — {f.agentId} — {f.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
