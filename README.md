# Notepad — Yerel-Only / Local-Only Online Editor

Live: **https://not.drtr.uk/**

Tarayıcıda çalışan, hiçbir veriyi sunucuya yüklemeyen zengin metin editörü. Notlar `localStorage` içinde saklanır; ağ bağlantısı olmadan da çalışır (PWA).

A browser-based rich-text notepad. All notes live in `localStorage` — nothing is ever uploaded. Works offline as a PWA.

---

## Features

- **Yerel saklama / Local storage** — tüm veriler tarayıcıda, sıfır sunucu
- **Çoklu format içe aktarma / Multi-format import** — TXT · Markdown · Word (.docx) · Excel (.xlsx/.csv) · PDF · Resim (OCR)
- **OCR** — PaddleOCR (hızlı, WASM) veya Tesseract (TR daha iyi)
- **Resim editörü / Image editor** — yeniden boyutla, kırp, döndür, çevir, parlaklık/kontrast/doygunluk filtreleri, sanatsal efektler (gri, sepya, invert)
- **Word-style metin kaydırma / Text wrapping** — inline · square · tight · top/bottom · behind · in front
- **Çıktı / Export** — .txt · PDF (html2pdf) · Word (.docx)
- **Paylaş / Share** — Web Share API · WhatsApp · E-posta · PDF eki ile e-posta/WhatsApp
- **Yedekleme / Backup** — JSON dışa/içe aktarma, SQL dump, e-posta ile JSON gönderme
- **Sayfa modu / Page mode** — A3/A4/A5/Letter/Legal · dikey/yatay
- **Bul-değiştir / Find & Replace** · **Yazdır / Print**
- **Dil seçimi / Language toggle** — TR / EN (otomatik tarayıcı dilinden seçilir, manuel değiştirilebilir)
- **PWA** — yüklenebilir uygulama, çevrimdışı çalışır
- **Klavye kısayolları / Keyboard shortcuts** — Ctrl+S (kaydet), Ctrl+P (yazdır), Ctrl+H (bul-değiştir), Ctrl+Alt+N (yeni not)

## Privacy

Hiçbir not ya da resim sunucuya yüklenmez. Tüm OCR ve format dönüşümleri tarayıcıda çalışır. Yalnızca CDN üzerinden bir kerelik yüklenen kütüphaneler (mammoth, xlsx, pdf.js, tesseract, paddleocr, html2pdf, html-docx-js) ağdan indirilir.

No notes or images are uploaded. All OCR and format conversions run client-side. Only the CDN libraries (mammoth, xlsx, pdf.js, tesseract, paddleocr, html2pdf, html-docx-js) are fetched once over the network.

## Yerel çalıştırma / Run locally

```bash
# Vanilla — herhangi bir static server yeterli
python3 -m http.server 8000
# veya / or
npx serve .
```

Sonra tarayıcıdan `http://localhost:8000` aç. Servis çalışanı (PWA) için HTTPS gerekir; localhost istisnadır.

Open `http://localhost:8000`. Service worker requires HTTPS in production; localhost is exempt.

## Deploy

Statik bir host (Cloudflare Pages, Netlify, GitHub Pages, Vercel, kendi sunucun) yeterli. Build adımı yok.

Any static host works. No build step.

## Stack

- Vanilla HTML/CSS/JS — no framework
- Yerel tek dosya app.js + style.css + index.html
- CDN bağımlılıkları sadece çağrıldıklarında yüklenir
- Service worker network-first cache stratejisi

## Tarayıcı desteği / Browser support

Modern Chrome, Firefox, Safari, Edge. PWA install ve `navigator.share` Web Share API destekleyen tarayıcılarda çalışır.

## License

MIT
