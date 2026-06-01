#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# TruNorth → TestFlight ship script
# ─────────────────────────────────────────────────────────────────────────────
#
# Builds the web app, syncs to iOS, bumps the build number, archives via
# xcodebuild, exports the IPA, uploads to App Store Connect via altool.
#
# Prereqs (one-time, see docs/TruNorth-TestFlight-Setup.docx):
#   1. Apple Developer Program enrollment ($99/yr, paid + active)
#   2. App record created at appstoreconnect.apple.com (bundle com.trunorthapp.app)
#   3. App Store Connect API key created → put these in .env.testflight :
#        APP_STORE_CONNECT_KEY_ID=ABC123XYZ
#        APP_STORE_CONNECT_ISSUER_ID=00000000-1111-2222-3333-444444444444
#        APP_STORE_CONNECT_KEY_PATH=/path/to/AuthKey_ABC123XYZ.p8
#   4. (Optional) Override TEAM_ID + BUNDLE_ID via .env.testflight
#
# Usage:
#   ./scripts/ship-ios.sh              # auto-bump build number + ship
#   ./scripts/ship-ios.sh --skip-upload  # build + archive only, no upload
#   ./scripts/ship-ios.sh --version 1.1  # also set marketing version
#
# Idempotent. Safe to re-run. Each invocation auto-bumps the build number.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Load secrets from .env.testflight (git-ignored)
ENV_FILE="$ROOT/.env.testflight"
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
fi

# Defaults — overridable via .env.testflight
SCHEME="${SCHEME:-App}"
TEAM_ID="${TEAM_ID:-22SZQ6B763}"
BUNDLE_ID="${BUNDLE_ID:-com.trunorthapp.app}"
PROJECT="$ROOT/ios/App/App.xcodeproj"
PLIST="$ROOT/ios/App/App/Info.plist"
ARCHIVE_PATH="$ROOT/build/TruNorth-$(date -u +%Y%m%d-%H%M%S).xcarchive"
EXPORT_PATH="$ROOT/build/export"
EXPORT_OPTIONS="$ROOT/scripts/ExportOptions.plist"

SKIP_UPLOAD=false
NEW_VERSION=""
for arg in "$@"; do
  case "$arg" in
    --skip-upload) SKIP_UPLOAD=true ;;
    --version) shift; NEW_VERSION="${1:-}"; shift ;;
  esac
done

# ─── Step 0: Sanity checks ───────────────────────────────────────────────────
echo "🔍 Checking prerequisites..."
command -v xcodebuild >/dev/null || { echo "❌ Xcode not installed"; exit 1; }
command -v npm >/dev/null || { echo "❌ npm not installed"; exit 1; }
[[ -d "$PROJECT" ]] || { echo "❌ Xcode project not found at $PROJECT"; exit 1; }

if ! $SKIP_UPLOAD; then
  for var in APP_STORE_CONNECT_KEY_ID APP_STORE_CONNECT_ISSUER_ID APP_STORE_CONNECT_KEY_PATH; do
    if [[ -z "${!var:-}" ]]; then
      echo "❌ Missing $var. Add it to .env.testflight or run with --skip-upload."
      echo "   See docs/TruNorth-TestFlight-Setup.docx for the one-time setup."
      exit 1
    fi
  done
  [[ -f "$APP_STORE_CONNECT_KEY_PATH" ]] || { echo "❌ Key file not found: $APP_STORE_CONNECT_KEY_PATH"; exit 1; }
  # altool reads keys from a fixed set of dirs (~/.appstoreconnect/private_keys
  # is the canonical one). Stage a symlink so future uploads find it without
  # us having to remember to copy.
  ALTOOL_KEYS_DIR="$HOME/.appstoreconnect/private_keys"
  mkdir -p "$ALTOOL_KEYS_DIR"
  KEY_FILENAME="AuthKey_${APP_STORE_CONNECT_KEY_ID}.p8"
  if [[ ! -f "$ALTOOL_KEYS_DIR/$KEY_FILENAME" ]]; then
    cp "$APP_STORE_CONNECT_KEY_PATH" "$ALTOOL_KEYS_DIR/$KEY_FILENAME"
  fi
fi

# ─── Step 1: Build web + sync iOS ────────────────────────────────────────────
echo "📦 Building web bundle..."
npx vite build >/dev/null

echo "📲 Syncing to iOS..."
npx cap sync ios >/dev/null

