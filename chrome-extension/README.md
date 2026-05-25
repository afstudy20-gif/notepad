# Notepad Web Clipper

Chrome MV3 uzantısı. Araç çubuğundaki Notepad ikonuna basıldığında popup içinde Notepad not listeniz görünür; bir nota tıklayınca aktif sekmenin screenshot'ı, başlığı, URL'si ve sayfada PDF varsa PDF dosyası o nota eklenir. `.pdf` ile bitmeyen `showPdf` benzeri PDF endpoint'leri de denenir; dosya nota gömülemezse Chrome indirmelerine gönderilir.

## Kurulum

1. Chrome'da `chrome://extensions` sayfasını açın.
2. `Developer mode` seçeneğini açın.
3. ZIP indirdiyseniz dosyayı çıkarın.
4. `Load unpacked` ile `manifest.json` dosyasını içeren klasörü seçin.
5. İkona bastığınızda popup içinden eklemek istediğiniz notu seçin veya yeni not oluşturun.

## Notepad Adresi

Varsayılan adres `https://not.drtr.uk/`.

Yerelde test etmek için uzantının `Options` ekranında adresi örneğin `http://localhost:8000/` olarak değiştirin.
