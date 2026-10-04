#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PACKAGE="$ROOT/apps/macos/ClawNexLauncher"
OUTPUT="${1:-$ROOT/dist}"
APP="$OUTPUT/ClawNex Launcher.app"
ICON_SOURCE="$ROOT/public/clawnex-icon-dark.png"

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
mkdir -p "$APP/Contents/Resources"
cp "$BIN_DIR/ClawNexLauncher" "$APP/Contents/MacOS/ClawNexLauncher"
cp "$ROOT/public/clawnex-icon-dark.png" "$APP/Contents/Resources/ClawNexIcon.png"
cp "$ROOT/public/clawnex-icon.png" "$APP/Contents/Resources/ClawNexMenuBarIcon.png"

ICONSET="${TMPDIR:-/tmp}/clawnex-launcher.iconset"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$ICON_SOURCE" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$ICON_SOURCE" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/ClawNexIcon.icns"
rm -rf "$ICONSET"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDisplayName</key><string>ClawNex Launcher</string>
  <key>CFBundleExecutable</key><string>ClawNexLauncher</string>
  <key>CFBundleIdentifier</key><string>ai.clawnex.launcher</string>
  <key>CFBundleIconFile</key><string>ClawNexIcon</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>ClawNex Launcher</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><false/>
  <key>NSAppleEventsUsageDescription</key><string>ClawNex opens inspected coding sessions in Apple Terminal when selected.</string>
</dict></plist>
PLIST
chmod 755 "$APP/Contents/MacOS/ClawNexLauncher"
codesign --force --deep --sign - "$APP"
printf 'Built %s\n' "$APP"
