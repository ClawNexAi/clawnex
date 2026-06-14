// Operator-readable KPI tooltips for the Blast Radius panel.
//
// Editorial rule (per operator feedback 2026-05-05): write for a brand-new
// operator, not for an engineer. Lead with what the number IS and what it
// tells the operator. Drop file paths, internal module names, and
// implementation jargon. If a technical term is necessary, unpack it inline
// with a concrete example. Honest zero vs unknown is preserved — we still
// say "we don't know yet" rather than fake-green.

export const KPI_TOOLTIPS = {
  surfaces: {
    title: "Surfaces modeled",
    body:
      "How many ways your agents can talk to the outside world — Discord, Telegram, Slack, webhooks, and so on. The format is 'Total (Live · Placeholder)'. Live surfaces are ones we're actively checking. Placeholders are surfaces we know exist but haven't hooked into yet — we list them so you don't think we forgot about them.",
  },
  reachableAgents: {
    title: "Agents reachable via ≥1 chat surface",
    body:
      "How many of your agents can be reached through at least one chat surface (Discord, Telegram, or Slack). If this number is bigger than the matching Hermes agent count in Agents & Sessions, something's off — we'll show a warning when that happens. Today this counts Hermes-style chat agents; OpenClaw agent reachability is coming in a follow-up.",
  },
  dangerousCombos: {
    title: "Dangerous-tool combinations",
    body:
      "Pairs of tools that are risky together. Examples: web browsing + file read, file read + outbound send, shell exec + file write, config-write + restart, agent-to-agent delegation + privileged peer. The format is 'N checked · M missing info'. 'Checked' means we confirmed the agent has every tool in the pair. 'Missing info' means we can't see the agent's full tool list yet, so we won't claim it's safe — we say so honestly. Most findings are still 'missing info' today; the tool-list link-up is a work in progress.",
  },
  postureLints: {
    title: "Configuration mistakes found",
    body:
      "Settings that look wrong. Examples: a Telegram channel/group ID dropped into the 'allowed USERS' list (channels aren't users), or a string that doesn't look like a Discord user ID dropped into the 'allowed Discord users' list. When this number is above zero, expand the affected row to see exactly which setting and which value looks suspicious.",
  },
  maxBlastRadius: {
    title: "Max blast radius",
    body:
      "The worst single 'who could reach what' link in your fleet right now — the highest-risk path. Scored 0 to 100. The score combines audience size, who's allowed, how much containment exists, where the traffic routes, and the tools in play. If we don't know one of those inputs, you'll see a dash (—) instead of a number — we won't show green when something is unverified. Expand any row in the Exposure Matrix below to see the 9 permission dimensions that fed this score.",
  },
  panelWideConfidence: {
    title: "Panel-wide confidence",
    body:
      "How sure we are about everything on this panel, taken from the LEAST sure source. If even one source is unverified, the panel shows a banner saying 'Some sources could not be verified' — we'd rather under-promise than show fake green.",
  },
} as const;

export type KpiKey = keyof typeof KPI_TOOLTIPS;
