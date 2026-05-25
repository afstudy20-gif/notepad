const DEFAULT_NOTEPAD_URL = 'https://not.drtr.uk/';
const NOTEPAD_URL_KEY = 'notepadUrl';

const input = document.querySelector('#notepadUrl');
const status = document.querySelector('#status');
const saveButton = document.querySelector('#save');

chrome.storage.sync.get(NOTEPAD_URL_KEY).then((stored) => {
  input.value = stored[NOTEPAD_URL_KEY] || DEFAULT_NOTEPAD_URL;
});

saveButton.addEventListener('click', async () => {
  try {
    const normalized = normalizeUrl(input.value);
    await chrome.storage.sync.set({ [NOTEPAD_URL_KEY]: normalized });
    input.value = normalized;
    status.textContent = 'Kaydedildi.';
  } catch (_) {
    status.textContent = 'Geçerli bir http veya https adresi girin.';
  }
});

function normalizeUrl(rawUrl) {
  const url = new URL(/^https?:\/\//i.test(rawUrl || '') ? rawUrl : `https://${rawUrl || ''}`);
  if (!/^https?:$/i.test(url.protocol)) throw new Error('Unsupported protocol');
  return url.toString();
}
