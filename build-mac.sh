#!/bin/bash
# build-mac.sh — Build Local Whisper (Electron) and reset TCC
set -e

cd "$(dirname "$0")"

BUNDLE_ID="com.localwhisper.app"

echo "🔨 Building..."
npm run electron:build

echo ""
echo "🔑 Resetting microphone TCC permission (will re-prompt on next launch)..."
tccutil reset Microphone "$BUNDLE_ID" 2>/dev/null && echo "   ✅ TCC reset" || echo "   ⚠️  tccutil reset failed (may need sudo)"

echo ""
echo "✅ Build complete!"
echo ""
echo "   Output: dist/"