# ─── Step 2: Bump build number (always); optionally bump version ─────────────
# 2026-06-01: must bump BOTH places. The Xcode "Generate Info.plist File"
# default uses CURRENT_PROJECT_VERSION from project.pbxproj as the build
# number at build time (Info.plist contains the $(CURRENT_PROJECT_VERSION)
# macro). PlistBuddy on Info.plist alone wasn't propagating to the IPA, so
# Apple kept rejecting uploads as duplicates of the prior real build.
CURRENT_BUILD=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$PLIST" 2>/dev/null || echo "0")
if ! [[ "$CURRENT_BUILD" =~ ^[0-9]+$ ]]; then CURRENT_BUILD=0; fi
PBXPROJ_BUILD=$(grep -m 1 "CURRENT_PROJECT_VERSION = " "$ROOT/ios/App/App.xcodeproj/project.pbxproj" | grep -oE "[0-9]+" | head -1)
if ! [[ "$PBXPROJ_BUILD" =~ ^[0-9]+$ ]]; then PBXPROJ_BUILD=0; fi
# Use whichever is higher as the source of truth, then bump.
HIGHER_BUILD=$(( CURRENT_BUILD > PBXPROJ_BUILD ? CURRENT_BUILD : PBXPROJ_BUILD ))
NEXT_BUILD=$((HIGHER_BUILD + 1))

# Write to BOTH places so Xcode's build phase agrees with our intent.
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $NEXT_BUILD" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleVersion string $NEXT_BUILD" "$PLIST"
sed -i '' "s/CURRENT_PROJECT_VERSION = [0-9]*;/CURRENT_PROJECT_VERSION = $NEXT_BUILD;/g" "$ROOT/ios/App/App.xcodeproj/project.pbxproj"

if [[ -n "$NEW_VERSION" ]]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $NEW_VERSION" "$PLIST" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string $NEW_VERSION" "$PLIST"
  sed -i '' "s/MARKETING_VERSION = [^;]*;/MARKETING_VERSION = $NEW_VERSION;/g" "$ROOT/ios/App/App.xcodeproj/project.pbxproj"
  echo "🏷  Version: $NEW_VERSION (build $NEXT_BUILD)"
else
  CURRENT_VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$PLIST" 2>/dev/null || echo "1.0")
  echo "🏷  Version: $CURRENT_VERSION (build $NEXT_BUILD)"
fi

# ─── Step 3: Archive ─────────────────────────────────────────────────────────
echo "🏗  Archiving (this takes ~3-5 min)..."
mkdir -p "$ROOT/build"
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE_PATH" \
  -allowProvisioningUpdates \
  -authenticationKeyID "$APP_STORE_CONNECT_KEY_ID" \
  -authenticationKeyIssuerID "$APP_STORE_CONNECT_ISSUER_ID" \
  -authenticationKeyPath "$APP_STORE_CONNECT_KEY_PATH" \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  archive \
  2>&1 | grep -E "^(error|warning|\*\* |Archive)" || true

if [[ ! -d "$ARCHIVE_PATH" ]]; then
  echo "❌ Archive failed. See full log: xcodebuild ... archive"
  exit 1
fi
echo "✅ Archive: $ARCHIVE_PATH"

# ─── Step 4: Export IPA ──────────────────────────────────────────────────────
echo "📤 Exporting IPA..."
cat > "$EXPORT_OPTIONS" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store-connect</string>
    <key>teamID</key>
    <string>$TEAM_ID</string>
    <key>signingStyle</key>
    <string>automatic</string>
    <key>stripSwiftSymbols</key>
    <true/>
    <key>uploadSymbols</key>
    <true/>
    <key>destination</key>
    <string>export</string>
</dict>
</plist>
EOF

xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -allowProvisioningUpdates \
  -authenticationKeyID "$APP_STORE_CONNECT_KEY_ID" \
  -authenticationKeyIssuerID "$APP_STORE_CONNECT_ISSUER_ID" \
  -authenticationKeyPath "$APP_STORE_CONNECT_KEY_PATH" \
  2>&1 | grep -E "^(error|warning|\*\* |Exported)" || true

IPA=$(find "$EXPORT_PATH" -name "*.ipa" | head -1)
[[ -f "$IPA" ]] || { echo "❌ IPA export failed"; exit 1; }
echo "✅ IPA: $IPA"

# ─── Step 5: Upload to App Store Connect ─────────────────────────────────────
if $SKIP_UPLOAD; then
  echo ""
  echo "✅ Build complete. IPA at: $IPA"
  echo "   --skip-upload was set; you can manually upload via Xcode Organizer if you want."
  exit 0
fi

echo "☁️  Uploading to App Store Connect..."
xcrun altool --upload-app \
  --type ios \
  --file "$IPA" \
  --apiKey "$APP_STORE_CONNECT_KEY_ID" \
  --apiIssuer "$APP_STORE_CONNECT_ISSUER_ID"

echo ""
echo "✅ DONE. Build $NEXT_BUILD uploaded."
echo "   Wait 5-15 min for Apple to process, then:"
echo "   → appstoreconnect.apple.com → My Apps → TruNorth → TestFlight"
echo "   → Internal testers see it within minutes, external need first-time review."
