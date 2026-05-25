# Notepad Web Clipper

Chrome MV3 uzantısı. Araç çubuğundaki Notepad ikonuna basıldığında aktif sekmenin başlığını, URL'sini, görünen ekran görüntüsünü ve sayfada PDF varsa PDF dosyasını Notepad'e yeni not olarak ekler. `.pdf` ile bitmeyen `showPdf` benzeri PDF endpoint'leri de denenir.

## Kurulum

1. Chrome'da `chrome://extensions` sayfasını açın.
2. `Developer mode` seçeneğini açın.
3. ZIP indirdiyseniz dosyayı çıkarın.
4. `Load unpacked` ile `manifest.json` dosyasını içeren klasörü seçin.
5. İkona bastığınızda mevcut sayfa Notepad'e kaydedilir ve küçük durum penceresi açılır.

## Notepad Adresi

Varsayılan adres `https://not.drtr.uk/`.

Yerelde test etmek için uzantının `Options` ekranında adresi örneğin `http://localhost:8000/` olarak değiştirin.
