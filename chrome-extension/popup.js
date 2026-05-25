const statusEl = document.querySelector('#status');
const retryButton = document.querySelector('#retry');

saveCurrentTab();

retryButton.addEventListener('click', saveCurrentTab);

async function saveCurrentTab() {
  retryButton.hidden = true;
  statusEl.dataset.state = '';
  statusEl.textContent = 'Aktif sekme, ekran görüntüsü ve varsa PDF hazırlanıyor...';

  try {
    const response = await chrome.runtime.sendMessage({ type: 'save-active-tab' });
    if (!response?.ok) throw new Error(response?.error || 'Kaydedilemedi');

    statusEl.dataset.state = 'ok';
    const extras = [];
    if (response.screenshotIncluded) extras.push('screenshot');
    if (response.pdfIncluded) extras.push('PDF');
    if (response.pdfDownloaded) extras.push('PDF indirildi');
    if (response.pdfLinkedOnly) extras.push('PDF adresi');
    const suffix = extras.length ? ` Hazırlananlar: ${extras.join(', ')}.` : '';
    statusEl.textContent = response.selectionRequired
      ? `Notepad açıldı. Hedef notu seçin.${suffix}`
      : (extras.length ? `Kaydedildi. Eklenenler: ${extras.join(', ')}.` : 'Kaydedildi. Bu sayfada ek dosya izni yoktu.');
  } catch (error) {
    statusEl.dataset.state = 'error';
    statusEl.textContent = error?.message || 'Kaydedilemedi.';
    retryButton.hidden = false;
  }
}
