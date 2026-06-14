"use client";

import { C, F } from "../../constants";

interface Props {
  visible: boolean;
  onClick: () => void;
}

/**
 * "← Back to Mission Control" breadcrumb.
 *
 * Spec §7.4. Rendered at the top of any focused detail in a destination
 * panel when the operator arrived via Mission Control's drill-down.
 *
 * Single source of truth — every destination panel imports this and
 * renders it conditionally on incomingFromMissionControl. Mirrors the
 * existing v0.11.3-alpha BackToIncidentBreadcrumb pattern in
 * AuditEvidencePanel but pointed at Mission Control.
 */
export function MissionControlBreadcrumb({ visible, onClick }: Props) {
  if (!visible) return null;
  return (
    <button
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        marginBottom: 10,
        background: `${C.cyan}14`,
        border: `1px solid ${C.cyan}55`,
        borderRadius: 999,
        color: C.cyan,
        fontSize: 11,
        fontWeight: 700,
        fontFamily: F.sans,
        cursor: "pointer",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      <span style={{ fontSize: 12 }}>{"←"}</span>
      <span>Back to Mission Control</span>
    </button>
  );
}
