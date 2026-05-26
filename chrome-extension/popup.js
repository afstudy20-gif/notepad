const pageTitleEl = document.querySelector('#pageTitle');
const statusEl = document.querySelector('#status');
const noteListEl = document.querySelector('#noteList');
const searchEl = document.querySelector('#search');
const newNoteButton = document.querySelector('#newNote');
const captureTextEl = document.querySelector('#captureText');
const pdfIndicator = document.querySelector('#pdfIndicator');
const optionCards = document.querySelectorAll('.option-card');

let sourceTabId = null;
let notes = [];
let saving = false;
let selectedOption = 'scroll'; // default

const captureTexts = {
  url: 'Sadece web sayfa adresi (URL) kaydedilecek.',
  viewport: 'Sayfa adresi ve ekran görüntüsü (visible) kaydedilecek.',
  scroll: 'Scroll screenshot alınacak ve seçilen nota eklenecek.',
  pdf: 'Sayfa adresi ve varsa sayfadaki PDF dosyası kaydedilecek.'
};

// 100% Bulletproof cross-version Promise wrapper for chrome extension messaging
function sendMessagePromise(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

init();

searchEl.addEventListener('input', renderNotes);
newNoteButton.addEventListener('click', () => saveToNotepad({ createNewNote: true }));

// Setup Option Cards
optionCards.forEach(card => {
  card.addEventListener('click', () => {
    if (saving) return;
    
    // Remove selected class from all cards
    optionCards.forEach(c => c.classList.remove('selected'));
    
    // Add selected class to clicked card
    card.classList.add('selected');
    selectedOption = card.dataset.option;
    
    // Update capture explanation text
    captureTextEl.textContent = captureTexts[selectedOption] || '';
    
    // Save to storage
    chrome.storage.local.set({ lastOptionType: selectedOption }).catch(() => {});
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'captureProgress') return;
  if (message.phase === 'capturing') {
    const total = message.total || 1;
    setStatus(`Scroll screenshot alınıyor ${message.current}/${total}...`, '');
  } else if (message.phase === 'stitching') {
    setStatus('Screenshot birleştiriliyor...', '');
  }
});

async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    sourceTabId = tab?.id || null;
    pageTitleEl.textContent = tab?.title || tab?.url || 'Aktif sayfa';

    // Load last option type
    const stored = await chrome.storage.local.get('lastOptionType');
    if (stored.lastOptionType) {
      selectedOption = stored.lastOptionType;
      // Update UI selection
      optionCards.forEach(c => {
        if (c.dataset.option === selectedOption) {
          c.classList.add('selected');
        } else {
          c.classList.remove('selected');
        }
      });
      captureTextEl.textContent = captureTexts[selectedOption] || '';
    }

    // Detect PDF directly from popup.js using activeTab scripting
    if (pdfIndicator && sourceTabId && tab && /^https?:\/\//i.test(tab.url)) {
      pdfIndicator.className = 'pdf-indicator scanning';
      
      chrome.scripting.executeScript({
        target: { tabId: sourceTabId },
        func: () => {
          const pageUrl = window.location.href;
          const selectors = [
            'embed[type*="pdf" i][src]',
            'object[type*="pdf" i][data]',
            'iframe[src*=".pdf" i]',
            'a[href*=".pdf" i]'
          ];
          const found = [];
          for (const selector of selectors) {
            for (const el of document.querySelectorAll(selector)) {
              const raw = el?.src || el?.href || el?.data || el?.getAttribute('src') || el?.getAttribute('href') || el?.getAttribute('data');
              if (raw) {
                try {
                  found.push(new URL(raw, pageUrl).href);
                } catch (_) {}
              }
            }
          }
          if (/\.pdf(?:$|[?#])/i.test(pageUrl)) {
            found.push(pageUrl);
          }
          return found;
        }
      }).then(results => {
        const pdfUrls = results?.[0]?.result || [];
        if (pdfUrls.length > 0) {
          pdfIndicator.className = 'pdf-indicator detected';
          const pdfCard = document.querySelector('.option-card[data-option="pdf"]');
          if (pdfCard) {
            pdfCard.title = `Sayfada ${pdfUrls.length} PDF adresi tespit edildi!`;
          }
        } else {
          pdfIndicator.className = 'pdf-indicator';
        }
      }).catch(err => {
        console.warn('[notepad-clipper] PDF detection failed', err);
        pdfIndicator.className = 'pdf-indicator';
      });
    } else if (pdfIndicator) {
      pdfIndicator.className = 'pdf-indicator';
    }

    const response = await sendMessagePromise({ type: 'get-notes' });
    if (!response?.ok) throw new Error(response?.error || 'Notlar alınamadı');
    notes = Array.isArray(response.notes) ? response.notes : [];
    
    statusEl.textContent = notes.length
      ? 'Kayıt türü seçip istediğiniz nota veya yeni nota kaydedebilirsiniz.'
      : 'Henüz not yok; yeni not oluşturarak kaydedebilirsiniz.';
    renderNotes();
  } catch (error) {
    setStatus(error?.message || 'Notlar alınamadı.', 'error');
    noteListEl.innerHTML = '<div class="empty">Notepad listesi yüklenemedi.</div>';
  }
}

function renderNotes() {
  const query = searchEl.value.trim().toLowerCase();
  const visible = notes.filter(note => {
    if (!query) return true;
    return `${note.title || ''} ${note.preview || ''}`.toLowerCase().includes(query);
  });

  if (!visible.length) {
    noteListEl.innerHTML = '<div class="empty">Not bulunamadı.</div>';
    return;
  }

  noteListEl.innerHTML = visible.map(note => `
    <button class="note${note.active ? ' active' : ''}" data-note-id="${escapeAttribute(note.id)}" title="${escapeAttribute(note.title || '')}">
      <span class="box" aria-hidden="true"></span>
      <span>
        <span class="title">${escapeHtml(note.title || 'İsimsiz Not')}</span>
        <span class="preview">${escapeHtml(note.preview || 'Boş not')}</span>
        <span class="time">${formatTime(note.updated)}</span>
      </span>
    </button>
  `).join('');

  noteListEl.querySelectorAll('[data-note-id]').forEach(button => {
    button.addEventListener('click', () => saveToNotepad({ targetNoteId: button.dataset.noteId }));
  });
}

async function saveToNotepad(target) {
  if (saving) return;
  saving = true;
  newNoteButton.disabled = true;
  noteListEl.querySelectorAll('button').forEach(button => { button.disabled = true; });
  optionCards.forEach(card => card.style.opacity = '0.6');
  setStatus('İçerik hazırlanıyor...', '');

  try {
    const response = await sendMessagePromise({
      type: 'save-active-tab',
      sourceTabId,
      optionType: selectedOption,
      ...target
    });
    if (!response?.ok) throw new Error(response?.error || 'Kaydedilemedi');

    const extras = [];
    if (response.screenshotIncluded) extras.push('screenshot');
    if (response.pdfIncluded) extras.push('PDF');
    if (response.pdfDownloaded) extras.push('PDF indirildi');
    if (response.pdfLinkedOnly) extras.push('PDF adresi');
    const nonScreenshotExtras = extras.filter(item => item !== 'screenshot');
    
    let successText = 'Başarıyla Notepad\'e eklendi.';
    if (selectedOption === 'scroll') {
      const screenshotText = response.screenshotMode === 'scroll'
        ? 'Scroll screenshot nota eklendi'
        : 'Scroll alınamadı; Görünen alan eklendi';
      successText = response.screenshotIncluded
        ? `${screenshotText}${nonScreenshotExtras.length ? `. Eklenenler: ${nonScreenshotExtras.join(', ')}.` : '.'}`
        : (extras.length ? `Eklendi: ${extras.join(', ')}.` : 'Eklendi; scroll screenshot alınamadı.');
    } else if (selectedOption === 'viewport') {
      successText = response.screenshotIncluded
        ? 'Ekran görüntüsü ve adres nota eklendi.'
        : 'Adres eklendi, ekran görüntüsü alınamadı.';
    } else if (selectedOption === 'pdf') {
      if (response.pdfIncluded || response.pdfDownloaded || response.pdfLinkedOnly) {
        successText = `PDF dosyası ve adres nota eklendi (${extras.join(', ')}).`;
      } else {
        successText = 'Sayfada PDF bulunamadı, sadece sayfa adresi kaydedildi.';
      }
    } else if (selectedOption === 'url') {
      successText = 'Sayfa adresi başarıyla kaydedildi.';
    }

    setStatus(successText, 'ok');
    setTimeout(() => window.close(), 1000);
  } catch (error) {
    saving = false;
    newNoteButton.disabled = false;
    noteListEl.querySelectorAll('button').forEach(button => { button.disabled = false; });
    optionCards.forEach(card => card.style.opacity = '1');
    setStatus(error?.message || 'Kaydedilemedi.', 'error');
  }
}

function setStatus(text, state) {
  statusEl.textContent = text;
  statusEl.dataset.state = state || '';
}

function formatTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'Az önce';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} dk önce`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} sa önce`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} gün önce`;
  return new Date(ts).toLocaleDateString();
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value || '');
  return div.innerHTML;
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
