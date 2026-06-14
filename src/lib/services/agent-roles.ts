/**
 * Known-agent role map.
 *
 * OpenClaw 2026.4.x's openclaw.json schema rejects `role` (or any
 * description-like field) on `agents.list[]` or `agents.list[].identity`.
 * Allowed identity keys: name, theme, emoji, avatar. So roles cannot live
 * in OpenClaw's config and must be provided by ClawNex itself.
 *
 * This file is the single source of truth for the operator-facing role of
 * each agent on this fleet. workspace-reader.ts uses it to fill in
 * `registry.role` when openclaw.json doesn't carry one (which is always,
 * since the schema rejects it). /api/agents enriches gateway-returned
 * agent records with the same data so the Agents & Sessions panel cards
 * display a description.
 *
 * Add a new agent? Drop its entry here and redeploy. There's no DB-backed
 * editor today; that's a follow-up if/when this list grows past what's
 * reasonable to maintain in source.
 *
 * @module services/agent-roles
 */

export const KNOWN_AGENT_ROLES: Record<string, string> = {
  main:          "Default OpenClaw operator workspace",
  neo:           "End-to-end investigator and pivot generalist",
  trinity:       "Infiltration specialist — recon and controlled pen-testing",
  morpheus:      "Strategic advisor and orchestration mentor",
  oracle:        "Pattern recognition and longitudinal forecasting",
  "agent-smith": "Adversarial simulation and red-team validation",
};

/** Look up the operator-facing role for an agent id. Returns empty string
 *  when no entry is registered — callers can decide to render or hide. */
export function getAgentRole(id: string | undefined | null): string {
  if (!id) return "";
  return KNOWN_AGENT_ROLES[id] || "";
}
