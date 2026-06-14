// Footer provenance legend — permanent reminder of the 5 EvidenceLevel
// states and the MIN-collapses rule. Enforces the no-false-reassurance
// principle: operators see the confidence ladder with every surface.

import { C, F } from "../../constants";

export function ProvenanceLegend() {
  return (
    <div
      style={{
        marginTop: 20,
        padding: "12px 14px",
        background: `${C.txS}08`,
        border: `1px solid ${C.brdS}`,
        borderRadius: 6,
      }}
    >
      <div style={{ color: C.txS, fontSize: 10, fontFamily: F.mono, fontWeight: 700, marginBottom: 6 }}>
        PROVENANCE LADDER
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 10, fontFamily: F.mono }}>
        <span style={{ color: C.green }}>● verified_runtime</span>
        <span style={{ color: C.green }}>● verified_config</span>
        <span style={{ color: C.cyan }}>● verified_filesystem</span>
        <span style={{ color: C.warn }}>● heuristic_inference</span>
        <span style={{ color: C.txT }}>● unknown</span>
      </div>
      <div style={{ fontSize: 11, color: C.txS, marginTop: 6, lineHeight: 1.4 }}>
        Every claim carries a source. <strong>effectiveBlastRadius.confidence = MIN(inputs)</strong> — one
        <code style={{ fontFamily: F.mono, color: C.warn }}> heuristic_inference </code>
        input collapses the score to heuristic; one
        <code style={{ fontFamily: F.mono, color: C.txT }}> unknown </code>
        input collapses it to unknown (numeric renders as &apos;—&apos;, never 0).
      </div>
    </div>
  );
}
