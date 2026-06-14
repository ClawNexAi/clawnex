<!--
Thanks for contributing to ClawNex! Quick checklist before you submit:

  • Sign your commits (`git commit -s`) — required by our DCO. The text it
    appends is your statement that you authored the change and grant it
    under Apache 2.0. See ./DCO and ./CONTRIBUTING.md.
  • Run `npm run lint` and `npm run build` locally before opening the PR.
  • If your change affects security posture (auth, RBAC, shield rules,
    audit log, secret handling), call that out explicitly in the
    "Security implications" section below.
-->

## Summary

<!-- 1–3 sentences. What does this change do, and why? Skip if obvious from
     the title. -->

## Linked issue

<!-- Closes #123 / Fixes #123 / Refs #123. Use "Closes" if merging this PR
     should auto-close the issue. -->

## Test plan

<!-- How did you verify this works? Concrete commands, scripts, or manual
     steps. "I ran the dashboard" is not enough — what did you click,
     what did you expect, what did you see? -->

- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] Manual smoke test described below
- [ ] No new console.log / debug output left in `src/`

## Screenshots / output

<!-- For UI changes, include before/after screenshots. For CLI / setup
     changes, paste the relevant terminal output. -->

## Security implications

<!-- Does this change auth flows, RBAC, the shield, the audit log, or
     anything that touches secrets? If yes, briefly describe the impact
     and what you did to verify the boundary still holds.
     If unsure: say "unsure" — a maintainer will check. -->

## DCO

By submitting this PR I confirm I have signed off every commit
(`git commit -s`) and that I have read [DCO](../DCO) and
[CONTRIBUTING.md](../CONTRIBUTING.md).
