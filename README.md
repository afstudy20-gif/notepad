# Notepad — Local-Only Online Editor

Live: **https://not.drtr.uk/**

A browser-based rich-text notepad. All notes live in `localStorage` — nothing is ever uploaded. Works offline as a PWA.

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
- **Chrome extension** — save the current tab URL into Notepad with one click
- **Refresh button** — clears this app's cache and reloads (notes preserved, other sites unaffected)
- **Mobile-friendly** — bottom-sheet image panel, touch-sized handles, slide-in sidebar
- **Keyboard shortcuts** — Ctrl+S (save), Ctrl+P (print), Ctrl+H (find & replace), Ctrl+Alt+N (new note)

## Privacy

No notes or images are uploaded. All OCR and format conversions run client-side. Only the CDN libraries (mammoth, xlsx, pdf.js, tesseract, paddleocr, html2pdf, html-docx-js) are fetched once over the network.

## Run locally

```bash
# Vanilla — any static server works
python3 -m http.server 8000
# or
npx serve .
```

Open `http://localhost:8000`. Service worker requires HTTPS in production; localhost is exempt.

## Chrome extension

Load `chrome-extension/` as an unpacked extension from `chrome://extensions`, or download `notepad-web-clipper.zip` from the install area in the app. By default it saves pages to `https://not.drtr.uk/`; change the target Notepad URL from the extension's Options page when testing locally, for example `http://localhost:8000/`.

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
