# Screenshots

Manifest references two PNGs in this folder. Used by Chrome install dialog, Android Edge install UI, and Play Store listing.

## Required files

| File | Size | Form factor |
|------|------|------------|
| `desktop-wide.png` | 1280×720 | wide |
| `mobile-narrow.png` | 640×1280 | narrow |

## Capture options

### A. Automatic (Playwright)
```sh
# From repo root
python3 -m http.server 8000 &
npx --yes playwright install chromium
node tools/capture-screenshots.mjs
kill %1   # stop the http server
git add screenshots/*.png
```

### B. Manual
Open `https://not.drtr.uk/` in Chrome:
1. DevTools (F12) → Device Toolbar (Ctrl+Shift+M)
2. Set viewport to **1280×720** → take screenshot → save as `desktop-wide.png`
3. Set viewport to **640×1280** → take screenshot → save as `mobile-narrow.png`
4. Drop both PNGs in `screenshots/` and commit

## After updating

1. Bump SW VERSION in `sw.js` so cached old shots evict
2. Re-deploy
3. PWABuilder.com → re-analyze → screenshots check turns green
