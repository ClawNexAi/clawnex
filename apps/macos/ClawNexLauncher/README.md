# ClawNex Launcher for macOS

A menu-bar interface for starting inspected coding sessions without opening the ClawNex dashboard.

The app is deliberately thin. It reads the versioned, secret-free state returned by:

```bash
clawnex launcher snapshot --json
```

It launches the selected harness through the existing `clawnex run` command. Model validation, LiteLLM authentication, signed routing identity, Shield inspection, and temporary harness adapters remain inside the cross-platform ClawNex CLI.

Build the app on macOS 13 or newer:

```bash
bash apps/macos/ClawNexLauncher/build-app.sh
open "dist/ClawNex Launcher.app"
```

Install it for the current user:

```bash
bash apps/macos/ClawNexLauncher/build-app.sh "$HOME/Applications"
open "$HOME/Applications/ClawNex Launcher.app"
```

The macOS package contains only UI and Terminal integration. A future Linux tray or Windows system-tray client can consume the same CLI snapshot and launch contract.

The launcher discovers supported coding harnesses on the selected ClawNex target and shows only the ones that are installed. On macOS it discovers Ghostty when present and always offers Apple Terminal; Automatic prefers Ghostty and safely falls back to Apple Terminal. Remote targets are contacted on demand over SSH and do not require an already-open terminal session.
