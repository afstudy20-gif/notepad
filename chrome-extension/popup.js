const pageTitleEl = document.querySelector('#pageTitle');
const statusEl = document.querySelector('#status');
const noteListEl = document.querySelector('#noteList');
const searchEl = document.querySelector('#search');
const newNoteButton = document.querySelector('#newNote');

let sourceTabId = null;
let notes = [];
let saving = false;

init();

searchEl.addEventListener('input', renderNotes);
newNoteButton.addEventListener('click', () => saveToNotepad({ createNewNote: true }));

async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    sourceTabId = tab?.id || null;
    pageTitleEl.textContent = tab?.title || tab?.url || 'Aktif sayfa';

    const response = await chrome.runtime.sendMessage({ type: 'get-notes' });
    if (!response?.ok) throw new Error(response?.error || 'Notlar alınamadı');
    notes = Array.isArray(response.notes) ? response.notes : [];
    statusEl.textContent = notes.length ? 'Eklenecek notu seçin.' : 'Henüz not yok; yeni not oluşturabilirsiniz.';
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
  setStatus('Sayfa hazırlanıyor...', '');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'save-active-tab',
      sourceTabId,
      ...target
    });
    if (!response?.ok) throw new Error(response?.error || 'Kaydedilemedi');

    const extras = [];
    if (response.screenshotIncluded) extras.push('screenshot');
    if (response.pdfIncluded) extras.push('PDF');
    if (response.pdfDownloaded) extras.push('PDF indirildi');
    if (response.pdfLinkedOnly) extras.push('PDF adresi');
    setStatus(extras.length ? `Eklendi: ${extras.join(', ')}.` : 'Eklendi.', 'ok');
    setTimeout(() => window.close(), 650);
  } catch (error) {
    saving = false;
    newNoteButton.disabled = false;
    noteListEl.querySelectorAll('button').forEach(button => { button.disabled = false; });
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
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} hr ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} days ago`;
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
