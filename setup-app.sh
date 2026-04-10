#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Local Whisper — Tauri App Setup
# Run once to install JS and Rust dependencies.
#
# Prerequisites:
#   brew install node rust
#   xcode-select --install
# ─────────────────────────────────────────────────────────────────────────────

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔧 Setting up Local Whisper Tauri app..."
echo ""

# Check Node
if ! command -v node &>/dev/null; then
  echo "❌ Node.js not found. Install via: brew install node"
  exit 1
fi
echo "✅ Node $(node -v)"

# Check Rust
if ! command -v cargo &>/dev/null; then
  echo "❌ Rust not found. Install via: curl https://sh.rustup.rs -sSf | sh"
  exit 1
fi
echo "✅ Rust $(rustc --version)"

# Generate placeholder tray icons (tiny 22x22 PNG)
# Replace these with real assets before shipping!
echo "🖼️  Generating placeholder icons..."
mkdir -p src-tauri/icons

# Use sips (built-in macOS) or Python to create a minimal PNG
python3 - <<'PYEOF'
import struct, zlib, os

def make_png(size, color=(80, 80, 80)):
    """Create a minimal solid-color PNG."""
    def chunk(name, data):
        c = zlib.crc32(name + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + name + data + struct.pack(">I", c)

    r, g, b = color
    raw = b"".join(b"\x00" + bytes([r, g, b]) * size for _ in range(size))
    compressed = zlib.compress(raw, 9)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", compressed)
        + chunk(b"IEND", b"")
    )

icons_dir = "src-tauri/icons"
sizes = {
    "32x32.png":       (32,  (80, 80, 80)),
    "128x128.png":     (128, (80, 80, 80)),
    "128x128@2x.png":  (256, (80, 80, 80)),
    "tray-idle.png":   (22,  (80, 80, 80)),
    "tray-record.png": (22,  (220, 50, 50)),
}

for name, (size, color) in sizes.items():
    path = os.path.join(icons_dir, name)
    with open(path, "wb") as f:
        f.write(make_png(size, color))
    print(f"   {name}")
PYEOF

# Copy tray-idle as icon.png placeholder for .icns / .ico
cp src-tauri/icons/128x128.png src-tauri/icons/icon.png 2>/dev/null || true

echo ""
echo "📦 Installing npm dependencies..."
npm install

echo ""
echo "🦀 Fetching Rust crates (first time takes a minute)..."
cd src-tauri && cargo fetch && cd ..

echo ""
echo "✅ Setup complete!"
echo ""
echo "─────────────────────────────────────────────────────"
echo "  1. Start the Python sidecar first (in another tab):"
echo "     cd ../sidecar && source .venv/bin/activate && python sidecar.py"
echo ""
echo "  2. Then launch the Tauri app in dev mode:"
echo "     npm run tauri dev"
echo "─────────────────────────────────────────────────────"
echo ""
echo "⚠️  On first run you'll be prompted to grant:"
echo "   • Microphone access"
echo "   • Accessibility access (needed for Cmd+V paste)"
