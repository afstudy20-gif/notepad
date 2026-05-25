const statusEl = document.querySelector('#status');
const retryButton = document.querySelector('#retry');

saveCurrentTab();

retryButton.addEventListener('click', saveCurrentTab);

async function saveCurrentTab() {
  retryButton.hidden = true;
  statusEl.dataset.state = '';
  statusEl.textContent = 'Aktif sekme ve ekran görüntüsü not olarak ekleniyor...';

  try {
    const response = await chrome.runtime.sendMessage({ type: 'save-active-tab' });
    if (!response?.ok) throw new Error(response?.error || 'Kaydedilemedi');

    statusEl.dataset.state = 'ok';
    statusEl.textContent = response.screenshotIncluded
      ? 'Kaydedildi. Screenshot da nota eklendi.'
      : 'Kaydedildi. Bu sayfada screenshot izni yoktu.';
  } catch (error) {
    statusEl.dataset.state = 'error';
    statusEl.textContent = error?.message || 'Kaydedilemedi.';
    retryButton.hidden = false;
  }
}
