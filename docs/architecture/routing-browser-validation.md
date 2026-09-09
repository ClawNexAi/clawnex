# Routing browser validation — 2026-09-08

Source production build: `oUbdB01COJ8ybiab7pFFP`, package v0.15.5-alpha,
uncommitted `feature/routing-reconciliation` worktree based on `f330839`.
Browser ran the actual dashboard against disposable tool files and database at
loopback port 15001, not the installed dashboard at port 5001.

## Observed results

| Check | Result |
| --- | --- |
| Shared OpenClaw/Hermes controls | Same placement; provider-wide choices and expandable model details |
| Unsupported route | Disabled, unchanged, explicitly partial coverage |
| Missing model readiness | Review displays prerequisites; no agent-file apply is offered |
| Restore confirmation | Foreground body portal, explicit instance/scope, preserved-edit warning, no automatic restart |
| Keyboard | Starts on Cancel; Shift+Tab reaches disclosure then wraps to confirmation; Escape closes and returns focus to originating Restore button |
| Desktop 1440×1000 | Routing content and actions visible without overlap |
| Tablet 768×1024 | Routing command row wraps and controls remain reachable |

The browser test caught and fixed focus loss after asynchronous plan preparation
disabled the originating button. The dialog now receives that original focus
target explicitly. The browser skill supplied the real rendered evidence;
shared React facilities keep both tools consistent.

## Real dashboard screenshots

- [OpenClaw prerequisites and exclusions](routing-browser-evidence/openclaw-prerequisites.png)
- [Hermes shared workflow](routing-browser-evidence/hermes-workflow.png)
- [Foreground restoration dialog](routing-browser-evidence/restore-confirmation.png)
- [Tablet command-row wrapping](routing-browser-evidence/tablet-workflow.png)

These contain synthetic fixture providers, not live route status. The fixture
has no running upstream, hence service-down/bypass indicators in the surrounding
dashboard must not be interpreted as production observations.

## Boundaries and existing findings

This is not a full-dashboard mobile certification. At 375px the existing fixed
sidebar/header constrain the content; the global header also clips at tablet
width. The new routing row wraps, but the surrounding shell needs a separate
responsive-layout change. Two existing dashboard inline style elements produce
CSP console violations on a fresh production load; no CSP relaxation was made.
Connection-refused messages during fixture restarts were test-server downtime,
not live-service failures. Do not claim a clean whole-dashboard console.

Successful apply/restore, stale-plan and exact-instance verification states are
covered by executable API/native-proxy tests in
[implementation evidence](routing-implementation-progress.md). Actual user-agent
conversations and the installed-build operator walkthrough remain release
acceptance checks requiring separately approved deployment/restarts.
