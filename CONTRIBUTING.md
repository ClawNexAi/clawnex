# Contributing to ClawNex

**Document Version:** 1.5
**Product Version:** v0.11.2-alpha
**Last Updated:** 2026-05-05

Thanks for your interest in contributing to ClawNex. This document explains how the project is organized, how to propose changes, and the legal sign-off required for every commit.

> **Status note:** ClawNex is released under **Apache License 2.0 with DCO**. The public GitHub repo cutover is in progress. Until it is live, contributions happen via direct collaboration with the project owner. Issue and PR links in this document will point at the public repo once available.

## Quick Links

- [Code of Conduct](#code-of-conduct)
- [Security Disclosure Policy](#security-disclosure-policy)
- [Signed Commits Policy](#signed-commits-policy-dco-required-gpg-recommended)
- [First-Time Contributors](#first-time-contributors)
- [Reviewer Expectations and SLA](#reviewer-expectations-and-sla)
- [CLA Clarification](#cla-clarification)

---

## The Short Version

1. Fork the repo (once public) and create a topic branch
2. Make your change — code, docs, tests, whatever
3. Run `npm run build` locally to confirm it compiles
4. Commit with **`git commit -s`** — the `-s` flag adds a DCO sign-off line (required)
5. Open a pull request with a clear description of what changes and why

That's it. The rest of this document covers the "why" and the edge cases.

---

## First-Time Contributors

If this is your first contribution to ClawNex, follow this path:

1. **Read `README.md`** — especially the Enterprise Readiness and Deployment Options sections so you understand what is shipped and what is planned.
2. **Read `docs/02-high-level-architecture.md`** — the 10-minute system overview. Do not skip this; it saves hours of rediscovery.
3. **Pick a labeled "good first issue"** from the GitHub tracker when the repo is public. Look for issues tagged `good-first-issue` or `documentation`.
4. **Introduce yourself on the PR description.** Mention what you plan to change and why. Reviewers will respond faster when they understand the intent.
5. **Keep the first PR small.** Aim for under 200 changed lines. A crisp first PR builds trust; a sprawling first PR burns reviewer time.
6. **Expect feedback.** First-time contributors receive careful reviewer guidance. Treat feedback as part of the contribution, not a gate.

Suggested starter contributions:

- Fix a typo or clarification in `docs/`
- Add a new shield test payload under `src/lib/shield/test-payloads.ts`
- Improve a tooltip description in `src/components/dashboard/constants.ts`
- Add a new entry to `docs/13-release-notes.md` for an already-shipped feature you noticed was missing

---

## Reviewer Expectations and SLA

Once a pull request is open, reviewers follow a predictable cadence. These are **targets**, not guarantees; exceptional weeks will slip.

| Event | Target SLA |
|-------|-----------|
| Initial triage (label, assign) | Within 3 business days |
| First substantive review | Within 5 business days of triage |
| Follow-up review after requested changes | Within 3 business days |
| Security-sensitive review | Within 5 business days, after SECURITY.md triage |

If a PR goes untouched beyond these targets, it is reasonable to post a polite ping. Pings every 5+ business days are welcomed; daily pings are not.

Reviewers will:

- Read the PR description and confirm scope matches the change
- Run the build locally when the change touches code
- Focus on correctness, security, and consistency with the documentation suite
- Request DCO sign-off if any commit is missing it
- Be direct but constructive

PRs are typically merged by a maintainer; the contributor is not expected to self-merge.

---

---

## Signed Commits Policy (DCO Required, GPG Recommended)

**Every commit to ClawNex must be signed off under the Developer Certificate of Origin (DCO).** DCO sign-off is enforced — commits without it cannot be merged. GPG signing is **recommended** for enterprise contributors but not required.

- **DCO sign-off (required).** Appends a `Signed-off-by:` line to the commit message, certifying you have the right to contribute the change under the project license. Use `git commit -s`.
- **GPG signing (recommended).** Cryptographically signs the commit itself using your GPG key, providing stronger provenance. Use `git commit -S` (or configure `commit.gpgsign = true`). Combine both flags (`-s -S`) to DCO-sign and GPG-sign in one commit.
- **SSH signing (acceptable).** Git 2.34+ supports SSH-based commit signing as an alternative to GPG. Set `gpg.format = ssh` and `user.signingkey` to your SSH key path.

## Developer Certificate of Origin (DCO)

**Every commit to ClawNex must be signed off under the Developer Certificate of Origin.**

We use DCO instead of a traditional Contributor License Agreement (CLA). DCO is lightweight — a `Signed-off-by:` line on every commit — and doesn't require paperwork or lawyer review. By signing off, you certify that you have the right to submit the work under the project's open-source license.

### What the sign-off means

The full DCO text is at <https://developercertificate.org/>. The short version: when you add `Signed-off-by: Your Name <you@example.com>` to a commit, you're certifying that:

1. You created the change yourself, or
2. Your change is based on code licensed under a compatible open-source license, or
3. Your change was provided to you under the DCO by someone else

And you understand and agree that the change is public, may be redistributed under the project's license, and your sign-off is recorded as a permanent part of the project history.

### How to sign off

Use the `-s` flag when committing:

```bash
git commit -s -m "Add tooltip to Fleet Command Alerts stat"
```

This appends a line to the commit message:

```
Add tooltip to Fleet Command Alerts stat

Signed-off-by: Your Name <you@example.com>
```

The name and email must match your `git config user.name` and `user.email`. If you haven't set them:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

**Forgot to sign off?** Amend the last commit:

```bash
git commit --amend --signoff --no-edit
```

For older commits in the same branch:

```bash
git rebase --signoff main
```

### Why DCO instead of a CLA

CLAs require contributors to read, sign, and sometimes notarize a legal document before their first PR. That friction scares off casual contributors and slows down good work. DCO achieves the same legal goal — certification that you have the right to contribute — with a single line per commit that everybody can understand at a glance.

Projects that use DCO: the Linux kernel, Docker, Sigstore, Grafana, GitLab, CNCF projects, and most modern open-source infrastructure. ClawNex joins that tradition.

### CLA Clarification

**There is no Contributor License Agreement (CLA) for ClawNex.** DCO sign-off is sufficient. Contributors do NOT need to sign any additional legal document to have their contributions accepted. If a corporate policy requires a CLA before employees can contribute to OSS projects, contact `contact@clawnexai.com` to discuss.

---

## License

ClawNex is licensed under the **Apache License 2.0**. By contributing, you agree that your contributions will be licensed under the same terms. The Apache 2.0 license includes an explicit patent grant from every contributor, protecting downstream users from submarine patent claims.

The full license text will live in `LICENSE` at the repo root once the public cutover is complete.

---

## Security Disclosure Policy

**Security vulnerabilities MUST NOT be reported as public GitHub issues.** The coordinated disclosure process is documented in `SECURITY.md` at the repository root. In summary:

- Report vulnerabilities to the contact listed in `SECURITY.md`
- Include affected version, reproduction steps, and an assessment of impact
- Allow reasonable time (typically 30–90 days) for a coordinated fix before public disclosure
- Security reviewers triage within 5 business days per the Reviewer Expectations SLA above

For questions about whether a finding is security-sensitive, err on the side of private disclosure. If in doubt, email `security@clawnexai.com` rather than filing a public issue.

---

## What to Contribute

Contributions of all kinds are welcome:

- **Bug fixes** — if you find something broken, a fix is always welcome. Include a test if you can
- **Shield rules** — new jailbreak / exfiltration / cognitive tampering patterns. See `src/lib/shield/rules.ts` for the existing rule structure
- **Trust Boundary Audit rules** — new audit rules for the trust boundary engine (`src/lib/trust-audit/`)
- **Scheduled Reports** — new report types, delivery adapters, scheduling options (`src/lib/reports/`)
- **Custom Correlation Rules** — new rule templates, scoring models, condition types (`src/lib/correlations/`)
- **Connectors** — new agent-framework integrations alongside OpenClaw, LM Studio, Paperclip, Autensa (Hermes-Agent connector shipped in v0.5.4)
- **Panels and visualizations** — new dashboard tabs, better data viz, accessibility improvements
- **Documentation** — clarifications, corrections, tutorials, translations. Doc index runs 01–24 plus supplementary files
- **Tests** — shield test payloads, API test cases, integration tests
- **Performance** — profiling, query optimization, bundle size reduction
- **Accessibility** — keyboard navigation, screen reader compatibility, color contrast fixes

Before starting **large** contributions (new features, architectural changes, new modules), open an issue first to discuss the approach. That saves both of us wasted work.

### Key directories

- **RBAC / auth** — `src/lib/rbac/` and `src/app/api/auth/`
- **Operator management** — `src/app/api/config/operators/`
- When RBAC is enabled, **all new API routes MUST include `requireSession()` + `requirePermission()` guards**. Unguarded routes will be rejected in review.

---

## Development Setup

See the **Getting Started** section in `README.md` for the full setup. The short version:

```bash
git clone <repo-url> sentinel
cd sentinel

# Node side
npm install
npm run dev      # dev server on port 5001

# Python side (LiteLLM proxy + clawnex logger)
cd litellm
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..
```

Dashboard will be at <http://localhost:5001/>. A Welcome Wizard walks you through first-run setup.

Set `RBAC_ENABLED=true` in `.env` to enable operator authentication during development.

For deployment packaging, see `docs/12-deployment-guide.md`.

---

## Project Structure

ClawNex has an enterprise documentation suite — start here:

| Doc | When to read it |
|---|---|
| `docs/02-high-level-architecture.md` | First — 10-minute system overview |
| `docs/18-developer-manual.md` | Deep dive — every subsystem, every decision, every file |
| `docs/19-api-mcp-integration-guide.md` | Before touching the public API or MCP server |
| `docs/11-security-architecture.md` | Before touching the shield engine or break-glass |
| `docs/23-help-surfaces-index.md` | Before adding help content (tooltips, PANEL_HELP, chat, wizard, troubleshooting, docs) |
| `docs/20-product-roadmap.md` | To see what's planned and pick a direction |
| `docs/24-trust-boundary-audit.md` | Before contributing to the Trust Boundary Audit engine |

---

## Commit Style

- **Subject line:** imperative, present tense, under 72 characters ("Add tooltip to X", not "Added tooltip" or "Adds tooltip")
- **Body:** explain *why* the change is needed and any non-obvious *how*. Wrap at 80 columns
- **Reference issues:** include `Fixes #123` or `Refs #456` in the body when applicable
- **One logical change per commit:** don't mix unrelated refactors with feature work — it makes reverts painful
- **Sign off every commit** with `-s`

Example:

```
Fix hydration error when wrapping Stat in Tooltip

Stats render as <div> elements. The Tooltip primitive wrapped children
in <span> by default, producing <span><div></span> which violates HTML
nesting rules and triggers React's hydration guard — which Next.js
surfaces as a "missing required error components" white screen.

Added an `as="span" | "div"` prop to Tooltip. The "div" variant uses
`display: contents` on the wrapper so the child stays a direct layout
participant (preserves flex:1, grid placement, etc.) while still giving
the Tooltip a ref to attach its hover listeners to.

Refs #NNNN

Signed-off-by: Your Name <you@example.com>
```

---

## Code Style

- **TypeScript strict mode** is on — fix type errors, don't suppress with `any`
- **Prefer explicit types on exports** — internal functions can infer, public APIs should declare
- **Components use named exports** — `export function MyPanel()`, not `export default`
- **Two-space indentation**, single quotes for strings, trailing commas on multiline
- **Don't introduce new state management libraries** — React context + props is the convention
- **Don't add new CSS frameworks** — the design system is inline styles with the shared `C` / `F` / `G` tokens in `src/components/dashboard/constants.ts`

Run `npm run build` before pushing — the Next.js build catches most issues.

---

## Adding a New Shield Rule

1. Edit `src/lib/shield/rules.ts` and add a new rule object matching the existing structure (id, name, category, severity, regex, confidence weight)
2. Add a matching test payload to `src/lib/shield/test-payloads.ts`
3. If the rule belongs to a new category, update the category constants. (As of v0.10, the operator-visible rule listing lives in `PoliciesAndRulesCard` under Configuration → Shield & Detection — the legacy `PoliciesGuardsPanel` was removed when the policy framework shipped. New rules added to `ALL_RULES` show up in the `ClawNex Default` curated mirror automatically on next seed.)
4. Run `npm run dev` and verify the rule fires correctly in the Prompt Shield manual scanner
5. Add a line to `docs/13-release-notes.md` under the next unreleased version section

---

## Adding a New Panel

1. Create `src/components/dashboard/panels/YourPanel.tsx`
2. Export a function named `YourPanel` — take props explicitly (no context threading)
3. Add it to the `TabId` type in `src/components/dashboard/types.ts`
4. Add a `PANEL_HELP` entry in `src/components/dashboard/constants.ts` with title/desc/metrics/actions/related
5. Add a `NAV` entry in `constants.ts` so it appears in the sidebar
6. Import and wire into `src/components/dashboard/index.tsx`
7. Read `docs/23-help-surfaces-index.md` and make sure you're putting help content in the right place

---

## Reporting Issues

Bugs, feature requests, and questions go through GitHub issues (public repo cutover in progress). Please include:

- ClawNex version (from `/api/health`)
- What you were trying to do
- What you expected to happen
- What actually happened
- Reproduction steps
- Relevant logs from `~/sentinel/logs/` or the Infrastructure → Service Logs panel

For **security issues**, see `SECURITY.md` — do not file them as public GitHub issues.

---

## Code of Conduct

Be respectful, be constructive, be patient. This is a small project run by a small team; we'd like contributors to enjoy being here. Disagreements about technical decisions are fine and welcome — personal attacks are not.

A formal Code of Conduct based on the **Contributor Covenant v2.1** will be added at the public repository cutover (target: v0.7 release). Until then, the informal rules in this section apply. Enforcement contact at cutover will be `contact@clawnexai.com`.

Behaviors that are NOT acceptable in ClawNex contribution channels:

- Personal attacks or demeaning language directed at contributors
- Harassment, discrimination, or unwelcome conduct based on protected characteristics
- Publishing others' private information without permission
- Disruptive behavior that prevents others from contributing

Behaviors that ARE welcome:

- Technical disagreement, backed by reasoning
- Asking clarifying questions
- Reviewing each other's work directly
- Declining to work on something — "not for me" is a valid response

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-04-13 | ClawNex Engineering | Initial DCO and contribution guide |
| 1.1 | 2026-04-22 | ClawNex Engineering | Enterprise review: added Signed Commits policy (DCO required, GPG recommended), Security Disclosure pointer, First-Time Contributors guide, Reviewer Expectations SLA, CLA clarification, expanded Code of Conduct with Contributor Covenant target |
| 1.2 | 2026-04-22 | ClawNex Engineering | Version bump to v0.6.2-alpha |
| 1.3 | 2026-04-24 | ClawNex Engineering | Version bump to v0.9.0-alpha; covers multi-auth providers in scope. New providers (e.g. magic-link, SAML) follow the 7-step recipe in `docs/18-developer-manual.md` Multi-Auth Providers section. |

---

*Thanks for contributing to ClawNex.*
