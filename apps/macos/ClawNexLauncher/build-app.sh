#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PACKAGE="$ROOT/apps/macos/ClawNexLauncher"
OUTPUT="${1:-$ROOT/dist}"
APP="$OUTPUT/ClawNex Launcher.app"

# Some Command Line Tools releases leave the unversioned SDK symlink ahead of
# their Swift compiler. The stable macOS 15 SDK still targets our macOS 13
# minimum and avoids coupling the app to that host-only mismatch.
if [ -d /Library/Developer/CommandLineTools/SDKs/MacOSX15.sdk ]; then
  export SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX15.sdk
fi
export CLANG_MODULE_CACHE_PATH="${CLANG_MODULE_CACHE_PATH:-${TMPDIR:-/tmp}/clawnex-launcher-clang-cache}"
export SWIFTPM_MODULECACHE_OVERRIDE="${SWIFTPM_MODULECACHE_OVERRIDE:-${TMPDIR:-/tmp}/clawnex-launcher-swift-cache}"

swift build -c release --package-path "$PACKAGE"
BIN_DIR="$(swift build -c release --package-path "$PACKAGE" --show-bin-path)"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$BIN_DIR/ClawNexLauncher" "$APP/Contents/MacOS/ClawNexLauncher"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDisplayName</key><string>ClawNex Launcher</string>
  <key>CFBundleExecutable</key><string>ClawNexLauncher</string>
  <key>CFBundleIdentifier</key><string>ai.clawnex.launcher</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>ClawNex Launcher</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSAppleEventsUsageDescription</key><string>ClawNex opens inspected coding sessions in Terminal.</string>
</dict></plist>
PLIST
chmod 755 "$APP/Contents/MacOS/ClawNexLauncher"
codesign --force --deep --sign - "$APP"
printf 'Built %s\n' "$APP"
