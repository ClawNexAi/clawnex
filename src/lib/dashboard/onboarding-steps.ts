/**
 * Onboarding-steps — single source of truth for the Welcome Wizard.
 *
 * Why this module exists:
 *   The wizard step list lived in three places (PANEL_HELP fleet desc,
 *   /api/chat system prompt + fallback, training scripts) and they drifted
 *   independently. the reviewer's QA pass found the help drawer still saying
 *   "6-step checklist" and the chat fallback listing 6 numbered items
 *   while the live wizard had 7. Operators trust whichever source they
 *   happen to read first; we have to make sure they all match.
 *
 *   Every surface that names the steps now imports `ONBOARDING_STEPS`
 *   from here and either renders the list directly or substitutes the
 *   count via `ONBOARDING_STEPS.length`. Adding/removing a step is one
 *   edit; the help drawer, chat AI, and training docs all update at
 *   compile time.
 *
 * Order matters — the wizard renders steps in this array order.
 */

export interface OnboardingStep {
  /** Stable id for cross-referencing (configuration card focus key, etc.). */
  id: string;
  /** Short label shown in the wizard step list. */
  label: string;
  /** One-line description for help/chat copy. */
  description: string;
}

export const ONBOARDING_STEPS: ReadonlyArray<OnboardingStep> = Object.freeze([
  {
    id: 'install',
    label: 'Install ClawNex',
    description: 'Already complete by the time the operator sees this panel — listed as step 1 so the count matches the wizard UI and gives the operator a sense of forward progress.',
  },
  {
    id: 'add-provider',
    label: 'Add an AI model provider',
    description: 'Add at least one AI source — direct provider (OpenAI, Anthropic, OpenRouter) or OpenClaw routing.',
  },
  {
    id: 'install-clawkeeper',
    label: 'Enable host security',
    description: 'Verify the bundled host-hardening scanner so the Security Posture panel and Hardening signal can populate.',
  },
  {
    id: 'sync-cve',
    label: 'Sync CVE database',
    description: 'Pull the CVE feed so vulnerability findings can correlate with infrastructure events.',
  },
  {
    id: 'sync-pricing',
    label: 'Sync model pricing',
    description: 'Pull model-pricing data from the LiteLLM GitHub mirror so token/cost panels show real $ figures.',
  },
  {
    id: 'configure-routing',
    label: 'Configure OpenClaw routing',
    description: 'Configure which OpenClaw providers route through the LiteLLM proxy so the shield can scan them.',
  },
  {
    id: 'first-shield-test',
    label: 'Run first shield test',
    description: 'Fire a test payload through the shield to confirm detection works end-to-end.',
  },
]);

/** Convenience for surfaces that need the step count inline. */
export const ONBOARDING_STEP_COUNT = ONBOARDING_STEPS.length;

/** Render a numbered list for help/chat copy. Use markdown-friendly format. */
export function renderOnboardingStepsMarkdown(): string {
  return ONBOARDING_STEPS.map((s, i) => `${i + 1}. **${s.label}** — ${s.description}`).join('\n');
}

/** Compact one-line description listing the step labels in order. */
export function renderOnboardingStepsInline(): string {
  return ONBOARDING_STEPS.map(s => s.label).join(', ');
}
