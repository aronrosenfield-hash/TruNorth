#!/bin/bash
# TruNorth dual-simulator test script
# Usage: ./test-sims.sh [url-path]
# Example: ./test-sims.sh /               (default: main app)
# Example: ./test-sims.sh /skip.html      (skip onboarding first)

SMALL="D1C9CA45-4971-4F5A-A02D-9285E5219070"   # iPhone 17e  (small)
LARGE="C1CC4BC8-30E8-417F-B29A-136C4BB10401"   # iPhone 17 Pro Max (large)
BASE="http://localhost:5173"
PATH_ARG="${1:-/skip.html}"
URL="$BASE$PATH_ARG"

echo "📱 TruNorth Simulator Test"
echo "   Small : iPhone 17e"
echo "   Large : iPhone 17 Pro Max"
echo "   URL   : $URL"
echo ""

# Boot sims if needed
for UDID in $SMALL $LARGE; do
  STATE=$(xcrun simctl list devices | grep $UDID | grep -o "Booted\|Shutdown")
  if [ "$STATE" != "Booted" ]; then
    echo "⏳ Booting $UDID..."
    xcrun simctl boot $UDID 2>/dev/null
  fi
done

# Open Simulator app
open -a Simulator 2>/dev/null

# Navigate both to URL
echo "🌐 Opening $URL on both simulators..."
xcrun simctl openurl $SMALL "$URL" 2>/dev/null &
xcrun simctl openurl $LARGE "$URL" 2>/dev/null &
wait

echo "⏳ Waiting for page to load..."
sleep 5

# Screenshot both
xcrun simctl io $SMALL screenshot /tmp/trunorth_small.png 2>/dev/null && echo "✅ Small screenshot saved → /tmp/trunorth_small.png"
xcrun simctl io $LARGE screenshot /tmp/trunorth_large.png 2>/dev/null && echo "✅ Large screenshot saved → /tmp/trunorth_large.png"

# Open both screenshots side by side
open /tmp/trunorth_small.png /tmp/trunorth_large.png

echo ""
echo "Done! Screenshots opened in Preview."
