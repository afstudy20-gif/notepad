# Not — Browser-First Online Editor

Live: **https://not.drtr.uk/**

A browser-based rich-text note app. Notes live in `localStorage` by default, with optional Google Drive sync. Works offline as a PWA.

---

## Features

- **Local storage** — all data stays in the browser, zero server
- **Multi-format import** — TXT · Markdown · Word (.docx) · Excel (.xlsx/.csv) · PDF · Image (OCR)
- **OCR** — PaddleOCR (fast, WASM) or Tesseract (better Turkish recognition)
- **Image editor** — resize, crop, rotate, flip, brightness/contrast/saturation filters, artistic effects (grayscale, sepia, invert)
- **Word-style text wrapping** — inline · square · tight · top/bottom · behind · in front
- **Export** — .txt · PDF (html2pdf) · Word (.docx)
- **Share** — Web Share API · WhatsApp · Email · Email/WhatsApp with PDF attachment
- **Backup** — JSON export/import, SQL dump, send JSON via email
- **Page mode** — A3/A4/A5/Letter/Legal · portrait/landscape
- **Find & Replace** · **Print**
- **Language toggle** — TR / EN (auto-detected from browser locale, manually switchable)
- **PWA** — installable app, works offline
- **Chrome extension** — save the current tab URL, screenshot, and detected PDF into Notepad with one click
- **Refresh button** — clears this app's cache and reloads (notes preserved, other sites unaffected)
- **Mobile-friendly** — bottom-sheet image panel, touch-sized handles, slide-in sidebar
- **Keyboard shortcuts** — Ctrl+S (save), Ctrl+P (print), Ctrl+H (find & replace), Ctrl+Alt+N (new note)

## Privacy

By default notes and images stay in your browser's local storage — nothing is uploaded. OCR and format conversions run client-side; only the CDN libraries (mammoth, xlsx, pdf.js, tesseract, paddleocr, html2pdf, html-docx-js) and, for OCR, their model files are fetched over the network.

**If you enable Google Drive sync**, your notes are uploaded to your own Google Drive (the app's private `appDataFolder`) so they sync across devices. The app requests only the `drive.appdata` scope plus your basic profile/email — it cannot see the rest of your Drive. Leave sync off to keep everything local.

**The optional Chrome extension**, when you click it on a page, sends that page's URL, selected text, screenshot, and any detected PDF into Notepad. It only acts on the tab you invoke it on.

## Run locally

```bash
# Vanilla — any static server works
python3 -m http.server 8000
# or
npx serve .
```

Open `http://localhost:8000`. Service worker requires HTTPS in production; localhost is exempt.

## Chrome extension

Load `chrome-extension/` as an unpacked extension from `chrome://extensions`, or download `notepad-web-clipper.zip` from the install area in the app, unzip it, and select the extracted folder that contains `manifest.json`. By default it saves the current page URL, screenshot, and detected PDF to `https://not.drtr.uk/`; change the target Notepad URL from the extension's Options page when testing locally, for example `http://localhost:8000/`.

## Deploy

Any static host (Cloudflare Pages, Netlify, GitHub Pages, Vercel, your own server). No build step.

## Stack

- Vanilla HTML/CSS/JS — no framework
- Single-file `app.js` + `style.css` + `index.html`
- CDN dependencies loaded only when needed (lazy)
- Service worker with network-first caching strategy

## Browser support

Modern Chrome, Firefox, Safari, Edge. PWA install and `navigator.share` Web Share API work in browsers that support them.

## Author

Dr. Yusuf Hoşoğlu — [drtr.uk](https://drtr.uk)

Other tools:
- [uStat — Biostatistics](https://ustat.drtr.uk/)
- [Academic Flow Designer](https://flow.drtr.uk/)
- [NeoDW — DICOM Viewer](https://neodw.drtr.uk/)

## License

MIT
