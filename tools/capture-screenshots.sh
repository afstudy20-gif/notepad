#!/usr/bin/env bash
# Capture PWA screenshots using headless Chrome (no Node deps).
# Prereq: app served on http://localhost:8000 (e.g. `python3 -m http.server 8000`).
# Usage from repo root:
#   ./tools/capture-screenshots.sh
set -euo pipefail

URL="${NOTEPAD_URL:-http://localhost:8000/index.html}"

# Locate Chrome
if [[ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]]; then
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
elif command -v google-chrome >/dev/null; then
  CHROME="$(command -v google-chrome)"
elif command -v chromium >/dev/null; then
  CHROME="$(command -v chromium)"
elif command -v chrome >/dev/null; then
  CHROME="$(command -v chrome)"
else
  echo "Chrome not found. Install Google Chrome or set CHROME env var." >&2
  exit 1
fi

mkdir -p screenshots

echo "Capturing desktop-wide.png (1280x720)..."
"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --window-size=1280,720 --virtual-time-budget=2000 \
  --screenshot="$PWD/screenshots/desktop-wide.png" "$URL" >/dev/null 2>&1

echo "Capturing mobile-narrow.png (640x1280)..."
"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --window-size=640,1280 --virtual-time-budget=2000 \
  --screenshot="$PWD/screenshots/mobile-narrow.png" "$URL" >/dev/null 2>&1

echo "Done."
ls -lh screenshots/
