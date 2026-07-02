# Agent Notes

- Security-sensitive correspondence, vulnerability reports, and coordinated disclosure questions go to `security@clawnexai.com`.
- All other project, support, legal, conduct, commercial, documentation, and general correspondence goes to `contact@clawnexai.com`.
- QA host access: the QA VPS is reachable over Tailscale at `100.123.63.73` as user `reoclaw`; public SSH to `qa.clawnexai.com:22` may time out and is not the normal deploy path.
- QA sudo credential location: source `/Users/joeybossman/.clawnex-secrets/crucible-sudo.env` when a privileged QA deploy is required. Do not copy the secret value into this file or into git.
- QA fresh deploy pattern: deploy from this product repo with `scripts/deploy-prod.sh --host reoclaw@100.123.63.73 --domain qa.clawnexai.com --no-preserve-data` and provide sudo via `SUDO_PASSWORD` / `--sudo-pass-env SUDO_PASSWORD`.
