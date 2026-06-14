import { C, F } from "../../constants";
import { Tooltip } from "../../tooltip";

interface Props {
  demoMode: boolean;
}

/**
 * Mission Control disclosure pills row.
 *
 * Spec §16.1 required-copy: every Mission Control surface MUST display the
 * three FinOps disclosure pills — "Local instance healthy" (or "DEMO MODE"
 * when demoMode is on), "Not invoice-reconciled", and "Source totals shown
 * separately" — so the operator never reads MC headline numbers without the
 * surrounding context.
 *
 * History (operator-driven simplification, 2026-05-06):
 *  - v0.13.0 originally also rendered a "▸ COMMAND  Mission Control ↻ Ns"
 *    title prefix and a local 1h/24h/7d/30d range picker. Both duplicated
 *    chrome that already lives in the dashboard's panel-header bar (title +
 *    Fresh tick) and context bar (range picker, with 6h support that this
 *    local picker lacked). operator flagged the duplication; both removed.
 *  - This component is now just the three pills, inline with no outer
 *    chrome — they sit cleanly on the page background as discrete glass
 *    elements, matching the rest of MC's dashboard-flat design.
 */
export function MissionControlHeader({ demoMode }: Props) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap",
      marginBottom: 16,
    }}>
      <Pill
        label={demoMode ? "DEMO MODE" : "Local instance healthy"}
        tone={demoMode ? "warn" : "good"}
        tooltip={demoMode
          ? "Demo Mode is on. Every panel renders synthetic-but-realistic fixture data instead of your live install. Useful for screenshots, rehearsals, and onboarding without exposing real activity."
          : "This ClawNex install is running normally. Service liveness checks pass, OpenClaw is connected, and no monitored source is degraded."}
      />
      <Pill
        label="Not invoice-reconciled"
        tone="warn"
        tooltip="Cost figures here come from ClawNex monitoring AI provider API traffic — they're estimates derived from usage, not numbers pulled from your provider's billing statement. Treat them as directional. The actual invoice may differ."
      />
      <Pill
        label="Source totals shown separately"
        tone="neutral"
        tooltip="When multiple gateways feed ClawNex (e.g., OpenClaw + Hermes), each gateway's spend is reported on its own row — never summed into a single total. Summing would double-count agents whose traffic is observed by more than one gateway."
      />
    </div>
  );
}

function Pill({ label, tone, tooltip }: { label: string; tone: "good" | "warn" | "neutral"; tooltip?: string }) {
  const color = tone === "good" ? C.green : tone === "warn" ? C.warn : C.txS;
  const bg = tone === "good" ? `${C.green}14` : tone === "warn" ? `${C.warn}14` : C.glassSurfTrans;
  const border = tone === "good" ? `1px solid ${C.green}55` : tone === "warn" ? `1px solid ${C.warn}55` : `1px solid ${C.glassBorderSubtle}`;
  const textColor = tone === "neutral" ? C.txS : color;

  const pillSpan = (
    <span
      style={{
        padding: "5px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: textColor,
        background: bg,
        border,
        fontFamily: F.mono,
        cursor: tooltip ? "help" : undefined,
        // Subtle dotted underline so operators see the hover-discoverability cue.
        textDecoration: tooltip ? `underline dotted ${textColor}66` : undefined,
        textUnderlineOffset: tooltip ? 3 : undefined,
      }}
    >
      {label}
    </span>
  );

  if (!tooltip) return pillSpan;
  return (
    <Tooltip placement="bottom" variant="detail" content={tooltip} delay={250}>
      {pillSpan}
    </Tooltip>
  );
}
