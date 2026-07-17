(() => {
  console.log('[init] app.js v28 starting');
  window.addEventListener('error', (e) => console.error('[GLOBAL ERROR]', e.error || e.message, e.filename, e.lineno));
  const STORAGE_KEY = 'notepad_notes';
  const ACTIVE_KEY = 'notepad_active';

  const $ = (sel) => document.querySelector(sel);
  const editor = $('#editor');
  const noteTitle = $('#noteTitle');
  const noteList = $('#noteList');
  const searchInput = $('#searchInput');
  const wordCountEl = $('#wordCount');
  const charCountEl = $('#charCount');
  const saveStatusEl = $('#saveStatus');
  const fileInput = $('#fileInput');

  let notes = [];
  let activeId = null;
  let saveTimeout = null;
  let lastSaveError = null;
let quotaAlerted = false;
  let copiedFormat = null;
  let formatPainterActive = false;
  const ZOOM_KEY = 'notepad_zoom';
  const FORMAT_MARKS_KEY = 'notepad_format_marks';
  const ZOOM_STEPS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
  let editorZoom = clampZoom(parseFloat(localStorage.getItem(ZOOM_KEY) || '1'));
  let formatMarksVisible = localStorage.getItem(FORMAT_MARKS_KEY) === '1';

  // --- Storage ---
  function normalizeNote(raw, fallbackId) {
    const now = Date.now();
    const source = raw && typeof raw === 'object' ? raw : {};
    const id = String(source.id || fallbackId || (now.toString(36) + Math.random().toString(36).slice(2, 6)));
    const created = Number(source.created);
    const updated = Number(source.updated);
    const deleted = source.deleted === 1
      ? 1
      : (Number.isFinite(Number(source.deleted)) && Number(source.deleted) > 1 ? Number(source.deleted) : null);

    return {
      ...source,
      id,
      title: String(source.title || ''),
      content: sanitizeHtml(String(source.content || '')),
      pageSize: (source.pageSize === 'free' || PAGE_SIZES[source.pageSize]) ? source.pageSize : 'free',
      pageOrientation: source.pageOrientation === 'landscape' ? 'landscape' : 'portrait',
      created: Number.isFinite(created) && created > 0 ? created : (Number.isFinite(updated) && updated > 0 ? updated : now),
      updated: Number.isFinite(updated) && updated > 0 ? updated : now,
      deleted,
      version: Number.isFinite(Number(source.version)) ? Math.max(1, Number(source.version)) : 1,
      rev: typeof source.rev === 'string' && source.rev ? source.rev : null,
      bgImage: isSafeEditorImageUrl(source.bgImage) ? String(source.bgImage) : '',
      bgImageMode: source.bgImageMode === 'cover' ? 'cover' : 'fit'
    };
  }

  function migrateNotesSchema(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map((note, index) => normalizeNote(note, `recovered-${Date.now().toString(36)}-${index}`));
  }

  function loadNotes() {
    let storedNotesJson = '';
    try {
      storedNotesJson = localStorage.getItem(STORAGE_KEY) || '';
      notes = migrateNotesSchema(JSON.parse(storedNotesJson) || []);
    } catch {
      notes = [];
    }

    // Keep cloud tombstones until a successful sync confirms the remote purge.
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    notes.forEach((note) => {
      if (note.deleted && note.deleted !== 1 && note.deleted < thirtyDaysAgo) {
        note.deleted = 1;
      }
    });

    activeId = localStorage.getItem(ACTIVE_KEY);
    const visible = notes.filter(n => !n.deleted);
    if (visible.length === 0) {
      if (hasLaunchCreateRequest()) {
        activeId = null;
        renderNoteList();
        if (JSON.stringify(notes) !== storedNotesJson) saveNotes();
        return;
      }
      createNote();
    } else {
      const found = visible.find(n => n.id === activeId);
      if (!found) activeId = visible[0].id;
      renderNoteList();
      loadNote(activeId);
      if (JSON.stringify(notes) !== storedNotesJson) saveNotes();
    }
  }

  function hasLaunchCreateRequest() {
    const params = new URLSearchParams(location.search);
    return params.get('action') === 'new' ||
      params.has('note') ||
      params.has('text') ||
      params.has('title') ||
      params.has('url');
  }

  function setSaveStatus(text, state = '') {
    if (!saveStatusEl) return;
    saveStatusEl.textContent = text;
    saveStatusEl.dataset.state = state;
    saveStatusEl.title = state === 'error' && lastSaveError ? lastSaveError.message : '';
  }

  function saveNotes(options = {}) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
      localStorage.setItem(ACTIVE_KEY, activeId || '');
      lastSaveError = null;
      quotaAlerted = false;
      if (options.showStatus) {
        setSaveStatus((typeof tr === 'function') ? tr('saved') : 'Saved', 'saved');
      }
      return true;
    } catch (error) {
      lastSaveError = error instanceof Error ? error : new Error(String(error));
      const quota = lastSaveError.name === 'QuotaExceededError';
      const message = quota
        ? ((typeof tr === 'function') ? tr('storageFull') : 'Storage is full. Remove large images or export a backup.')
        : ((typeof tr === 'function') ? tr('saveFailed') : 'Save failed.');
      setSaveStatus(message, 'error');
      console.error('[storage] save failed', lastSaveError);
      // On mobile the status line is easy to miss — surface quota once as an alert
      // so the user understands why the image/note didn't stick.
      if (quota && !quotaAlerted) {
        quotaAlerted = true;
        setTimeout(() => alert(message), 0);
      }
      return false;
    }
  }

  // --- Notes CRUD ---
  const PAGE_SIZES = {
    free:   null,
    a3:     { w: '297mm', h: '420mm' },
    a4:     { w: '210mm', h: '297mm' },
    a5:     { w: '148mm', h: '210mm' },
    letter: { w: '216mm', h: '279mm' },
    legal:  { w: '216mm', h: '356mm' }
  };

  function createNote() {
    const now = Date.now();
    const note = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: '',
      content: '',
      pageSize: 'free',
      pageOrientation: 'portrait',
      created: now,
      updated: now,
      deleted: null,
      version: 1,
      rev: null
    };
    notes.unshift(note);
    activeId = note.id;
    saveNotes();
    renderNoteList();
    loadNote(note.id);
    noteTitle.focus();
    if (window.__npCloud) window.__npCloud.markDirty(note.id);
  }

  function deleteNote(id) {
    const target = notes.find(n => n.id === id);
    if (!target) return;
    // Soft delete: mark + keep in array so cloud sync can propagate the tombstone
    target.deleted = Date.now();
    target.updated = target.deleted;
    target.version = (target.version || 0) + 1;
    if (window.__npCloud) window.__npCloud.markDirty(id);

    const visible = notes.filter(n => !n.deleted);
    if (visible.length === 0) {
      // No visible notes left — create a fresh one
      createNote();
      return;
    }
    if (activeId === id) {
      activeId = visible[0].id;
      loadNote(activeId);
    }
    saveNotes();
    renderNoteList();
  }

  function purgeNotePermanently(id) {
    const target = notes.find(n => n.id === id);
    if (!target) return;

    const isCloudConnected = window.__npCloud && window.__npCloud.isSignedIn();
    if (isCloudConnected) {
      target.deleted = 1;
      target.updated = Date.now();
      target.version = (target.version || 0) + 1;
      window.__npCloud.markDirty(id);
    } else {
      notes = notes.filter(n => n.id !== id);
    }

    const visible = notes.filter(n => !n.deleted);
    if (visible.length === 0) {
      createNote();
      return;
    }
    if (activeId === id) {
      activeId = visible[0].id;
      loadNote(activeId);
    }
    saveNotes();
    renderNoteList();
  }

  function emptyTrash() {
    const isCloudConnected = window.__npCloud && window.__npCloud.isSignedIn();
    const deletedNotes = notes.filter(n => n.deleted && n.deleted !== 1);
    if (deletedNotes.length === 0) return;

    if (isCloudConnected) {
      deletedNotes.forEach(target => {
        target.deleted = 1;
        target.updated = Date.now();
        target.version = (target.version || 0) + 1;
        window.__npCloud.markDirty(target.id);
      });
    } else {
      notes = notes.filter(n => !n.deleted);
    }

    saveNotes();
    renderNoteList();

    const visible = notes.filter(n => !n.deleted);
    if (visible.length === 0) {
      createNote();
    } else {
      const activeNote = notes.find(n => n.id === activeId);
      if (!activeNote || activeNote.deleted) {
        activeId = visible[0].id;
        loadNote(activeId);
      }
    }
  }

  function restoreNote(id) {
    const target = notes.find(n => n.id === id);
    if (!target) return;
    target.deleted = null;
    target.updated = Date.now();
    target.version = (target.version || 0) + 1;
    if (window.__npCloud) window.__npCloud.markDirty(id);
    saveNotes();
    renderNoteList();
    loadNote(id);
  }

  function loadNote(id) {
    const note = notes.find(n => n.id === id);
    if (!note) return;
    const safeContent = sanitizeHtml(String(note.content || ''));
    if (safeContent !== note.content) note.content = safeContent;
    activeId = id;
    noteTitle.value = note.title;
    editor.innerHTML = safeContent;

    // Handle deleted state (trash banner & read-only)
    const banner = $('#trashBanner');
    if (banner) {
      banner.style.display = note.deleted ? 'flex' : 'none';
    }
    editor.contentEditable = note.deleted ? 'false' : 'true';
    noteTitle.readOnly = !!note.deleted;
    const btnDel = $('#btnDelete');
    if (btnDel) btnDel.disabled = !!note.deleted;

    updateCounts();
    renderNoteList();
    try { localStorage.setItem(ACTIVE_KEY, activeId); } catch (_) {}
    if (typeof deselectImage === 'function') deselectImage();
    applyPageLayout(note);
    syncPageControls(note);
    if (typeof window.__npApplyBg === 'function') window.__npApplyBg();
    if (typeof window.__npApplyRulersGrid === 'function') window.__npApplyRulersGrid();
    // Re-apply draggable on existing text boxes
    editor.querySelectorAll('.text-box').forEach(tb => { tb.draggable = true; });
    if (typeof window.__npRecalcSheets === 'function') window.__npRecalcSheets();
  }

  function applyPageLayout(note) {
    const wrapper = document.querySelector('.editor-wrapper');
    const size = note.pageSize || 'free';
    const orient = note.pageOrientation || 'portrait';
    if (size === 'free' || !PAGE_SIZES[size]) {
      wrapper.classList.remove('page-mode');
      editor.style.removeProperty('--page-w');
      editor.style.removeProperty('--page-h');
      document.documentElement.style.removeProperty('--print-size');
      return;
    }
    wrapper.classList.add('page-mode');
    const { w, h } = PAGE_SIZES[size];
    const [pw, ph] = orient === 'landscape' ? [h, w] : [w, h];
    editor.style.setProperty('--page-w', pw);
    editor.style.setProperty('--page-h', ph);
    document.documentElement.style.setProperty('--print-size', `${pw} ${ph}`);
  }

  function syncPageControls(note) {
    $('#pageSize').value = note.pageSize || 'free';
    const btn = $('#btnOrientation');
    if (btn) {
      btn.classList.toggle('landscape', (note.pageOrientation || 'portrait') === 'landscape');
      btn.title = (note.pageOrientation || 'portrait') === 'landscape' ? 'Yatay (tıkla → dikey)' : 'Dikey (tıkla → yatay)';
    }
  }

  function getActiveNote() {
    return notes.find(n => n.id === activeId);
  }

  function autoSave(options = {}) {
    saveTimeout = null;
    const note = getActiveNote();
    if (!note) return false;
    note.title = noteTitle.value;
    // Strip find-highlight marks before saving
    const tmp = editor.cloneNode(true);
    tmp.querySelectorAll('mark.find-hit').forEach(m => {
      const txt = document.createTextNode(m.textContent);
      m.replaceWith(txt);
    });
    note.content = sanitizeHtml(tmp.innerHTML);
    note.updated = Date.now();
    note.version = (note.version || 0) + 1;

    // Move to top
    notes = notes.filter(n => n.id !== note.id);
    notes.unshift(note);

    const saved = saveNotes({ showStatus: true });
    if (options.render !== false) renderNoteList();
    if (saved && options.markDirty !== false && window.__npCloud) window.__npCloud.markDirty(note.id);
    return saved;
  }

  function scheduleSave() {
    setSaveStatus((typeof tr === 'function') ? tr('saving') : 'Saving...', 'saving');
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => autoSave(), 500);
  }

  function flushPendingSave() {
    if (saveTimeout === null) return;
    clearTimeout(saveTimeout);
    autoSave({ render: false });
  }

  // --- Render ---
  const COLLAPSED_GROUPS_KEY = 'notepad_collapsed_groups';
  function getCollapsedGroups() {
    try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY) || '[]')); }
    catch (_) { return new Set(); }
  }
  function setCollapsedGroups(set) {
    localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...set]));
  }
  function getAllGroups() {
    return [...new Set(notes.map(n => n.group).filter(Boolean))].sort();
  }
  window.__npGetAllGroups = getAllGroups;

  // ===== Multi-select state =====
  let currentSidebarTab = 'notes'; // 'notes' or 'trash'
  let selectedNoteIds = new Set();
  function updateSelectionUI() {
    const count = selectedNoteIds.size;
    const el = $('#selectionCount');
    if (el) el.textContent = count ? `${count} seçili` : '';
    // Sync "select all" checkbox state
    const all = $('#selectAllCheckbox');
    if (all) {
      const filtered = getFilteredNotes();
      all.checked = filtered.length > 0 && filtered.every(n => selectedNoteIds.has(n.id));
      all.indeterminate = !all.checked && filtered.some(n => selectedNoteIds.has(n.id));
    }
  }
  let currentSortOption = localStorage.getItem('np_sort_option') || 'date'; // 'date' or 'name'

  function getFilteredNotes() {
    const visible = (currentSidebarTab === 'trash')
      ? notes.filter(n => n.deleted && n.deleted !== 1)
      : notes.filter(n => !n.deleted);

    // Sort visible notes
    const sorted = [...visible];
    if (currentSortOption === 'name') {
      sorted.sort((a, b) => {
        const titleA = (a.title || '').trim().toLowerCase();
        const titleB = (b.title || '').trim().toLowerCase();
        if (!titleA && !titleB) return 0;
        if (!titleA) return 1; // Put untitled at bottom
        if (!titleB) return -1;
        return titleA.localeCompare(titleB, 'tr');
      });
    } else {
      // Default: date (newest first)
      sorted.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    }

    const query = (searchInput.value || '').toLowerCase();
    return query
      ? sorted.filter(n =>
          (n.title || '').toLowerCase().includes(query) ||
          stripHtml(n.content).toLowerCase().includes(query)
        )
      : sorted;
  }

  function renderNoteList() {
    const filtered = getFilteredNotes();

    // Group notes
    const groupsMap = new Map();
    filtered.forEach(n => {
      const g = n.group || '';
      if (!groupsMap.has(g)) groupsMap.set(g, []);
      groupsMap.get(g).push(n);
    });
    // Sort: named groups alphabetic, ungrouped last
    const groupKeys = [...groupsMap.keys()].sort((a, b) => {
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b, 'tr');
    });
    const collapsed = getCollapsedGroups();

    let html = '';
    const useGroupHeaders = groupKeys.length > 1 || (groupKeys.length === 1 && groupKeys[0] !== '');
    for (const g of groupKeys) {
      if (useGroupHeaders) {
        const isCollapsed = collapsed.has(g);
        const label = g || 'Grupsuz';
        html += `<div class="note-group-header${isCollapsed ? ' collapsed' : ''}" data-group="${escapeAttribute(g)}">
          <span>${escapeHtml(label)} (${groupsMap.get(g).length})</span>
          <span class="ngh-arrow">▼</span>
        </div>`;
        if (isCollapsed) continue;
      }
      for (const n of groupsMap.get(g)) {
        const preview = stripHtml(n.content).slice(0, 80) || 'Empty note';
        const title = n.title || 'Untitled Note';
        const time = formatTime(n.updated);
        const colorAttr = n.color ? ` data-color="${escapeAttribute(n.color)}" style="--note-color:${escapeAttribute(n.color)}"` : '';
        const groupTag = n.group ? `<span class="note-item-tag">${escapeHtml(n.group)}</span>` : '';
        const isSelected = selectedNoteIds.has(n.id);
        const classes = ['note-item'];
        if (n.id === activeId) classes.push('active');
        if (isSelected) classes.push('selected');
        html += `
          <div class="${classes.join(' ')}" data-id="${escapeAttribute(n.id)}"${colorAttr}>
            <input type="checkbox" class="note-check" data-check-id="${escapeAttribute(n.id)}"${isSelected ? ' checked' : ''}>
            <div class="note-item-title">${escapeHtml(title)}</div>
            <div class="note-item-preview">${escapeHtml(preview)}</div>
            <div>${groupTag}<span class="note-item-time">${time}</span></div>
          </div>`;
      }
    }
    noteList.innerHTML = html;

    noteList.querySelectorAll('.note-item').forEach(el => {
      el.addEventListener('click', (e) => {
        // Checkbox click handled separately
        if (e.target.classList && e.target.classList.contains('note-check')) return;
        loadNote(el.dataset.id);
      });
    });
    noteList.querySelectorAll('.note-check').forEach(cb => {
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', (e) => {
        const id = e.target.dataset.checkId;
        if (e.target.checked) selectedNoteIds.add(id);
        else selectedNoteIds.delete(id);
        const item = e.target.closest('.note-item');
        if (item) item.classList.toggle('selected', e.target.checked);
        updateSelectionUI();
      });
    });
    const selAllRow = $('#selectAllRow');
    const trashActRow = $('#trashActionsRow');
    if (currentSidebarTab === 'trash') {
      if (selAllRow) selAllRow.style.display = 'none';
      if (trashActRow) trashActRow.style.display = 'block';
    } else {
      if (selAllRow) selAllRow.style.display = 'flex';
      if (trashActRow) trashActRow.style.display = 'none';
    }
    updateSelectionUI();
    noteList.querySelectorAll('.note-group-header').forEach(el => {
      el.addEventListener('click', () => {
        const g = el.dataset.group;
        const cur = getCollapsedGroups();
        if (cur.has(g)) cur.delete(g); else cur.add(g);
        setCollapsedGroups(cur);
        renderNoteList();
      });
    });
  }

  function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || '';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    // textContent->innerHTML escapes <>& but NOT quotes; encode them too so the
    // result is safe in both text and double/single-quoted attribute contexts.
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function textToNoteHtml(text) {
    return escapeHtml(text || '').replace(/\r?\n/g, '<br>');
  }

  function normalizeReviewRubricText(text) {
    const responseRe = /^(?:must be improved|can be improved|adequate|acceptable|good|excellent|poor|fair|yes|no|not applicable|n\/a)$/i;
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    for (const line of lines) {
      const trimmed = line.trim();
      const prev = out[out.length - 1] || '';
      if (trimmed && responseRe.test(trimmed) && /\?\s*$/.test(prev)) {
        out[out.length - 1] = prev + '\t' + trimmed;
      } else {
        out.push(line);
      }
    }
    return out.join('\n');
  }

  function isNodeInsideEditor(node) {
    if (!node) return false;
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
    return el === editor || (el && editor.contains(el));
  }

  function isEditorSelection(sel) {
    return !!(sel && sel.rangeCount > 0 && isNodeInsideEditor(sel.anchorNode) && isNodeInsideEditor(sel.focusNode));
  }

  function rangeContainsPoint(range, x, y) {
    return Array.from(range.getClientRects()).some(rect =>
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    );
  }

  function selectedFragmentToText(fragment) {
    let text = '';
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.nodeValue || '';
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
      const tag = node.nodeType === Node.ELEMENT_NODE ? node.tagName : '';
      if (tag === 'BR') {
        text += '\n';
        return;
      }
      const isBlock = /^(DIV|P|LI|TR|H[1-6])$/.test(tag);
      const isCell = /^(TD|TH)$/.test(tag);
      const before = text.length;
      Array.from(node.childNodes).forEach(walk);
      if (isCell && !text.endsWith('\t')) text += '\t';
      if (isBlock && text.length > before && !text.endsWith('\n')) text += '\n';
    };
    walk(fragment);
    return text.replace(/\t+\n/g, '\n').replace(/\n+$/g, '');
  }

  function escapeAttribute(str) {
    // escapeHtml already encodes quotes; kept as a named alias for attribute sites.
    return escapeHtml(str);
  }

  function isSafeLinkUrl(url) {
    try {
      return ['http:', 'https:'].includes(new URL(url).protocol);
    } catch (_) {
      return false;
    }
  }

  function isSafeImageDataUrl(value) {
    return /^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(value || '');
  }

  function isSafePdfDataUrl(value) {
    return /^data:application\/pdf;base64,[a-z0-9+/=]+$/i.test(value || '');
  }

  function isSafeEditorImageUrl(value) {
    return /^(?:https?:|blob:|data:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml)(?:;base64)?,)/i.test(String(value || '').trim());
  }

  function externalClipFromPayload(payload = {}) {
    const title = String(payload.title || '').trim();
    const text = String(payload.text || '').trim();
    const url = String(payload.url || '').trim();
    const screenshotDataUrl = String(payload.screenshotDataUrl || '').trim();
    const pdfAttachment = payload.pdfAttachment || null;
    let fallbackTitle = 'Web sayfası';

    if (url) {
      try {
        fallbackTitle = new URL(url).hostname || fallbackTitle;
      } catch (_) {
        fallbackTitle = url;
      }
    }

    const parts = [];
    if (text) parts.push(`<p>${textToNoteHtml(text)}</p>`);
    if (url) {
      const safeUrl = escapeHtml(url);
      const safeHref = escapeAttribute(url);
      const urlContent = isSafeLinkUrl(url)
        ? `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>`
        : safeUrl;
      parts.push(`<p>${urlContent}</p>`);
    }
    if (isSafeImageDataUrl(screenshotDataUrl)) {
      parts.push(`<p><img src="${screenshotDataUrl}" alt="Web page screenshot" style="max-width:100%;height:auto;"></p>`);
    }
    if (pdfAttachment && (pdfAttachment.url || pdfAttachment.dataUrl)) {
      const pdfName = String(pdfAttachment.name || 'web-page.pdf').replace(/[\\/:*?"<>|]+/g, '-');
      const safeName = escapeHtml(pdfName);
      const safeDownloadName = escapeAttribute(pdfName);
      const pdfRows = [];

      if (isSafePdfDataUrl(pdfAttachment.dataUrl)) {
        const safePdfData = escapeAttribute(pdfAttachment.dataUrl);
        pdfRows.push(`<a href="${safePdfData}" download="${safeDownloadName}">PDF indir: ${safeName}</a>`);
      }
      if (pdfAttachment.url && isSafeLinkUrl(pdfAttachment.url)) {
        const safePdfUrl = escapeHtml(pdfAttachment.url);
        const safePdfHref = escapeAttribute(pdfAttachment.url);
        pdfRows.push(`<a href="${safePdfHref}" target="_blank" rel="noopener noreferrer">PDF adresi</a>: ${safePdfUrl}`);
      }
      if (pdfAttachment.tooLarge) {
        pdfRows.push('<em>PDF dosyası tarayıcı yerel depolama kotası için çok büyük olduğundan dosya yerine adres kaydedildi.</em>');
      }
      if (pdfAttachment.downloadedExternally) {
        pdfRows.push('<em>PDF dosyası Chrome indirmelerine gönderildi.</em>');
      }
      if (pdfRows.length) parts.push(`<p><strong>PDF</strong><br>${pdfRows.join('<br>')}</p>`);
    }

    return {
      title: title || fallbackTitle,
      url,
      content: parts.join('') || `<p>${textToNoteHtml(fallbackTitle)}</p>`
    };
  }

  function createExternalNote(payload = {}) {
    const clip = externalClipFromPayload(payload);
    const note = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: clip.title,
      content: clip.content,
      pageSize: 'free',
      pageOrientation: 'portrait',
      updated: Date.now()
    };

    notes.unshift(note);
    activeId = note.id;
    saveNotes();
    loadNote(note.id);
    if (saveStatusEl) saveStatusEl.textContent = (typeof tr === 'function') ? tr('saved') : 'Saved';
    return note;
  }

  let pendingClipPayload = null;

  function translated(key, fallback) {
    const value = (typeof tr === 'function') ? tr(key) : key;
    return value === key ? fallback : value;
  }

  function appendExternalClipToNote(noteId, payload = {}) {
    const note = notes.find(n => n.id === noteId);
    if (!note) return null;

    const clip = externalClipFromPayload(payload);
    const existing = String(note.content || '').trim();
    note.content = existing ? `${existing}<hr>${clip.content}` : clip.content;
    if (!String(note.title || '').trim()) note.title = clip.title;
    note.updated = Date.now();
    activeId = note.id;
    saveNotes();
    loadNote(note.id);
    if (saveStatusEl) saveStatusEl.textContent = translated('saved', 'Saved');
    return note;
  }

  function listClipTargetNotes() {
    return notes.map(note => ({
      id: note.id,
      title: (note.title && note.title.trim()) || translated('untitled', 'Untitled'),
      preview: stripHtml(note.content || '').slice(0, 140),
      updated: note.updated || 0,
      active: note.id === activeId
    }));
  }

  function closeClipTargetDialog() {
    const dialog = $('#clipTargetDialog');
    if (!dialog) return;
    dialog.hidden = true;
    dialog.style.display = 'none';
    pendingClipPayload = null;
  }

  function renderClipTargetDialog() {
    const list = $('#clipTargetList');
    const preview = $('#clipTargetPreview');
    const search = $('#clipTargetSearch');
    if (!list || !preview) return;

    const clip = externalClipFromPayload(pendingClipPayload || {});
    const clipTitle = escapeHtml(clip.title || translated('webPage', 'Web page'));
    const clipUrl = clip.url ? `<span>${escapeHtml(clip.url)}</span>` : '';
    preview.innerHTML = `<strong>${clipTitle}</strong>${clipUrl}`;

    const query = String(search?.value || '').trim().toLowerCase();
    const visibleNotes = notes.filter(note => {
      if (!query) return true;
      const hay = `${note.title || ''} ${stripHtml(note.content || '')}`.toLowerCase();
      return hay.includes(query);
    });

    if (!visibleNotes.length) {
      list.innerHTML = `<div class="clip-target-empty">${escapeHtml(translated('noNotesFound', 'No notes found'))}</div>`;
      return;
    }

    list.innerHTML = visibleNotes.map(note => {
      const title = (note.title && note.title.trim()) || translated('untitled', 'Untitled');
      const previewText = stripHtml(note.content || '').slice(0, 110) || translated('emptyNote', 'Empty note');
      const active = note.id === activeId ? ` · ${translated('activeNote', 'Active note')}` : '';
      return `
        <button class="clip-target-note" data-clip-note-id="${escapeAttribute(note.id)}">
          <span class="clip-target-note-title">${escapeHtml(title)}${escapeHtml(active)}</span>
          <span class="clip-target-note-preview">${escapeHtml(previewText)}</span>
        </button>`;
    }).join('');
  }

  function openClipTargetPicker(payload = {}) {
    pendingClipPayload = payload || {};
    const dialog = $('#clipTargetDialog');
    const search = $('#clipTargetSearch');
    if (!dialog) {
      createExternalNote(payload);
      return true;
    }
    if (search) search.value = '';
    renderClipTargetDialog();
    dialog.hidden = false;
    dialog.style.display = 'flex';
    setTimeout(() => {
      const activeButton = Array.from(dialog.querySelectorAll('[data-clip-note-id]'))
        .find(button => button.dataset.clipNoteId === activeId);
      (activeButton || search || $('#clipTargetNew'))?.focus();
    }, 0);
    return true;
  }

  function bindClipTargetDialog() {
    const dialog = $('#clipTargetDialog');
    if (!dialog) return;
    $('#clipTargetSearch')?.addEventListener('input', renderClipTargetDialog);
    $('#clipTargetClose')?.addEventListener('click', closeClipTargetDialog);
    $('#clipTargetCancel')?.addEventListener('click', closeClipTargetDialog);
    $('#clipTargetNew')?.addEventListener('click', () => {
      if (!pendingClipPayload) return closeClipTargetDialog();
      createExternalNote(pendingClipPayload);
      closeClipTargetDialog();
    });
    $('#clipTargetList')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-clip-note-id]');
      if (!button || !pendingClipPayload) return;
      appendExternalClipToNote(button.dataset.clipNoteId, pendingClipPayload);
      closeClipTargetDialog();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeClipTargetDialog();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !dialog.hidden) closeClipTargetDialog();
    });
  }

  bindClipTargetDialog();
  window.__npCreateExternalNote = openClipTargetPicker;
  window.__npOpenClipTargetPicker = openClipTargetPicker;
  window.__npCreateExternalNoteDirect = createExternalNote;
  window.__npAppendExternalClipToNote = appendExternalClipToNote;
  window.__npListClipTargetNotes = listClipTargetNotes;

  function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' min ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' hr ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + ' days ago';
    return d.toLocaleDateString();
  }

  function updateCounts() {
    const text = editor.innerText || '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    const wLabel = (typeof tr === 'function') ? tr('words') : 'Words';
    const cLabel = (typeof tr === 'function') ? tr('chars') : 'Characters';
    wordCountEl.textContent = `${wLabel}: ${words}`;
    charCountEl.textContent = `${cLabel}: ${chars}`;
  }

  // --- Toolbar Actions ---
  function execCmd(cmd, value) {
    document.execCommand(cmd, false, value || null);
    editor.focus();
  }

  function openFilePicker(accept) {
    const def = fileInput.dataset.defaultAccept || fileInput.getAttribute('accept') || '';
    if (!fileInput.dataset.defaultAccept) fileInput.dataset.defaultAccept = def;
    fileInput.setAttribute('accept', accept || fileInput.dataset.defaultAccept);
    fileInput.value = '';
    fileInput.click();
  }

  function clampZoom(value) {
    return Math.min(2, Math.max(0.5, Number.isFinite(value) ? value : 1));
  }

  function nearestZoomIndex(value) {
    let best = 0;
    let bestDiff = Infinity;
    ZOOM_STEPS.forEach((step, idx) => {
      const diff = Math.abs(step - value);
      if (diff < bestDiff) {
        best = idx;
        bestDiff = diff;
      }
    });
    return best;
  }

  function applyEditorZoom(value) {
    editorZoom = clampZoom(value);
    const surface = $('#editorZoomSurface');
    if (surface) surface.style.setProperty('--editor-zoom', editorZoom.toString());
    localStorage.setItem(ZOOM_KEY, editorZoom.toString());
    const zoomSelect = $('#zoomSelect');
    if (zoomSelect) zoomSelect.value = ZOOM_STEPS[nearestZoomIndex(editorZoom)].toString();
  }

  function applyFormatMarksState() {
    editor.classList.toggle('show-format-marks', formatMarksVisible);
    const btn = document.querySelector('button[data-action="toggleFormatMarks"]');
    if (btn) {
      btn.classList.toggle('is-active', formatMarksVisible);
      btn.setAttribute('aria-pressed', formatMarksVisible ? 'true' : 'false');
    }
    localStorage.setItem(FORMAT_MARKS_KEY, formatMarksVisible ? '1' : '0');
  }

  function toggleFormatMarks() {
    formatMarksVisible = !formatMarksVisible;
    applyFormatMarksState();
    editor.focus();
  }

  function getActiveEditorRange() {
    const sel = window.getSelection();
    if (isEditorSelection(sel) && sel.rangeCount > 0 && !sel.isCollapsed) {
      return sel.getRangeAt(0).cloneRange();
    }
    return null;
  }

  function getFormatSourceElement(range) {
    if (!range) return null;
    let node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (node === editor && range.startContainer.childNodes.length) {
      node = range.startContainer.childNodes[range.startOffset] || node;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    }
    return node && node.nodeType === Node.ELEMENT_NODE ? node : null;
  }

  function captureSelectionFormat() {
    const range = getActiveEditorRange();
    const source = getFormatSourceElement(range);
    if (!source) return null;
    const styles = window.getComputedStyle(source);
    const backgroundColor = styles.backgroundColor;
    return {
      color: styles.color,
      backgroundColor: backgroundColor && backgroundColor !== 'rgba(0, 0, 0, 0)' ? backgroundColor : '',
      fontFamily: styles.fontFamily,
      fontSize: styles.fontSize,
      fontWeight: styles.fontWeight,
      fontStyle: styles.fontStyle,
      textDecorationLine: styles.textDecorationLine,
      textDecorationStyle: styles.textDecorationStyle,
      textDecorationColor: styles.textDecorationColor
    };
  }

  function applyFormatToSelection(format) {
    const range = getActiveEditorRange();
    if (!range || !format) return false;
    const span = document.createElement('span');
    span.style.color = format.color || '';
    span.style.backgroundColor = format.backgroundColor || '';
    span.style.fontFamily = format.fontFamily || '';
    span.style.fontSize = format.fontSize || '';
    span.style.fontWeight = format.fontWeight || '';
    span.style.fontStyle = format.fontStyle || '';
    if (format.textDecorationLine && format.textDecorationLine !== 'none') {
      span.style.textDecorationLine = format.textDecorationLine;
      span.style.textDecorationStyle = format.textDecorationStyle || '';
      span.style.textDecorationColor = format.textDecorationColor || '';
    }
    span.appendChild(range.extractContents());
    range.insertNode(span);
    const sel = window.getSelection();
    const nextRange = document.createRange();
    nextRange.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(nextRange);
    scheduleSave();
    return true;
  }

  function setFormatPainterActive(active) {
    formatPainterActive = active;
    const btn = $('#btnCopyFormat');
    if (btn) {
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  function copyOrApplyFormat() {
    if (formatPainterActive && copiedFormat && applyFormatToSelection(copiedFormat)) {
      setFormatPainterActive(false);
      return;
    }
    copiedFormat = captureSelectionFormat();
    if (copiedFormat) {
      setFormatPainterActive(true);
      setSaveStatus(tr('formatCopied'), 'saved');
    }
  }

  function clearSelectionFormat() {
    editor.focus();
    document.execCommand('removeFormat');
    scheduleSave();
  }

  function stepEditorZoom(direction) {
    const current = nearestZoomIndex(editorZoom);
    const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, current + direction));
    applyEditorZoom(ZOOM_STEPS[next]);
  }

  function zoomSelectedImage(multiplier) {
    if (!selectedImg || !document.contains(selectedImg)) return;
    const currentW = selectedImg.offsetWidth || selectedImg.naturalWidth || 160;
    const currentH = selectedImg.offsetHeight || selectedImg.naturalHeight || currentW;
    const nextW = Math.max(24, Math.round(currentW * multiplier));
    const nextH = Math.max(24, Math.round(currentH * multiplier));
    selectedImg.style.width = nextW + 'px';
    selectedImg.style.height = nextH + 'px';
    selectedImg.style.maxWidth = 'none';
    positionOverlay();
    updatePanelPreview();
    syncSizeInputs();
    scheduleSave();
  }

  const toolbarActions = {
    new: () => createNote(),
    open: () => openFilePicker(),
    toggleSaveMenu: () => toggleSaveDropdown(),
    saveTxt: () => { closeSaveDropdown(); downloadNote(); },
    saveMd: () => { closeSaveDropdown(); downloadAsMarkdown(); },
    savePdf: () => { closeSaveDropdown(); downloadAsPdf(); },
    saveWord: () => { closeSaveDropdown(); downloadAsWord(); },
    toggleShareMenu: () => toggleShareDropdown(),
    shareDevice: () => { closeShareDropdown(); shareViaDevice(); },
    shareWhatsApp: () => { closeShareDropdown(); shareWhatsApp(); },
    shareEmail: () => { closeShareDropdown(); shareEmail(); },
    shareEmailPdf: () => { closeShareDropdown(); downloadAsPdf(); shareEmail(true); },
    shareWhatsAppPdf: () => { closeShareDropdown(); downloadAsPdf(); shareWhatsApp(true); },
    print: () => window.print(),
    undo: () => execCmd('undo'),
    redo: () => execCmd('redo'),
    toggleFormatMarks: () => toggleFormatMarks(),
    bold: () => execCmd('bold'),
    italic: () => execCmd('italic'),
    underline: () => execCmd('underline'),
    strikeThrough: () => execCmd('strikeThrough'),
    clearFormat: () => clearSelectionFormat(),
    copyFormat: () => copyOrApplyFormat(),
    justifyLeft: () => execCmd('justifyLeft'),
    justifyCenter: () => execCmd('justifyCenter'),
    justifyRight: () => execCmd('justifyRight'),
    insertOrderedList: () => execCmd('insertOrderedList'),
    insertUnorderedList: () => execCmd('insertUnorderedList'),
    zoomOut: () => stepEditorZoom(-1),
    zoomIn: () => stepEditorZoom(1),
    findReplace: () => toggleFindReplace(),
    insertImage: () => {
      const inp = $('#imageInput');
      if (!inp) { console.warn('imageInput not found'); return; }
      inp.value = '';
      try { inp.click(); } catch (err) { console.error('imageInput.click failed', err); }
    },
    toggleOrientation: () => {
      const note = getActiveNote();
      if (!note) return;
      note.pageOrientation = (note.pageOrientation === 'landscape') ? 'portrait' : 'landscape';
      applyPageLayout(note);
      syncPageControls(note);
      scheduleSave();
    },
    insertDateTime: () => {
      const dt = new Date().toLocaleString();
      execCmd('insertText', dt);
    },
    insertTextBox: () => {
      insertTextBox();
    },
    insertShape: () => {
      openShapeGallery();
    },
    insertTable: () => {
      openTableGridPopup();
    },
    insertLink: () => {
      openLinkDialog();
    },
    toggleRulers: () => {
      toggleRulersAndGrid();
    },
    toggleCalc: () => {
      toggleCalculator();
    },
    toggleCal: () => {
      toggleCalendar();
    },
    insertSheet: () => {
      insertMiniSheet();
    },
    fullscreen: () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    }
  };

  function toggleSaveDropdown() {
    $('#saveDropdown').classList.toggle('open');
    $('#shareDropdown').classList.remove('open');
  }

  function closeSaveDropdown() {
    $('#saveDropdown').classList.remove('open');
  }

  function toggleShareDropdown() {
    $('#shareDropdown').classList.toggle('open');
    $('#saveDropdown').classList.remove('open');
  }

  function closeShareDropdown() {
    $('#shareDropdown').classList.remove('open');
  }

  async function shareViaDevice() {
    const note = getActiveNote();
    if (!note) return;
    const title = note.title || 'Untitled';
    const text = editor.innerText || '';
    if (!navigator.share) {
      alert('Bu tarayıcı cihazdan paylaşımı desteklemiyor. WhatsApp/E-posta seçeneğini kullanın.');
      return;
    }
    try {
      // Try file share if supported (Word docx)
      if (navigator.canShare) {
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${editor.innerHTML}</body></html>`;
        const blob = (typeof htmlDocx !== 'undefined') ? htmlDocx.asBlob(html) : new Blob([text], { type: 'text/plain' });
        const ext = blob.type.includes('word') ? 'docx' : 'txt';
        const file = new File([blob], `${title}.${ext}`, { type: blob.type });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ title, text: title, files: [file] });
          return;
        }
      }
      await navigator.share({ title, text });
    } catch (err) {
      if (err.name !== 'AbortError') alert('Paylaşım başarısız: ' + err.message);
    }
  }

  function shareWhatsApp(withPdfHint = false) {
    const note = getActiveNote();
    if (!note) return;
    const title = note.title || 'Untitled';
    const text = editor.innerText || '';
    const body = withPdfHint
      ? `*${title}*\n\n${text}\n\n(PDF indirildi — WhatsApp'ta ataç simgesiyle ekleyin)`
      : `*${title}*\n\n${text}`;
    const url = `https://wa.me/?text=${encodeURIComponent(body)}`;
    window.open(url, '_blank');
  }

  function shareEmail(withPdfHint = false) {
    const note = getActiveNote();
    if (!note) return;
    const title = note.title || 'Untitled';
    const text = editor.innerText || '';
    const body = withPdfHint
      ? `${text}\n\n(PDF dosyası indirildi — e-postaya ek olarak iliştirin)`
      : text;
    const url = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    window.location.href = url;
  }

  // Paste handler: parses tables if present in HTML, falls back to plain text
  function sanitizeTableHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form,svg,math').forEach(el => el.remove());
    const tables = doc.querySelectorAll('table');
    if (!tables.length) return '';
    
    tables.forEach(table => {
      table.classList.add('editor-table');
      const cleanNode = (node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const allowedAttrs = ['colspan', 'rowspan'];
          const attrs = Array.from(node.attributes);
          for (const attr of attrs) {
            if (!allowedAttrs.includes(attr.name.toLowerCase())) {
              node.removeAttribute(attr.name);
            }
          }
          Array.from(node.childNodes).forEach(cleanNode);
        }
      };
      cleanNode(table);
    });
    
    return Array.from(tables).map(t => t.outerHTML).join('<br>');
  }

  function insertHtmlAtCursor(html) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    
    const el = document.createElement('div');
    el.innerHTML = html;
    
    const frag = document.createDocumentFragment();
    let node, lastNode;
    while ((node = el.firstChild)) {
      lastNode = frag.appendChild(node);
    }
    range.insertNode(frag);
    
    if (lastNode) {
      const newRange = range.cloneRange();
      newRange.setStartAfter(lastNode);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
    }
  }

  editor.addEventListener('paste', (e) => {
    const cd = e.clipboardData || window.clipboardData;
    if (!cd) return;

    // 1. Check if HTML contains a table
    const html = cd.getData('text/html');
    if (html && /<table/i.test(html)) {
      e.preventDefault();
      const cleanTable = sanitizeTableHtml(html);
      if (cleanTable) {
        insertHtmlAtCursor(cleanTable + '<p><br></p>');
        scheduleSave();
        return;
      }
    }

    // 2. Otherwise prefer plain text, preserving copied line breaks.
    const text = cd.getData('text/plain');
    if (text && text.length > 0) {
      e.preventDefault();
      insertHtmlAtCursor(textToNoteHtml(normalizeReviewRubricText(text)));
      scheduleSave();
      return;
    }
    // No text — check for images in clipboard
    for (const item of cd.items || []) {
      if (item.type && item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        insertImageFromFile(file)
          .then(() => scheduleSave())
          .catch(err => console.error('[image] paste failed', err));
        return;
      }
    }
  });

  editor.addEventListener('copy', (e) => {
    if (!e.clipboardData) return;
    const sel = window.getSelection();
    if (!isEditorSelection(sel) || sel.isCollapsed) return;

    const range = sel.getRangeAt(0);
    const fragment = range.cloneContents();
    const wrap = document.createElement('div');
    wrap.appendChild(fragment.cloneNode(true));
    const html = sanitizeHtml(wrap.innerHTML);
    const text = selectedFragmentToText(fragment) || sel.toString();

    if (!text && !html) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', text);
    e.clipboardData.setData('text/html', html);
  });

  // Download image: data: URLs direct, http(s) URLs via fetch+blob to keep filename.
  async function downloadImage(img) {
    try {
      const src = img.src || '';
      let blobUrl, mime = 'image/png', ext = 'png';
      if (src.startsWith('data:')) {
        const m = src.match(/^data:([^;,]+)[;,]/);
        if (m) {
          mime = m[1];
          ext = mime.split('/')[1] || 'png';
        }
        // Convert data URL to blob for reliable download
        const res = await fetch(src);
        const blob = await res.blob();
        blobUrl = URL.createObjectURL(blob);
      } else {
        const res = await fetch(src, { mode: 'cors' }).catch(() => null);
        if (res && res.ok) {
          const blob = await res.blob();
          mime = blob.type || mime;
          ext = (mime.split('/')[1] || 'png').replace('jpeg', 'jpg');
          blobUrl = URL.createObjectURL(blob);
        } else {
          // Fallback: direct link (may open in new tab if cross-origin blocks download)
          blobUrl = src;
        }
      }
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `notepad-image-${ts}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (blobUrl !== src) setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (err) {
      console.error('[saveImage]', err);
      alert('Resim kaydedilemedi: ' + (err && err.message || err));
    }
  }

  // Fit image into editor canvas without touching raster data.
  // Only sets display width/height (browser handles quality scaling).
  function fitImageToCanvas(img) {
    const apply = () => {
      const nw = img.naturalWidth, nh = img.naturalHeight;
      if (!nw || !nh) return;
      // Skip if already sized (re-loaded note or user-resized via panel)
      if (img.style.width && img.style.width !== '') return;
      const editorW = Math.max(200, (editor.clientWidth || 800) - 24);
      const maxH = Math.max(200, Math.floor(window.innerHeight * 0.8));
      let w = nw, h = nh;
      if (w > editorW) { h = h * (editorW / w); w = editorW; }
      if (h > maxH) { w = w * (maxH / h); h = maxH; }
      img.style.width = Math.round(w) + 'px';
      img.style.height = 'auto';
    };
    if (img.complete && img.naturalWidth) apply();
    else img.addEventListener('load', apply, { once: true });
  }

  // Downscale + re-encode an image file before it goes into a note. Notes live in
  // localStorage (~5MB total on mobile Safari), so a raw phone photo's base64 blows
  // the quota and the save silently fails. Cap the largest side and re-encode to
  // keep each image small. SVG stays vector; tiny images pass through untouched.
  const IMG_MAX_DIM = 1600;      // px, longest side
  const IMG_PASSTHRU_BYTES = 400 * 1024; // below this, don't bother re-encoding
  function fileToDisplayDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (file.type === 'image/svg+xml') {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const original = reader.result;
        const img = new Image();
        img.onload = () => {
          const { width, height } = img;
          const withinDim = width <= IMG_MAX_DIM && height <= IMG_MAX_DIM;
          if (withinDim && file.size < IMG_PASSTHRU_BYTES) {
            resolve(original); // already small enough
            return;
          }
          try {
            const scale = Math.min(1, IMG_MAX_DIM / Math.max(width, height));
            const w = Math.max(1, Math.round(width * scale));
            const h = Math.max(1, Math.round(height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            // PNG preserves transparency (screenshots/logos); fall back to JPEG if
            // the PNG is still heavy. Photos (jpeg source) always go JPEG.
            let out;
            if (file.type === 'image/png') {
              out = canvas.toDataURL('image/png');
              if (out.length > 1_200_000) out = canvas.toDataURL('image/jpeg', 0.85);
            } else {
              out = canvas.toDataURL('image/jpeg', 0.82);
            }
            // Never make it worse than the original.
            resolve(out.length < original.length ? out : original);
          } catch (err) {
            resolve(original); // canvas failed (e.g. tainted) — use original
          }
        };
        img.onerror = () => resolve(original); // undecodable (e.g. HEIC) — use original
        img.src = original;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Compress a file then insert it. Returns a promise so callers can sequence saves.
  function insertImageFromFile(file) {
    return fileToDisplayDataUrl(file).then((dataUrl) => {
      insertImage(dataUrl);
      return dataUrl;
    });
  }

  function insertImage(src) {
    const img = document.createElement('img');
    img.src = src;
    img.className = 'pasted-image';
    editor.focus();
    const sel = window.getSelection();
    let inserted = false;
    try {
      if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(img);
        // Add line break after image
        const br = document.createElement('br');
        img.after(br);
        const newRange = document.createRange();
        newRange.setStartAfter(br);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
        inserted = true;
      }
    } catch (err) {
      inserted = false;
    }
    if (!inserted) {
      editor.appendChild(img);
      editor.appendChild(document.createElement('br'));
    }
    fitImageToCanvas(img);
    img.scrollIntoView({ block: 'nearest' });
  }

  // ===== Text Box =====
  let selectedTextBox = null;
  const tbPopup = $('#textBoxPopup');

  function insertTextBox() {
    editor.focus();
    const tb = document.createElement('div');
    tb.className = 'text-box';
    tb.contentEditable = 'true';
    tb.draggable = true;
    tb.textContent = 'Metin';
    const sel = window.getSelection();
    let inserted = false;
    try {
      if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(tb);
        const space = document.createTextNode(' ');
        tb.after(space);
        const newRange = document.createRange();
        newRange.setStartAfter(space);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
        inserted = true;
      }
    } catch (err) { inserted = false; }
    if (!inserted) {
      editor.appendChild(tb);
      editor.appendChild(document.createTextNode(' '));
    }
    selectTextBox(tb);
    scheduleSave();
  }

  function selectTextBox(tb) {
    if (selectedTextBox && selectedTextBox !== tb) {
      selectedTextBox.classList.remove('tb-selected');
    }
    selectedTextBox = tb;
    tb.classList.add('tb-selected');
    syncTbPopup(tb);
    positionTbPopup(tb);
    tbPopup.hidden = false;
  }

  function deselectTextBox() {
    if (selectedTextBox) selectedTextBox.classList.remove('tb-selected');
    selectedTextBox = null;
    if (tbPopup) tbPopup.hidden = true;
  }

  function syncTbPopup(tb) {
    const cs = window.getComputedStyle(tb);
    const bw = parseInt(cs.borderTopWidth, 10) || 0;
    const bs = cs.borderTopStyle || 'solid';
    const bc = rgbToHex(cs.borderTopColor) || '#999999';
    const bg = rgbToHex(cs.backgroundColor) || '#ffffff';
    const radius = parseInt(cs.borderTopLeftRadius, 10) || 0;
    $('#tbpBorderColor').value = bc;
    $('#tbpBorderWidth').value = bw;
    $('#tbpBorderStyle').value = ['solid','dashed','dotted','double','none'].includes(bs) ? bs : 'solid';
    $('#tbpBgColor').value = bg;
    $('#tbpRadius').value = radius;
  }

  function rgbToHex(rgb) {
    if (!rgb) return null;
    if (rgb.startsWith('#')) return rgb;
    const m = rgb.match(/\d+/g);
    if (!m || m.length < 3) return null;
    const a = m.length >= 4 ? parseFloat(m[3]) : 1;
    if (a === 0) return '#ffffff';
    const toHex = (n) => parseInt(n, 10).toString(16).padStart(2, '0');
    return '#' + toHex(m[0]) + toHex(m[1]) + toHex(m[2]);
  }

  function positionTbPopup(tb) {
    const r = tb.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const pw = 320, ph = 130;
    let top = r.bottom + 6;
    let left = r.left;
    if (top + ph > vh) top = Math.max(8, r.top - ph - 6);
    if (left + pw > vw) left = Math.max(8, vw - pw - 8);
    tbPopup.style.top = top + 'px';
    tbPopup.style.left = left + 'px';
  }

  function applyTbStyle() {
    if (!selectedTextBox) return;
    const tb = selectedTextBox;
    const bc = $('#tbpBorderColor').value;
    const bw = parseInt($('#tbpBorderWidth').value, 10) || 0;
    const bs = $('#tbpBorderStyle').value;
    const bg = $('#tbpBgColor').value;
    const radius = parseInt($('#tbpRadius').value, 10) || 0;
    tb.style.borderColor = bc;
    tb.style.borderWidth = bw + 'px';
    tb.style.borderStyle = bs;
    tb.style.background = bg;
    tb.style.borderRadius = radius + 'px';
    scheduleSave();
  }

  // Click on textbox → select
  editor.addEventListener('click', (e) => {
    const tb = e.target.closest && e.target.closest('.text-box');
    if (tb) {
      selectTextBox(tb);
    } else if (selectedTextBox && !tbPopup.contains(e.target)) {
      deselectTextBox();
    }
  });

  // Focus editor when wrapper or zoom surface is clicked
  const editorWrapperEl = document.querySelector('.editor-wrapper');
  const zoomSurfaceEl = document.getElementById('editorZoomSurface');
  if (editorWrapperEl) {
    editorWrapperEl.addEventListener('click', (e) => {
      if (e.target === editorWrapperEl || e.target === zoomSurfaceEl) {
        const rect = editorWrapperEl.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        if (clickX > editorWrapperEl.clientWidth || clickY > editorWrapperEl.clientHeight) {
          return;
        }
        editor.focus();
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    });
  }

  // Reposition popup on scroll/resize
  ['scroll', 'resize'].forEach(ev => window.addEventListener(ev, () => {
    if (selectedTextBox && !tbPopup.hidden) positionTbPopup(selectedTextBox);
  }, true));

  // Wire popup controls
  ['#tbpBorderColor', '#tbpBorderWidth', '#tbpBorderStyle', '#tbpBgColor', '#tbpRadius'].forEach(sel => {
    const el = $(sel);
    if (el) el.addEventListener('input', applyTbStyle);
    if (el) el.addEventListener('change', applyTbStyle);
  });
  $('#tbpBgClear').addEventListener('click', () => {
    if (!selectedTextBox) return;
    selectedTextBox.style.background = 'transparent';
    scheduleSave();
  });
  $('#tbpDelete').addEventListener('click', () => {
    if (!selectedTextBox) return;
    const tb = selectedTextBox;
    deselectTextBox();
    tb.remove();
    scheduleSave();
  });
  $('#tbpClose').addEventListener('click', () => deselectTextBox());

  // Hide popup when clicking outside editor + popup
  document.addEventListener('click', (e) => {
    if (!selectedTextBox) return;
    if (tbPopup.contains(e.target)) return;
    if (selectedTextBox.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.text-box')) return;
    deselectTextBox();
  });

  // ===== Shape & Icon Gallery =====
  const SHAPE_CATALOG = {
    shapes: { label: 'Şekiller', items: [
      { n: 'Kare', s: '<rect x="2" y="2" width="20" height="20"/>' },
      { n: 'Yuvarlak Kare', s: '<rect x="2" y="2" width="20" height="20" rx="4"/>' },
      { n: 'Daire', s: '<circle cx="12" cy="12" r="10"/>' },
      { n: 'Elips', s: '<ellipse cx="12" cy="12" rx="11" ry="7"/>' },
      { n: 'Üçgen', s: '<polygon points="12,2 22,22 2,22"/>' },
      { n: 'Sağ Üçgen', s: '<polygon points="2,2 22,22 2,22"/>' },
      { n: 'Eşkenar Dörtgen', s: '<polygon points="12,2 22,12 12,22 2,12"/>' },
      { n: 'Beşgen', s: '<polygon points="12,2 22,9 18,22 6,22 2,9"/>' },
      { n: 'Altıgen', s: '<polygon points="6,2 18,2 22,12 18,22 6,22 2,12"/>' },
      { n: 'Sekizgen', s: '<polygon points="8,2 16,2 22,8 22,16 16,22 8,22 2,16 2,8"/>' },
      { n: 'Yıldız 5', s: '<polygon points="12,2 14.5,9 22,9 16,14 18.5,21 12,17 5.5,21 8,14 2,9 9.5,9"/>' },
      { n: 'Yıldız 4', s: '<polygon points="12,2 14,10 22,12 14,14 12,22 10,14 2,12 10,10"/>' },
      { n: 'Yıldız 6', s: '<polygon points="12,2 14,8 20,8 16,12 20,18 14,16 12,22 10,16 4,18 8,12 4,8 10,8"/>' },
      { n: 'Kalp', s: '<path d="M12 21s-8-5-8-11a5 5 0 0 1 8-4 5 5 0 0 1 8 4c0 6-8 11-8 11z"/>' },
      { n: 'Bulut', s: '<path d="M6 18h12a4 4 0 0 0 0-8 6 6 0 0 0-11.5-1A4 4 0 0 0 6 18z"/>' },
      { n: 'Paralelkenar', s: '<polygon points="6,4 22,4 18,20 2,20"/>' },
      { n: 'Yamuk', s: '<polygon points="6,4 18,4 22,20 2,20"/>' },
      { n: 'Artı Şekli', s: '<polygon points="9,2 15,2 15,9 22,9 22,15 15,15 15,22 9,22 9,15 2,15 2,9 9,9"/>' },
      { n: 'Konuşma', s: '<path d="M21 12a8 8 0 0 1-11.3 7.3L4 21l1.7-5.7A8 8 0 1 1 21 12z"/>' },
      { n: 'Düşünce', s: '<path d="M19 8a5 5 0 0 0-9-3 5 5 0 0 0-7 7 5 5 0 0 0 7 4 5 5 0 0 0 9-1 5 5 0 0 0 0-7zM5 19a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0zM2 22a1 1 0 1 0 2 0 1 1 0 0 0-2 0z"/>' },
    ]},
    arrows: { label: 'Oklar', items: [
      { n: 'Sağ Ok', s: '<path d="M4 12h14M14 6l6 6-6 6"/>' },
      { n: 'Sol Ok', s: '<path d="M20 12H6M10 6l-6 6 6 6"/>' },
      { n: 'Yukarı Ok', s: '<path d="M12 20V6M6 10l6-6 6 6"/>' },
      { n: 'Aşağı Ok', s: '<path d="M12 4v14M6 14l6 6 6-6"/>' },
      { n: 'Sağ Üst', s: '<path d="M5 19L19 5M9 5h10v10"/>' },
      { n: 'Sol Üst', s: '<path d="M19 19L5 5M15 5H5v10"/>' },
      { n: 'Sağ Alt', s: '<path d="M5 5l14 14M19 9v10H9"/>' },
      { n: 'Sol Alt', s: '<path d="M19 5L5 19M5 9v10h10"/>' },
      { n: 'Çift Yatay', s: '<path d="M2 12h20M6 8l-4 4 4 4M18 8l4 4-4 4"/>' },
      { n: 'Çift Dikey', s: '<path d="M12 2v20M8 6l4-4 4 4M8 18l4 4 4-4"/>' },
      { n: 'Geri Dön', s: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v6h6"/>' },
      { n: 'Yenile', s: '<path d="M21 12a9 9 0 1 1-3-6.7M21 4v6h-6"/>' },
      { n: 'Değiş', s: '<path d="M7 4l-4 4 4 4M3 8h14M17 14l4 4-4 4M21 18H7"/>' },
      { n: 'Karışık', s: '<path d="M16 3l4 4-4 4M4 7h16M16 13l4 4-4 4M4 17h10"/>' },
      { n: 'Eğri Sol', s: '<path d="M3 12c0-5 4-9 9-9s9 4 9 9M21 12l-4 4M21 12l-4-4"/>' },
      { n: 'Eğri Sağ', s: '<path d="M21 12c0-5-4-9-9-9s-9 4-9 9M3 12l4 4M3 12l4-4"/>' },
      { n: 'Şeritli Sağ', s: '<polygon points="2,9 14,9 14,4 22,12 14,20 14,15 2,15"/>' },
      { n: 'Şeritli Sol', s: '<polygon points="22,9 10,9 10,4 2,12 10,20 10,15 22,15"/>' },
      { n: 'Şeritli Yukarı', s: '<polygon points="9,22 9,10 4,10 12,2 20,10 15,10 15,22"/>' },
      { n: 'Şeritli Aşağı', s: '<polygon points="9,2 9,14 4,14 12,22 20,14 15,14 15,2"/>' },
    ]},
    basic: { label: 'Temel', items: [
      { n: 'Artı', s: '<path d="M12 4v16M4 12h16"/>' },
      { n: 'Eksi', s: '<path d="M4 12h16"/>' },
      { n: 'Çarpı', s: '<path d="M5 5l14 14M19 5L5 19"/>' },
      { n: 'Eşittir', s: '<path d="M5 9h14M5 15h14"/>' },
      { n: 'Tik', s: '<path d="M5 12l5 5L20 7"/>' },
      { n: 'X Daire', s: '<circle cx="12" cy="12" r="10"/><path d="M8 8l8 8M16 8l-8 8"/>' },
      { n: 'Tik Daire', s: '<circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-6"/>' },
      { n: 'Bilgi', s: '<circle cx="12" cy="12" r="10"/><path d="M12 8v.01M11 12h1v5h1"/>' },
      { n: 'Uyarı', s: '<path d="M12 2L2 22h20L12 2zM12 10v5M12 18v.01"/>' },
      { n: 'Soru', s: '<circle cx="12" cy="12" r="10"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 3-3 5M12 17v.01"/>' },
      { n: 'Yıldırım', s: '<path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/>' },
      { n: 'Güneş', s: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>' },
      { n: 'Ay', s: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>' },
      { n: 'Ateş', s: '<path d="M12 2s4 4 4 8a4 4 0 1 1-8 0c0-2 2-3 2-3s-1-3 2-5zM12 22a6 6 0 0 0 6-6c0-3-3-4-3-4s-1 2-3 2-3-2-3-2-3 1-3 4a6 6 0 0 0 6 6z"/>' },
      { n: 'Damla', s: '<path d="M12 2s7 8 7 13a7 7 0 0 1-14 0c0-5 7-13 7-13z"/>' },
    ]},
    office: { label: 'Ofis', items: [
      { n: 'Dosya', s: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>' },
      { n: 'Klasör', s: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>' },
      { n: 'Mektup', s: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6L12 13 2 6"/>' },
      { n: 'Telefon', s: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2z"/>' },
      { n: 'Takvim', s: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
      { n: 'Saat', s: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
      { n: 'Kullanıcı', s: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2"/>' },
      { n: 'Grup', s: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M15 21v-1a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v1"/>' },
      { n: 'Yazıcı', s: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>' },
      { n: 'Kaydet', s: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>' },
      { n: 'Çöp', s: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' },
      { n: 'Bağlantı', s: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>' },
      { n: 'Kalem', s: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>' },
      { n: 'Sepet', s: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>' },
      { n: 'Etiket', s: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>' },
    ]},
    tech: { label: 'Teknoloji', items: [
      { n: 'WiFi', s: '<path d="M5 13a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0M12 20h.01M2 8.82a15 15 0 0 1 20 0"/>' },
      { n: 'Pil', s: '<rect x="2" y="7" width="18" height="10" rx="2"/><line x1="22" y1="11" x2="22" y2="13"/><line x1="6" y1="11" x2="6" y2="13"/><line x1="10" y1="11" x2="10" y2="13"/>' },
      { n: 'Şarj', s: '<path d="M14 2L4 14h7l-1 8 10-12h-7z"/>' },
      { n: 'Kilit', s: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>' },
      { n: 'Anahtar', s: '<path d="M21 2l-9.6 9.6a5.5 5.5 0 1 1-2 2L19 2zM15.5 7.5l1 1"/>' },
      { n: 'Göz', s: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>' },
      { n: 'Arama', s: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>' },
      { n: 'Ayar', s: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' },
      { n: 'Yıldız', s: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' },
      { n: 'İndir', s: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>' },
      { n: 'Yükle', s: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>' },
      { n: 'Bilgisayar', s: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>' },
      { n: 'Telefon Mob', s: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>' },
      { n: 'Bulut Tek', s: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>' },
      { n: 'Veri', s: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5M3 12a9 3 0 0 0 18 0"/>' },
    ]},
  };

  const shapeOverlay = $('#shapeGalleryOverlay');
  const shapeTabs = $('#shapeGalleryTabs');
  const shapeGrid = $('#shapeGalleryGrid');
  const shapeSearch = $('#shapeSearch');
  const shapeColor = $('#shapeColor');
  const shapeFill = $('#shapeFill');
  let shapeActiveTab = 'shapes';

  function buildShapeSvg(item, opts = {}) {
    const color = opts.color || '#222222';
    const fill = opts.fill ? color : 'none';
    const stroke = color;
    const sw = opts.fill ? 0 : 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="120" height="120" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${item.s}</svg>`;
  }

  function svgDataUrl(svgStr) {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svgStr);
  }

  function renderShapeTabs() {
    shapeTabs.innerHTML = '';
    Object.entries(SHAPE_CATALOG).forEach(([key, cat]) => {
      const btn = document.createElement('button');
      btn.textContent = cat.label;
      btn.dataset.tab = key;
      if (key === shapeActiveTab) btn.classList.add('active');
      btn.addEventListener('click', () => {
        shapeActiveTab = key;
        shapeSearch.value = '';
        renderShapeTabs();
        renderShapeGrid();
      });
      shapeTabs.appendChild(btn);
    });
  }

  function renderShapeGrid() {
    shapeGrid.innerHTML = '';
    const q = (shapeSearch.value || '').trim().toLowerCase();
    let items;
    if (q) {
      items = [];
      for (const [, cat] of Object.entries(SHAPE_CATALOG)) {
        for (const item of cat.items) {
          if (item.n.toLowerCase().includes(q)) items.push(item);
        }
      }
    } else {
      items = SHAPE_CATALOG[shapeActiveTab].items;
    }
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'shape-gallery-empty';
      empty.textContent = 'Sonuç yok';
      shapeGrid.appendChild(empty);
      return;
    }
    const opts = { color: shapeColor.value, fill: shapeFill.checked };
    items.forEach(item => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'shape-tile';
      tile.title = item.n;
      tile.innerHTML = buildShapeSvg(item, opts);
      tile.addEventListener('click', () => insertShapeFromItem(item));
      shapeGrid.appendChild(tile);
    });
  }

  function insertShapeFromItem(item) {
    const opts = { color: shapeColor.value, fill: shapeFill.checked };
    const svg = buildShapeSvg(item, opts);
    closeShapeGallery();
    insertImage(svgDataUrl(svg));
    scheduleSave();
  }

  function openShapeGallery() {
    shapeOverlay.hidden = false;
    shapeOverlay.style.display = '';
    renderShapeTabs();
    renderShapeGrid();
    setTimeout(() => shapeSearch.focus(), 50);
  }

  function closeShapeGallery() {
    shapeOverlay.hidden = true;
    shapeOverlay.style.display = 'none';
  }

  $('#shapeGalleryClose').addEventListener('click', closeShapeGallery);
  shapeOverlay.addEventListener('click', (e) => {
    if (e.target === shapeOverlay) closeShapeGallery();
  });
  shapeSearch.addEventListener('input', renderShapeGrid);
  shapeColor.addEventListener('input', renderShapeGrid);
  shapeFill.addEventListener('change', renderShapeGrid);

  // ===== Table Grid Popup =====
  let __ctxTableCell = null;

  function handleTableAction(action) {
    const td = __ctxTableCell;
    if (!td) return;
    const tr = td.parentNode;
    const table = td.closest('table');
    if (!tr || !table) return;
    const colIdx = [...tr.children].indexOf(td);
    if (action === 'tableDelete') {
      table.remove();
    } else if (action === 'tableDeleteRow') {
      if (table.querySelectorAll('tr').length <= 1) {
        table.remove();
      } else {
        tr.remove();
      }
    } else if (action === 'tableDeleteCol') {
      const rows = table.querySelectorAll('tr');
      const cols = rows[0] ? rows[0].children.length : 0;
      if (cols <= 1) {
        table.remove();
      } else {
        rows.forEach(r => { if (r.children[colIdx]) r.children[colIdx].remove(); });
      }
    } else if (action === 'tableAddRowAbove' || action === 'tableAddRowBelow') {
      const cols = tr.children.length;
      const newTr = document.createElement('tr');
      for (let i = 0; i < cols; i++) {
        const newTd = document.createElement('td');
        newTd.innerHTML = '&nbsp;';
        newTr.appendChild(newTd);
      }
      if (action === 'tableAddRowAbove') tr.parentNode.insertBefore(newTr, tr);
      else tr.parentNode.insertBefore(newTr, tr.nextSibling);
    } else if (action === 'tableAddColLeft' || action === 'tableAddColRight') {
      const rows = table.querySelectorAll('tr');
      rows.forEach(r => {
        const newTd = document.createElement('td');
        newTd.innerHTML = '&nbsp;';
        const ref = r.children[colIdx];
        if (!ref) { r.appendChild(newTd); return; }
        if (action === 'tableAddColLeft') r.insertBefore(newTd, ref);
        else r.insertBefore(newTd, ref.nextSibling);
      });
    }
    __ctxTableCell = null;
    scheduleSave();
  }

  const tableGridPopup = $('#tableGridPopup');
  const tgGrid = $('#tgGrid');
  const tgInfoText = $('#tgInfoText');
  const TG_ROWS = 8, TG_COLS = 10;
  let tgSelected = { r: 0, c: 0 };

  function buildTgGrid() {
    tgGrid.innerHTML = '';
    for (let r = 0; r < TG_ROWS; r++) {
      for (let c = 0; c < TG_COLS; c++) {
        const cell = document.createElement('div');
        cell.className = 'tg-cell';
        cell.dataset.r = r;
        cell.dataset.c = c;
        cell.addEventListener('mouseenter', () => highlightTgCells(r + 1, c + 1));
        cell.addEventListener('click', () => {
          insertTable(r + 1, c + 1);
          closeTableGridPopup();
        });
        tgGrid.appendChild(cell);
      }
    }
  }

  function highlightTgCells(rows, cols) {
    tgSelected = { r: rows, c: cols };
    tgInfoText.textContent = `${rows} × ${cols}`;
    [...tgGrid.children].forEach(cell => {
      const cr = +cell.dataset.r;
      const cc = +cell.dataset.c;
      cell.classList.toggle('tg-on', cr < rows && cc < cols);
    });
  }

  function openTableGridPopup() {
    if (!tgGrid.children.length) buildTgGrid();
    highlightTgCells(0, 0);
    const btn = document.querySelector('button[data-action="insertTable"]');
    const r = btn ? btn.getBoundingClientRect() : { left: 100, bottom: 80 };
    tableGridPopup.style.left = Math.min(r.left, window.innerWidth - 240) + 'px';
    tableGridPopup.style.top = (r.bottom + 4) + 'px';
    tableGridPopup.hidden = false;
    saveSelection();
  }
  function closeTableGridPopup() {
    tableGridPopup.hidden = true;
  }

  function insertTable(rows, cols) {
    restoreSelection();
    editor.focus();
    let html = '<table class="editor-table">';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) html += '<td>&nbsp;</td>';
      html += '</tr>';
    }
    html += '</table><p><br></p>';
    document.execCommand('insertHTML', false, html);
    scheduleSave();
  }

  document.addEventListener('click', (e) => {
    if (!tableGridPopup.hidden &&
        !tableGridPopup.contains(e.target) &&
        !e.target.closest('button[data-action="insertTable"]')) {
      closeTableGridPopup();
    }
  });

  // ===== Link Dialog & Hover Preview =====
  const linkDialog = $('#linkDialog');
  const linkUrlInput = $('#linkUrlInput');
  const linkTextInput = $('#linkTextInput');
  const linkDescInput = $('#linkDescInput');
  const linkPreview = $('#linkPreview');

  function openLinkDialog() {
    saveSelection();
    const sel = window.getSelection();
    const selText = sel && sel.toString ? sel.toString() : '';
    linkUrlInput.value = '';
    linkTextInput.value = selText;
    linkDescInput.value = '';
    linkDialog.hidden = false;
    linkDialog.style.display = '';
    setTimeout(() => linkUrlInput.focus(), 50);
  }
  function closeLinkDialog() {
    linkDialog.hidden = true;
    linkDialog.style.display = 'none';
  }

  $('#linkDialogClose').addEventListener('click', closeLinkDialog);
  linkDialog.addEventListener('click', (e) => { if (e.target === linkDialog) closeLinkDialog(); });

  $('#linkInsertBtn').addEventListener('click', () => {
    let url = linkUrlInput.value.trim();
    const text = (linkTextInput.value || url).trim();
    const desc = linkDescInput.value.trim();
    if (!url) { linkUrlInput.focus(); return; }
    if (!/^[a-z]+:/i.test(url)) url = 'https://' + url;
    restoreSelection();
    editor.focus();
    const wrap = document.createElement('span');
    wrap.className = 'link-block';
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = text;
    a.className = 'link-text';
    wrap.appendChild(a);
    wrap.appendChild(document.createElement('br'));
    const card = document.createElement('span');
    card.className = 'link-card-inline';
    card.contentEditable = 'false';
    card.dataset.linkHref = url;
    card.innerHTML = `
      <span class="lc-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8v.01"/></svg></span>
      <span class="lc-body">
        <span class="lc-url"></span>
        <span class="lc-desc"></span>
      </span>`;
    card.querySelector('.lc-url').textContent = url;
    card.querySelector('.lc-desc').textContent = desc || '';
    if (!desc) card.querySelector('.lc-desc').remove();
    wrap.appendChild(card);
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(wrap);
      const trail = document.createTextNode(' ');
      wrap.after(trail);
      const newRange = document.createRange();
      newRange.setStartAfter(trail);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
    } else {
      editor.appendChild(wrap);
    }
    closeLinkDialog();
    scheduleSave();
  });

  // Click on link or link-card → open URL in new tab
  editor.addEventListener('click', (e) => {
    const card = e.target.closest && e.target.closest('.link-card-inline');
    if (card && editor.contains(card)) {
      const url = card.dataset.linkHref;
      if (url && isSafeLinkUrl(url)) {
        e.preventDefault();
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    const a = e.target.closest && e.target.closest('a[href]');
    if (a && editor.contains(a)) {
      e.preventDefault();
      window.open(a.href, '_blank', 'noopener,noreferrer');
    }
  });

  // ===== Rulers + Grid Toggle =====
  const editorWrapper = document.querySelector('.editor-wrapper');
  function applyRulersGridFromNote() {
    const note = getActiveNote();
    if (!note || !editorWrapper) return;
    editorWrapper.classList.toggle('show-rulers', !!note.showRulers);
    editorWrapper.classList.toggle('show-grid', !!note.showGrid);
  }
  function toggleRulersAndGrid() {
    const note = getActiveNote();
    if (!note) return;
    const on = !(note.showRulers || note.showGrid);
    note.showRulers = on;
    note.showGrid = on;
    applyRulersGridFromNote();
    scheduleSave();
  }

  // ===== Background Image =====
  function setEditorBgFromNote() {
    const note = getActiveNote();
    if (!note || !editor) return;
    if (note.bgImage) {
      editor.style.backgroundImage = `url('${note.bgImage}')`;
      editor.classList.add('has-bg');
      editor.classList.toggle('bg-cover', note.bgImageMode === 'cover');
      editor.style.setProperty('--editor-bg-image', `url('${note.bgImage}')`);
    } else {
      editor.style.backgroundImage = '';
      editor.classList.remove('has-bg', 'bg-cover');
      editor.style.removeProperty('--editor-bg-image');
    }
  }
  function setBackgroundFromImage(img) {
    const note = getActiveNote();
    if (!note || !img) return;
    note.bgImage = img.src;
    note.bgImageMode = note.bgImageMode || 'fit';
    if (typeof deselectImage === 'function') deselectImage();
    img.remove();
    setEditorBgFromNote();
    scheduleSave();
  }
  function clearBackground() {
    const note = getActiveNote();
    if (!note) return;
    note.bgImage = '';
    setEditorBgFromNote();
    scheduleSave();
  }
  function toggleBackgroundMode() {
    const note = getActiveNote();
    if (!note || !note.bgImage) return;
    note.bgImageMode = note.bgImageMode === 'cover' ? 'fit' : 'cover';
    setEditorBgFromNote();
    scheduleSave();
  }
  // Expose for image panel
  window.__npSetBgFromImage = setBackgroundFromImage;
  window.__npClearBg = clearBackground;
  window.__npToggleBgMode = toggleBackgroundMode;
  window.__npApplyBg = setEditorBgFromNote;
  window.__npApplyRulersGrid = applyRulersGridFromNote;

  // ===== Calculator =====
  const calcPanel = $('#calcPanel');
  const calcDisp = $('#calcDisp');
  let calcExpr = '';

  function openCalc() {
    calcPanel.hidden = false;
    calcPanel.style.display = '';
    calcDisp.value = calcExpr || '0';
  }
  function closeCalc() {
    calcPanel.hidden = true;
    calcPanel.style.display = 'none';
  }
  function toggleCalculator() {
    if (calcPanel.hidden) openCalc(); else closeCalc();
  }
  function calcUpdate() {
    calcDisp.value = calcExpr || '0';
  }
  function calcEval() {
    if (!calcExpr) return;
    let s = calcExpr.replace(/×/g, '*').replace(/÷/g, '/').replace(/π/g, 'Math.PI').replace(/√\(/g, 'Math.sqrt(').replace(/\^/g, '**');
    if (!/^[\d+\-*/().% \^MathPIsqrte]*$/.test(s)) { calcDisp.value = 'ERR'; return; }
    try {
      const result = Function('"use strict"; return (' + s + ')')();
      if (typeof result !== 'number' || !isFinite(result)) { calcDisp.value = 'ERR'; return; }
      calcExpr = String(Math.round(result * 1e10) / 1e10);
      calcUpdate();
    } catch (_) {
      calcDisp.value = 'ERR';
    }
  }
  $('#calcClose').addEventListener('click', closeCalc);
  calcPanel.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-calc]');
    if (!btn) return;
    const k = btn.dataset.calc;
    if (k === 'clear') { calcExpr = ''; calcUpdate(); return; }
    if (k === 'back') { calcExpr = calcExpr.slice(0, -1); calcUpdate(); return; }
    if (k === 'eq') { calcEval(); return; }
    if (k === 'neg') {
      if (!calcExpr) { calcExpr = '-'; calcUpdate(); return; }
      const m = calcExpr.match(/(-?\d+\.?\d*)$/);
      if (m) {
        const num = m[1];
        const negd = num.startsWith('-') ? num.slice(1) : '-' + num;
        calcExpr = calcExpr.slice(0, -num.length) + negd;
      }
      calcUpdate();
      return;
    }
    if (k === 'sqrt') { calcExpr += '√('; calcUpdate(); return; }
    if (k === 'pi') { calcExpr += 'π'; calcUpdate(); return; }
    calcExpr += k;
    calcUpdate();
  });
  // Keyboard input when calc focused
  document.addEventListener('keydown', (e) => {
    if (calcPanel.hidden) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
    if (/^[0-9.+\-*/()%]$/.test(e.key)) { calcExpr += e.key; calcUpdate(); e.preventDefault(); }
    else if (e.key === 'Enter' || e.key === '=') { calcEval(); e.preventDefault(); }
    else if (e.key === 'Backspace') { calcExpr = calcExpr.slice(0, -1); calcUpdate(); e.preventDefault(); }
    else if (e.key === 'Escape') { closeCalc(); }
  });
  // Draggable header
  (() => {
    const header = calcPanel.querySelector('.calc-header');
    if (!header) return;
    let dragging = false, dx = 0, dy = 0;
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.calc-close')) return;
      dragging = true;
      const r = calcPanel.getBoundingClientRect();
      dx = e.clientX - r.left; dy = e.clientY - r.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      calcPanel.style.left = (e.clientX - dx) + 'px';
      calcPanel.style.top = (e.clientY - dy) + 'px';
      calcPanel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  })();

  // ===== Mini Calendar =====
  const calPanel = $('#calPanel');
  const calGrid = $('#calGrid');
  const calTitle = $('#calTitle');
  const calInsertBtn = $('#calInsert');
  // View (the month being browsed) and selection (the picked day)
  let calViewYear = new Date().getFullYear();
  let calViewMonth = new Date().getMonth();
  let calSelected = null; // Date object or null

  // Day-of-week headers, starting Monday
  const CAL_DOW = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'];

  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }

  function calMonthLabel(year, month) {
    const months = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
      'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
    return months[month] + ' ' + year;
  }

  function calRender() {
    calTitle.textContent = calMonthLabel(calViewYear, calViewMonth);
    calGrid.innerHTML = '';
    CAL_DOW.forEach(d => {
      const el = document.createElement('div');
      el.className = 'cal-dow';
      el.textContent = d;
      calGrid.appendChild(el);
    });
    const first = new Date(calViewYear, calViewMonth, 1);
    // Make Monday=0 ... Sunday=6
    const lead = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();
    const daysInPrev = new Date(calViewYear, calViewMonth, 0).getDate();
    const today = new Date();

    // Leading days from previous month (greyed)
    for (let i = lead - 1; i >= 0; i--) {
      const d = new Date(calViewYear, calViewMonth - 1, daysInPrev - i);
      calGrid.appendChild(calMakeCell(d, true, today));
    }
    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(calViewYear, calViewMonth, day);
      calGrid.appendChild(calMakeCell(d, false, today));
    }
    // Trailing days to fill the grid (6 rows = 42 cells)
    const filled = lead + daysInMonth;
    const trail = (filled % 7 === 0) ? 0 : 7 - (filled % 7);
    for (let i = 1; i <= trail; i++) {
      const d = new Date(calViewYear, calViewMonth + 1, i);
      calGrid.appendChild(calMakeCell(d, true, today));
    }
    calInsertBtn.disabled = !calSelected;
  }

  function calMakeCell(d, other, today) {
    const cell = document.createElement('div');
    cell.className = 'cal-cell' + (other ? ' cal-other' : '');
    if (isSameDay(d, today)) cell.classList.add('cal-today');
    if (calSelected && isSameDay(d, calSelected)) cell.classList.add('cal-selected');
    cell.textContent = d.getDate();
    cell.addEventListener('click', () => {
      calSelected = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      // If user clicks a greyed-out neighbour, jump the view to that month too
      if (other) {
        calViewYear = d.getFullYear();
        calViewMonth = d.getMonth();
      }
      calRender();
    });
    return cell;
  }

  function calFormat(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function openCal() {
    calPanel.hidden = false;
    calPanel.style.display = '';
    const now = new Date();
    calViewYear = now.getFullYear();
    calViewMonth = now.getMonth();
    calSelected = null;
    calRender();
  }
  function closeCal() {
    calPanel.hidden = true;
    calPanel.style.display = 'none';
  }
  function toggleCalendar() {
    if (calPanel.hidden) openCal(); else closeCal();
  }
  $('#calClose').addEventListener('click', closeCal);
  $('#calPrev').addEventListener('click', () => {
    calViewMonth--;
    if (calViewMonth < 0) { calViewMonth = 11; calViewYear--; }
    calRender();
  });
  $('#calNext').addEventListener('click', () => {
    calViewMonth++;
    if (calViewMonth > 11) { calViewMonth = 0; calViewYear++; }
    calRender();
  });
  $('#calToday').addEventListener('click', () => {
    const now = new Date();
    calViewYear = now.getFullYear();
    calViewMonth = now.getMonth();
    calSelected = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    calRender();
  });
  $('#calInsert').addEventListener('click', () => {
    if (!calSelected) return;
    editor.focus();
    execCmd('insertText', calFormat(calSelected));
  });
  // Esc closes the calendar
  document.addEventListener('keydown', (e) => {
    if (!calPanel.hidden && e.key === 'Escape') closeCal();
  });
  // Draggable header
  (() => {
    const header = calPanel.querySelector('.cal-header');
    if (!header) return;
    let dragging = false, dx = 0, dy = 0;
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.cal-close') || e.target.closest('.cal-nav')) return;
      dragging = true;
      const r = calPanel.getBoundingClientRect();
      dx = e.clientX - r.left; dy = e.clientY - r.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      calPanel.style.left = (e.clientX - dx) + 'px';
      calPanel.style.top = (e.clientY - dy) + 'px';
      calPanel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  })();

  // ===== Mini Sheet (formula-enabled) =====
  function colLetter(i) {
    let s = '';
    while (i >= 0) { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; }
    return s;
  }

  function insertMiniSheet(rows = 5, cols = 4) {
    editor.focus();
    const wrap = document.createElement('div');
    wrap.className = 'mini-sheet';
    wrap.contentEditable = 'false';
    wrap.dataset.rows = rows;
    wrap.dataset.cols = cols;
    wrap.innerHTML = buildSheetHtml(rows, cols);
    const sel = window.getSelection();
    if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(wrap);
      const after = document.createElement('p');
      after.innerHTML = '<br>';
      wrap.after(after);
      const r = document.createRange();
      r.setStart(after, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    } else {
      editor.appendChild(wrap);
    }
    scheduleSave();
  }

  function buildSheetHtml(rows, cols) {
    let h = '<div class="ms-toolbar">';
    h += '<button data-msact="addRow">+ Satır</button>';
    h += '<button data-msact="addCol">+ Sütun</button>';
    h += '<button data-msact="delRow">- Satır</button>';
    h += '<button data-msact="delCol">- Sütun</button>';
    h += '<button data-msact="del" class="ms-danger">Sil</button>';
    h += '</div>';
    h += '<table><thead><tr><th></th>';
    for (let c = 0; c < cols; c++) h += `<th>${colLetter(c)}</th>`;
    h += '</tr></thead><tbody>';
    for (let r = 0; r < rows; r++) {
      h += `<tr><th>${r + 1}</th>`;
      for (let c = 0; c < cols; c++) {
        h += `<td contenteditable="true" data-r="${r}" data-c="${c}"></td>`;
      }
      h += '</tr>';
    }
    h += '</tbody></table>';
    return h;
  }

  function getSheetData(sheet) {
    const tbody = sheet.querySelector('tbody');
    const rows = tbody ? tbody.querySelectorAll('tr') : [];
    const data = [];
    rows.forEach(tr => {
      const cells = tr.querySelectorAll('td');
      const row = [];
      cells.forEach(td => {
        const f = td.dataset.formula;
        if (f) row.push(f);
        else row.push(td.textContent.trim());
      });
      data.push(row);
    });
    return data;
  }

  function cellRefValue(data, ref) {
    const m = ref.match(/^([A-Z]+)(\d+)$/);
    if (!m) return 0;
    const col = m[1].split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
    const row = parseInt(m[2], 10) - 1;
    if (row < 0 || row >= data.length) return 0;
    if (col < 0 || col >= data[row].length) return 0;
    const v = data[row][col];
    if (typeof v === 'string' && v.startsWith('=')) {
      return evalFormula(data, v.slice(1)) || 0;
    }
    const n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function expandRange(data, range) {
    const m = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    if (!m) return [];
    const c1 = m[1].split('').reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
    const r1 = parseInt(m[2], 10) - 1;
    const c2 = m[3].split('').reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
    const r2 = parseInt(m[4], 10) - 1;
    const out = [];
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
      for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
        out.push(cellRefValue(data, colLetter(c) + (r + 1)));
      }
    }
    return out;
  }

  function evalFormula(data, expr) {
    try {
      // Normalize to uppercase so refs like a1, b2:c3, sum(...) all work
      let s = String(expr).toUpperCase();
      // Resolve functions: SUM, AVG/AVERAGE, MIN, MAX, COUNT
      s = s.replace(/(SUM|AVG|AVERAGE|MIN|MAX|COUNT)\s*\(([^)]+)\)/g, (m, fn, args) => {
        const parts = args.split(',').map(p => p.trim());
        const vals = [];
        parts.forEach(p => {
          if (/^[A-Z]+\d+:[A-Z]+\d+$/.test(p)) vals.push(...expandRange(data, p));
          else if (/^[A-Z]+\d+$/.test(p)) vals.push(cellRefValue(data, p));
          else { const n = parseFloat(p); if (isFinite(n)) vals.push(n); }
        });
        if (fn === 'SUM') return vals.reduce((a, b) => a + b, 0);
        if (fn === 'AVG' || fn === 'AVERAGE') return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        if (fn === 'MIN') return vals.length ? Math.min(...vals) : 0;
        if (fn === 'MAX') return vals.length ? Math.max(...vals) : 0;
        if (fn === 'COUNT') return vals.length;
        return 0;
      });
      // Resolve cell refs
      s = s.replace(/[A-Z]+\d+/g, (ref) => cellRefValue(data, ref));
      // Sanitize: only digits, ops, parens, decimal, spaces
      if (!/^[\d+\-*/().\s]*$/.test(s)) return '#ERR';
      const v = Function('"use strict"; return (' + s + ')')();
      if (typeof v !== 'number' || !isFinite(v)) return '#ERR';
      return Math.round(v * 1e10) / 1e10;
    } catch (_) {
      return '#ERR';
    }
  }

  function recalcSheet(sheet) {
    const data = getSheetData(sheet);
    sheet.querySelectorAll('td').forEach(td => {
      const f = td.dataset.formula;
      if (f) {
        const v = evalFormula(data, f);
        td.classList.add('ms-formula');
        td.classList.toggle('ms-error', v === '#ERR');
        td.textContent = v;
      } else {
        td.classList.remove('ms-formula', 'ms-error');
      }
    });
  }

  // Sheet event handling — delegate via editor
  editor.addEventListener('focusin', (e) => {
    const td = e.target.closest && e.target.closest('.mini-sheet td');
    if (!td) return;
    if (td.dataset.formula) td.textContent = '=' + td.dataset.formula;
  });
  editor.addEventListener('focusout', (e) => {
    const td = e.target.closest && e.target.closest('.mini-sheet td');
    if (!td) return;
    const sheet = td.closest('.mini-sheet');
    const txt = td.textContent.trim();
    if (txt.startsWith('=')) td.dataset.formula = txt.slice(1);
    else delete td.dataset.formula;
    recalcSheet(sheet);
    scheduleSave();
  });
  editor.addEventListener('keydown', (e) => {
    const td = e.target.closest && e.target.closest('.mini-sheet td');
    if (!td) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      td.blur();
      const next = td.parentNode.nextElementSibling?.children[[...td.parentNode.children].indexOf(td)];
      if (next) next.focus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      td.blur();
      const idx = [...td.parentNode.children].indexOf(td);
      const next = e.shiftKey ? td.parentNode.children[idx - 1] : td.parentNode.children[idx + 1];
      if (next && next.tagName === 'TD') next.focus();
    }
  });
  // Sheet toolbar actions
  editor.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.mini-sheet .ms-toolbar button[data-msact]');
    if (!btn) return;
    const sheet = btn.closest('.mini-sheet');
    const action = btn.dataset.msact;
    e.preventDefault();
    e.stopPropagation();
    if (action === 'del') {
      sheet.remove();
      scheduleSave();
      return;
    }
    const tbody = sheet.querySelector('tbody');
    const headRow = sheet.querySelector('thead tr');
    const rows = tbody.querySelectorAll('tr');
    const cols = rows[0] ? rows[0].querySelectorAll('td').length : 0;
    if (action === 'addRow') {
      const tr = document.createElement('tr');
      tr.innerHTML = `<th>${rows.length + 1}</th>` + '<td contenteditable="true"></td>'.repeat(cols);
      tbody.appendChild(tr);
    } else if (action === 'addCol') {
      const newLetter = colLetter(cols);
      headRow.appendChild(Object.assign(document.createElement('th'), { textContent: newLetter }));
      rows.forEach(r => {
        const td = document.createElement('td');
        td.contentEditable = 'true';
        r.appendChild(td);
      });
    } else if (action === 'delRow') {
      if (rows.length > 1) rows[rows.length - 1].remove();
    } else if (action === 'delCol') {
      if (cols > 1) {
        headRow.lastElementChild?.remove();
        rows.forEach(r => r.lastElementChild?.remove());
      }
    }
    recalcSheet(sheet);
    scheduleSave();
  });

  // Recalc all sheets on note load (after innerHTML sets, formulas need re-eval)
  function recalcAllSheets() {
    editor.querySelectorAll('.mini-sheet').forEach(s => recalcSheet(s));
  }
  window.__npRecalcSheets = recalcAllSheets;

  // Drag & drop: internal element move + external image files
  let __internalDragNode = null;

  editor.addEventListener('dragstart', (e) => {
    const tgt = e.target;
    if (!tgt || !editor.contains(tgt)) return;
    let node = null;
    if (tgt.tagName === 'IMG') node = tgt;
    else if (tgt.classList && tgt.classList.contains('text-box')) node = tgt;
    if (!node) return;
    __internalDragNode = node;
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'np-internal');
    } catch (_) {}
    node.classList.add('np-dragging');
  });

  editor.addEventListener('dragend', () => {
    if (__internalDragNode) {
      __internalDragNode.classList.remove('np-dragging');
      __internalDragNode = null;
    }
  });

  editor.addEventListener('dragover', (e) => {
    if (__internalDragNode) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      return;
    }
    if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
      e.preventDefault();
    }
  });

  function getDropRange(x, y) {
    if (document.caretRangeFromPoint) {
      return document.caretRangeFromPoint(x, y);
    }
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        const r = document.createRange();
        r.setStart(pos.offsetNode, pos.offset);
        r.collapse(true);
        return r;
      }
    }
    return null;
  }

  editor.addEventListener('drop', (e) => {
    if (__internalDragNode) {
      e.preventDefault();
      const node = __internalDragNode;
      const range = getDropRange(e.clientX, e.clientY);
      if (range && editor.contains(range.startContainer)) {
        // Skip if dropping into the dragged node itself
        if (!node.contains(range.startContainer)) {
          range.insertNode(node);
          const after = document.createRange();
          after.setStartAfter(node);
          after.collapse(true);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(after);
        }
      }
      node.classList.remove('np-dragging');
      __internalDragNode = null;
      scheduleSave();
      return;
    }
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    const imgs = [...files].filter(f => f.type.startsWith('image/'));
    if (!imgs.length) return;
    e.preventDefault();
    imgs.forEach(file => {
      insertImageFromFile(file)
        .then(() => scheduleSave())
        .catch(err => console.error('[image] drop failed', err));
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.save-dropdown-wrap')) {
      closeSaveDropdown();
      closeShareDropdown();
    }
  });

  function downloadNote() {
    const note = getActiveNote();
    if (!note) return;
    const text = editor.innerText || '';
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (note.title || 'untitled') + '.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function downloadAsPdf() {
    const note = getActiveNote();
    if (!note) return;
    const title = note.title || 'untitled';
    const clone = editor.cloneNode(true);
    clone.style.padding = '20px';
    clone.style.fontFamily = 'sans-serif';
    html2pdf().set({
      margin: 10,
      filename: title + '.pdf',
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(clone).save();
  }

  function downloadAsWord() {
    const note = getActiveNote();
    if (!note) return;
    const title = note.title || 'untitled';
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;font-size:14px;line-height:1.6;}</style></head><body>${editor.innerHTML}</body></html>`;
    const blob = htmlDocx.asBlob(html);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = title + '.docx';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function htmlToMarkdown(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    function convertNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.nodeValue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return '';
      }
      
      const tagName = node.tagName.toLowerCase();
      let childrenContent = '';
      node.childNodes.forEach(child => {
        childrenContent += convertNode(child);
      });
      
      switch (tagName) {
        case 'h1': return `\n# ${childrenContent.trim()}\n`;
        case 'h2': return `\n## ${childrenContent.trim()}\n`;
        case 'h3': return `\n### ${childrenContent.trim()}\n`;
        case 'h4': return `\n#### ${childrenContent.trim()}\n`;
        case 'h5': return `\n##### ${childrenContent.trim()}\n`;
        case 'h6': return `\n###### ${childrenContent.trim()}\n`;
        case 'strong':
        case 'b':
          return `**${childrenContent}**`;
        case 'em':
        case 'i':
          return `*${childrenContent}*`;
        case 'u':
          return `<u>${childrenContent}</u>`;
        case 'p':
        case 'div':
          return `\n${childrenContent}\n`;
        case 'br':
          return '\n';
        case 'hr':
          return '\n---\n';
        case 'li': {
          const parent = node.parentNode;
          if (parent && parent.tagName.toLowerCase() === 'ol') {
            const index = Array.from(parent.children).indexOf(node) + 1;
            return `${index}. ${childrenContent.trim()}\n`;
          }
          return `- ${childrenContent.trim()}\n`;
        }
        case 'ul':
        case 'ol':
          return `\n${childrenContent}\n`;
        case 'a': {
          const href = node.getAttribute('href') || '';
          return `[${childrenContent}](${href})`;
        }
        case 'img': {
          const src = node.getAttribute('src') || '';
          const alt = node.getAttribute('alt') || 'image';
          return `![${alt}](${src})`;
        }
        case 'table':
          return `\n${childrenContent}\n`;
        case 'thead':
        case 'tbody':
        case 'tfoot':
          return childrenContent;
        case 'tr': {
          let row = '|';
          let separator = '';
          let isHeader = false;
          let hasCells = false;
          node.childNodes.forEach(child => {
            if (child.nodeType === Node.ELEMENT_NODE) {
              const childTag = child.tagName.toLowerCase();
              if (childTag === 'th' || childTag === 'td') {
                if (childTag === 'th') isHeader = true;
                hasCells = true;
                const cellText = convertNode(child).replace(/\n/g, ' ').trim();
                row += ` ${cellText} |`;
              }
            }
          });
          if (!hasCells) return '';
          row += '\n';
          
          if (isHeader || (node.previousElementSibling === null && node.parentNode.tagName.toLowerCase() === 'table')) {
            separator = '|';
            node.childNodes.forEach(child => {
              if (child.nodeType === Node.ELEMENT_NODE) {
                const childTag = child.tagName.toLowerCase();
                if (childTag === 'th' || childTag === 'td') {
                  separator += ' --- |';
                }
              }
            });
            separator += '\n';
          }
          return row + separator;
        }
        case 'td':
        case 'th':
          return childrenContent;
        default:
          return childrenContent;
      }
    }
    
    let result = '';
    doc.body.childNodes.forEach(child => {
      result += convertNode(child);
    });
    
    return result
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function downloadAsMarkdown() {
    const note = getActiveNote();
    if (!note) return;
    const title = note.title || 'untitled';
    const markdown = htmlToMarkdown(editor.innerHTML);
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = title + '.md';
    a.click();
    URL.revokeObjectURL(a.href);
  }


  // --- Find & Replace ---
  let findIdx = -1;
  function getFindRegExp(needle, forReplace = false) {
    if (!needle) return null;
    const isRegex = $('#findRegex')?.checked;
    const isMatchCase = $('#findMatchCase')?.checked;
    const isWholeWord = $('#findWholeWord')?.checked;
    
    let pattern = needle;
    if (!isRegex) {
      pattern = needle.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    }
    if (isWholeWord) {
      pattern = '\\b' + pattern + '\\b';
    }
    const flags = isMatchCase ? 'g' : 'gi';
    try {
      return new RegExp(pattern, flags);
    } catch (e) {
      if (forReplace) {
        throw new Error('Geçersiz Regex deseni: ' + e.message);
      }
      return null;
    }
  }

  function toggleFindReplace() {
    const dialog = $('#findReplaceDialog');
    const opening = dialog.style.display === 'none';
    dialog.style.display = opening ? 'block' : 'none';
    if (opening) {
      $('#findInput').focus();
    } else {
      clearFindMarks();
      $('#findCount').textContent = '';
    }
  }

  function clearFindMarks() {
    editor.querySelectorAll('mark.find-hit').forEach(m => {
      const txt = document.createTextNode(m.textContent);
      m.replaceWith(txt);
    });
    editor.normalize();
    findIdx = -1;
  }

  function highlightAllMatches(needle) {
    clearFindMarks();
    if (!needle) return 0;
    
    const re = getFindRegExp(needle);
    if (!re) return 0;

    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
        if (n.parentNode && n.parentNode.tagName === 'SCRIPT') return NodeFilter.FILTER_REJECT;
        re.lastIndex = 0;
        return re.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    let count = 0;
    
    for (const node of nodes) {
      const text = node.nodeValue;
      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      re.lastIndex = 0;
      let match;
      
      while ((match = re.exec(text)) !== null) {
        const matchText = match[0];
        if (matchText.length === 0) {
          if (re.lastIndex === match.index) {
            re.lastIndex++;
          }
          continue;
        }
        const index = match.index;
        if (index > lastIdx) {
          frag.appendChild(document.createTextNode(text.slice(lastIdx, index)));
        }
        const mark = document.createElement('mark');
        mark.className = 'find-hit';
        mark.textContent = matchText;
        frag.appendChild(mark);
        count++;
        lastIdx = re.lastIndex;
      }
      if (lastIdx < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx)));
      }
      node.replaceWith(frag);
    }
    return count;
  }

  function findAll() {
    const text = $('#findInput').value;
    if (!text) { clearFindMarks(); $('#findCount').textContent = ''; return 0; }
    const count = highlightAllMatches(text);
    $('#findCount').textContent = count + ' eşleşme';
    findIdx = -1;
    if (count > 0) focusNextMark();
    return count;
  }

  function focusNextMark() {
    const marks = editor.querySelectorAll('mark.find-hit');
    if (!marks.length) return;
    marks.forEach(m => m.classList.remove('find-current'));
    findIdx = (findIdx + 1) % marks.length;
    const cur = marks[findIdx];
    cur.classList.add('find-current');
    cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function findNext() {
    const text = $('#findInput').value;
    if (!text) return;
    let marks = editor.querySelectorAll('mark.find-hit');
    if (!marks.length) {
      const c = highlightAllMatches(text);
      $('#findCount').textContent = c + ' eşleşme';
      marks = editor.querySelectorAll('mark.find-hit');
      findIdx = -1;
    }
    if (!marks.length) {
      $('#findCount').textContent = '0 eşleşme';
      return;
    }
    focusNextMark();
  }

  function replaceText() {
    const findText = $('#findInput').value;
    const replaceWith = $('#replaceInput').value;
    if (!findText) return;
    const marks = editor.querySelectorAll('mark.find-hit');
    if (!marks.length) { findNext(); return; }
    const cur = marks[Math.max(0, findIdx)] || marks[0];
    
    let replacement = replaceWith;
    if ($('#findRegex')?.checked) {
      const re = getFindRegExp(findText, true);
      if (re) {
        replacement = cur.textContent.replace(re, replaceWith);
      }
    }
    
    const tn = document.createTextNode(replacement);
    cur.replaceWith(tn);
    editor.normalize();
    scheduleSave();
    
    // Re-highlight remaining and focus next
    const remaining = highlightAllMatches(findText);
    $('#findCount').textContent = remaining + ' eşleşme';
    findIdx = -1;
    if (remaining > 0) focusNextMark();
  }

  function replaceAll() {
    const findText = $('#findInput').value;
    const replaceWith = $('#replaceInput').value;
    if (!findText) return;
    clearFindMarks();
    
    let re;
    try {
      re = getFindRegExp(findText, true);
    } catch (e) {
      alert(e.message);
      return;
    }
    if (!re) return;
    
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    let count = 0;
    
    for (const n of nodes) {
      const hay = n.nodeValue;
      re.lastIndex = 0;
      if (!re.test(hay)) continue;
      
      const matches = hay.match(re);
      if (matches) {
        count += matches.length;
      }
      re.lastIndex = 0;
      n.nodeValue = hay.replace(re, replaceWith);
    }
    $('#findCount').textContent = count + ' değiştirildi';
    if (count > 0) scheduleSave();
  }

  // --- Event Listeners ---

  // Toolbar buttons
  $('#toolbar').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (toolbarActions[action]) toolbarActions[action]();
  });

  document.addEventListener('mouseup', (e) => {
    if (!formatPainterActive || !copiedFormat || !editor.contains(e.target)) return;
    setTimeout(() => {
      if (applyFormatToSelection(copiedFormat)) setFormatPainterActive(false);
    }, 0);
  });

  // Font selects
  $('#fontFamily').addEventListener('change', (e) => {
    execCmd('fontName', e.target.value);
  });
  $('#fontSize').addEventListener('change', (e) => {
    execCmd('fontSize', e.target.value);
  });
  $('#zoomSelect').addEventListener('change', (e) => {
    applyEditorZoom(parseFloat(e.target.value));
  });
  $('#pageSize').addEventListener('change', (e) => {
    const note = getActiveNote();
    if (!note) return;
    note.pageSize = e.target.value;
    applyPageLayout(note);
    scheduleSave();
  });

  // Editor input
  editor.addEventListener('input', () => {
    updateCounts();
    scheduleSave();
  });

  // Note title
  noteTitle.addEventListener('input', () => {
    scheduleSave();
  });

  // Search
  searchInput.addEventListener('input', () => {
    renderNoteList();
  });

  $('#btnCreate').addEventListener('click', createNote);

  // Sort Selection
  const sortSelect = $('#sortSelect');
  if (sortSelect) {
    sortSelect.value = currentSortOption;
    sortSelect.addEventListener('change', (e) => {
      currentSortOption = e.target.value;
      localStorage.setItem('np_sort_option', currentSortOption);
      renderNoteList();
    });
  }

  // Sidebar Tabs (Notes / Trash)
  const tabNotes = $('#tabNotes');
  const tabTrash = $('#tabTrash');
  if (tabNotes && tabTrash) {
    tabNotes.addEventListener('click', () => {
      currentSidebarTab = 'notes';
      tabNotes.classList.add('active');
      tabTrash.classList.remove('active');
      renderNoteList();
      // Load first visible note if active note is deleted
      const visible = notes.filter(n => !n.deleted);
      if (visible.length > 0) {
        const found = visible.find(n => n.id === activeId);
        if (!found) loadNote(visible[0].id);
      }
    });
    tabTrash.addEventListener('click', () => {
      currentSidebarTab = 'trash';
      tabTrash.classList.add('active');
      tabNotes.classList.remove('active');
      renderNoteList();
      // Load first trash note if active note is not deleted
      const deletedNotes = notes.filter(n => n.deleted && n.deleted !== 1);
      if (deletedNotes.length > 0) {
        const found = deletedNotes.find(n => n.id === activeId);
        if (!found) loadNote(deletedNotes[0].id);
      }
    });
  }

  // Trash actions
  const btnEmptyTrash = $('#btnEmptyTrash');
  if (btnEmptyTrash) {
    btnEmptyTrash.addEventListener('click', () => {
      const msg = (CURRENT_LANG === 'en')
        ? 'Are you sure you want to permanently delete all notes in the Trash?'
        : 'Çöp Kutusu\'ndaki tüm notları kalıcı olarak silmek istediğinize emin misiniz?';
      if (confirm(msg)) {
        emptyTrash();
      }
    });
  }

  // Trash Banner Buttons
  const btnRestoreNote = $('#btnRestoreNote');
  if (btnRestoreNote) {
    btnRestoreNote.addEventListener('click', () => {
      if (activeId) restoreNote(activeId);
    });
  }

  const btnPurgeNote = $('#btnPurgeNote');
  if (btnPurgeNote) {
    btnPurgeNote.addEventListener('click', () => {
      const msg = (CURRENT_LANG === 'en')
        ? 'Are you sure you want to permanently delete this note? This action cannot be undone.'
        : 'Bu notu kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz.';
      if (confirm(msg)) {
        if (activeId) purgeNotePermanently(activeId);
      }
    });
  }

  // Select-all
  $('#selectAllCheckbox').addEventListener('change', (e) => {
    const filtered = getFilteredNotes();
    if (e.target.checked) {
      filtered.forEach(n => selectedNoteIds.add(n.id));
    } else {
      filtered.forEach(n => selectedNoteIds.delete(n.id));
    }
    renderNoteList();
  });

  // Note context menu (right-click on note item)
  const ctxMenu = $('#noteContextMenu');
  let ctxTargetId = null;
  let ctxIsMulti = false;

  noteList.addEventListener('contextmenu', (e) => {
    if (currentSidebarTab === 'trash') return; // Disable context menu in Trash
    const item = e.target.closest('.note-item');
    if (!item) return;
    e.preventDefault();
    const id = item.dataset.id;
    // If right-clicked note is in selection AND selection has multiple → multi-action
    ctxIsMulti = selectedNoteIds.has(id) && selectedNoteIds.size > 1;
    ctxTargetId = id;
    // Hide rename when multi (doesn't make sense)
    ctxMenu.querySelector('[data-ctx="rename"]').hidden = ctxIsMulti;
    ctxMenu.hidden = false;
    const vw = window.innerWidth, vh = window.innerHeight;
    const mw = 200, mh = 230;
    ctxMenu.style.left = Math.min(e.clientX, vw - mw) + 'px';
    ctxMenu.style.top = Math.min(e.clientY, vh - mh) + 'px';
  });

  async function copyTextToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      ta.remove();
      return true;
    }
  }

  function getTargetNotes() {
    if (ctxIsMulti) {
      return notes.filter(n => selectedNoteIds.has(n.id));
    }
    const single = notes.find(n => n.id === ctxTargetId);
    return single ? [single] : [];
  }

  ctxMenu.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-ctx]');
    if (!btn) return;
    const action = btn.dataset.ctx;
    const targets = getTargetNotes();
    ctxMenu.hidden = true;
    if (!targets.length) return;

    if (action === 'rename' && !ctxIsMulti) {
      const note = targets[0];
      const name = prompt('Yeni ad:', note.title || 'Untitled Note');
      if (name === null) return;
      note.title = name.trim();
      if (activeId === note.id) noteTitle.value = note.title;
      saveNotes();
      renderNoteList();
    } else if (action === 'duplicate') {
      for (const note of targets) {
        const copy = {
          ...note,
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 4),
          title: (note.title || 'Untitled') + ' (kopya)',
          updated: Date.now()
        };
        notes.unshift(copy);
      }
      saveNotes();
      renderNoteList();
    } else if (action === 'copyText') {
      const text = targets.map(n => {
        const t = n.title || 'Untitled';
        const body = stripHtml(n.content);
        return `# ${t}\n\n${body}`;
      }).join('\n\n---\n\n');
      await copyTextToClipboard(text);
    } else if (action === 'color') {
      if (ctxIsMulti) {
        openColorPalette(null);
      } else {
        openColorPalette(targets[0].id);
      }
    } else if (action === 'group') {
      if (ctxIsMulti) {
        openGroupPicker(null);
      } else {
        openGroupPicker(targets[0].id);
      }
    } else if (action === 'delete') {
      targets.forEach(t => {
        t.deleted = Date.now();
        t.updated = t.deleted;
        t.version = (t.version || 0) + 1;
        if (window.__npCloud) window.__npCloud.markDirty(t.id);
      });
      const ids = new Set(targets.map(t => t.id));
      ids.forEach(id => selectedNoteIds.delete(id));
      
      const visible = notes.filter(n => !n.deleted);
      if (visible.length === 0) {
        createNote();
        return;
      }
      if (ids.has(activeId)) {
        activeId = visible[0].id;
        loadNote(activeId);
      }
      saveNotes();
      renderNoteList();
    }
    ctxTargetId = null;
    ctxIsMulti = false;
  });

  // Color palette
  const colorPalette = $('#colorPalette');
  let colorTargetId = null;
  function openColorPalette(noteId) {
    colorTargetId = noteId;
    const item = noteId ? noteList.querySelector(`.note-item[data-id="${noteId}"]`) : null;
    const r = item ? item.getBoundingClientRect() : { left: 200, top: 100, bottom: 130 };
    colorPalette.hidden = false;
    const vw = window.innerWidth;
    let left = r.left + 20;
    if (left + 220 > vw) left = vw - 230;
    colorPalette.style.left = Math.max(8, left) + 'px';
    colorPalette.style.top = (r.bottom + 4) + 'px';
  }
  function closeColorPalette() {
    colorPalette.hidden = true;
    colorTargetId = null;
  }
  colorPalette.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-color]');
    if (!btn) return;
    const color = btn.dataset.color || '';
    if (colorTargetId === null) {
      // Multi
      notes.forEach(n => { if (selectedNoteIds.has(n.id)) n.color = color; });
    } else {
      const note = notes.find(n => n.id === colorTargetId);
      if (!note) { closeColorPalette(); return; }
      note.color = color;
    }
    saveNotes();
    renderNoteList();
    closeColorPalette();
  });
  document.addEventListener('click', (e) => {
    if (!colorPalette.hidden && !e.target.closest('#colorPalette') && !e.target.closest('#noteContextMenu')) {
      closeColorPalette();
    }
  });

  // Group picker
  const groupPicker = $('#groupPicker');
  const groupPickerInput = $('#groupPickerInput');
  const groupPickerList = $('#groupPickerList');
  let groupTargetId = null;
  function openGroupPicker(noteId) {
    groupTargetId = noteId;
    const note = noteId ? notes.find(n => n.id === noteId) : null;
    groupPickerInput.value = (note && note.group) || '';
    renderGroupPickerList();
    const item = noteId ? noteList.querySelector(`.note-item[data-id="${noteId}"]`) : null;
    const r = item ? item.getBoundingClientRect() : { left: 200, top: 100, bottom: 130 };
    groupPicker.hidden = false;
    const vw = window.innerWidth;
    let left = r.left + 20;
    if (left + 250 > vw) left = vw - 260;
    groupPicker.style.left = Math.max(8, left) + 'px';
    groupPicker.style.top = (r.bottom + 4) + 'px';
    setTimeout(() => groupPickerInput.focus(), 50);
  }
  function closeGroupPicker() {
    groupPicker.hidden = true;
    groupTargetId = null;
  }
  function renderGroupPickerList() {
    const q = groupPickerInput.value.toLowerCase();
    const groups = getAllGroups().filter(g => !q || g.toLowerCase().includes(q));
    groupPickerList.innerHTML = groups.map(g => `<button data-grp="${escapeAttribute(g)}">${escapeHtml(g)}</button>`).join('') ||
      '<div style="font-size:11px;color:#888;padding:4px 9px">Henüz grup yok</div>';
  }
  function setNoteGroup(noteId, group) {
    if (noteId === null) {
      // Multi
      notes.forEach(n => { if (selectedNoteIds.has(n.id)) n.group = group || ''; });
    } else {
      const note = notes.find(n => n.id === noteId);
      if (!note) return;
      note.group = group || '';
    }
    saveNotes();
    renderNoteList();
  }
  groupPickerInput.addEventListener('input', renderGroupPickerList);
  groupPickerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setNoteGroup(groupTargetId, groupPickerInput.value.trim());
      closeGroupPicker();
    } else if (e.key === 'Escape') {
      closeGroupPicker();
    }
  });
  groupPickerList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-grp]');
    if (!btn) return;
    setNoteGroup(groupTargetId, btn.dataset.grp);
    closeGroupPicker();
  });
  $('#groupPickerSet').addEventListener('click', () => {
    setNoteGroup(groupTargetId, groupPickerInput.value.trim());
    closeGroupPicker();
  });
  $('#groupPickerClear').addEventListener('click', () => {
    setNoteGroup(groupTargetId, '');
    closeGroupPicker();
  });
  document.addEventListener('click', (e) => {
    if (!groupPicker.hidden && !e.target.closest('#groupPicker') && !e.target.closest('#noteContextMenu')) {
      closeGroupPicker();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeColorPalette();
      closeGroupPicker();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#noteContextMenu')) ctxMenu.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') ctxMenu.hidden = true;
  });
  window.addEventListener('blur', () => ctxMenu.hidden = true);

  // --- Editor context menu ---
  const editorCtx = $('#editorContextMenu');
  const translatePopup = $('#translatePopup');
  let savedRange = null;
  let lastEditorSelectionRange = null;
  let editorCtxPoint = null;
  let lastTranslateText = '';
  let lastTranslatedText = '';

  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (isEditorSelection(sel) && !sel.isCollapsed) {
      lastEditorSelectionRange = sel.getRangeAt(0).cloneRange();
    }
  });

  function saveSelection(x, y) {
    const sel = window.getSelection();
    if (isEditorSelection(sel)) {
      if (!sel.isCollapsed) {
        savedRange = sel.getRangeAt(0).cloneRange();
      } else if (lastEditorSelectionRange && x != null && y != null && rangeContainsPoint(lastEditorSelectionRange, x, y)) {
        savedRange = lastEditorSelectionRange.cloneRange();
      } else {
        savedRange = sel.getRangeAt(0).cloneRange();
      }
    } else if (lastEditorSelectionRange && rangeContainsPoint(lastEditorSelectionRange, x, y)) {
      savedRange = lastEditorSelectionRange.cloneRange();
    }
  }
  function restoreSelection() {
    editor.focus();
    if (savedRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
  }

  function getSavedSelectionText() {
    if (savedRange && !savedRange.collapsed) return savedRange.toString().trim();
    const sel = window.getSelection();
    if (isEditorSelection(sel) && !sel.isCollapsed) return sel.toString().trim();
    return '';
  }

  function positionTranslatePopup(x, y) {
    if (!translatePopup) return;
    const w = 320;
    const h = 160;
    translatePopup.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px';
    translatePopup.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';
  }

  function hideTranslatePopup() {
    if (!translatePopup) return;
    translatePopup.hidden = true;
    lastTranslateText = '';
    lastTranslatedText = '';
    const result = $('#translateResult');
    const langSelect = $('#translateLangSelect');
    const badge = $('#translateBadge');
    if (result) { result.textContent = ''; result.className = ''; }
    if (langSelect) langSelect.className = '';
    if (badge) badge.textContent = '';
  }

  function showTranslatePopup(text, x, y) {
    if (!translatePopup || !text) return;
    lastTranslateText = text;
    lastTranslatedText = '';
    $('#translatePreview').textContent = text.length > 46 ? text.slice(0, 46) + '...' : text;
    $('#translateBadge').textContent = '';
    const result = $('#translateResult');
    const langSelect = $('#translateLangSelect');
    if (result) { result.textContent = ''; result.className = ''; }
    if (langSelect) langSelect.className = '';
    positionTranslatePopup(x, y);
    translatePopup.hidden = false;
    translateSelectionText();
  }

  async function translateSelectionText(forceSl, forceTl) {
    const text = lastTranslateText;
    const result = $('#translateResult');
    const badge = $('#translateBadge');
    const langSelect = $('#translateLangSelect');
    if (!text || !result) return;
    result.textContent = tr('translating');
    result.className = 'show loading';
    if (badge) badge.textContent = '';
    if (langSelect) langSelect.className = '';
    try {
      const sl = forceSl || 'auto';
      const tl = forceTl || 'tr';
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
      const response = await fetch(url);
      const data = await response.json();
      const detected = data[2] || forceSl || null;
      if (!forceSl && detected === 'tr') {
        await translateSelectionText('tr', 'en');
        return;
      }
      if (!forceSl && (!detected || detected === 'und')) {
        result.textContent = '';
        result.className = '';
        if (langSelect) langSelect.className = 'show';
        return;
      }
      const translatedText = (data[0] || []).map(chunk => chunk[0]).join('');
      lastTranslatedText = translatedText;
      result.textContent = translatedText;
      result.className = 'show';
      if (badge) badge.textContent = `${(forceSl || detected || 'auto').toUpperCase()} → ${(forceTl || 'tr').toUpperCase()}`;
    } catch (err) {
      result.textContent = tr('translateFailed');
      result.className = 'show';
      if (langSelect) langSelect.className = 'show';
    }
  }

  document.addEventListener('contextmenu', (e) => {
    const inEditor = e.target === editor || (editor.contains && editor.contains(e.target));
    console.log('[editorCtx] contextmenu target=', e.target, 'inEditor=', inEditor);
    if (!inEditor) return;
    // If right-click landed on an image, select it so tools/handles appear
    const img = e.target.closest && e.target.closest('#editor img');
    if (img && typeof selectImage === 'function') {
      try { selectImage(img); } catch (err) { console.error('[editorCtx] selectImage failed', err); }
    }
    // Toggle image-only buttons
    editorCtx.querySelectorAll('.ectx-img-only').forEach(b => { b.hidden = !img; });
    // Toggle bg-only buttons (only when editor has background image)
    const hasBg = editor.classList.contains('has-bg');
    editorCtx.querySelectorAll('.ectx-bg-only').forEach(b => { b.hidden = !hasBg; });
    // Toggle table-only buttons (right-click inside table cell)
    const td = e.target.closest && e.target.closest('#editor table.editor-table td');
    __ctxTableCell = td || null;
    editorCtx.querySelectorAll('.ectx-table-only').forEach(b => { b.hidden = !td; });
    saveSelection(e.clientX, e.clientY);
    editorCtxPoint = { x: e.clientX, y: e.clientY };
    const selectedText = getSavedSelectionText();
    editorCtx.querySelectorAll('.ectx-text-only').forEach(b => { b.hidden = !selectedText; });
    e.preventDefault();
    e.stopPropagation();
    const vw = window.innerWidth, vh = window.innerHeight;
    const mw = 220, mh = 220;
    editorCtx.hidden = false;
    editorCtx.style.left = Math.min(e.clientX, vw - mw) + 'px';
    editorCtx.style.top = Math.min(e.clientY, vh - mh) + 'px';
  }, true);

  editorCtx.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-ectx]');
    if (!btn) return;
    const action = btn.dataset.ectx;
    editorCtx.hidden = true;
    // Trigger file picker BEFORE any await (user activation required)
    if (action === 'uploadImage') {
      const inp = $('#imageInput');
      if (inp) { inp.value = ''; inp.click(); }
      return;
    }
    restoreSelection();
    try {
      if (action === 'cut') {
        document.execCommand('cut');
      } else if (action === 'copy') {
        document.execCommand('copy');
      } else if (action === 'translateSelection') {
        const text = getSavedSelectionText();
        if (text) {
          const p = editorCtxPoint || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
          showTranslatePopup(text, p.x + 4, p.y + 4);
        }
      } else if (action === 'paste') {
        if (navigator.clipboard && navigator.clipboard.readText) {
          const txt = await navigator.clipboard.readText();
          insertHtmlAtCursor(textToNoteHtml(normalizeReviewRubricText(txt)));
          scheduleSave();
        } else {
          alert('Tarayıcı pano okumayı desteklemiyor. Ctrl+V kullanın.');
        }
      } else if (action === 'pasteImage') {
        if (!navigator.clipboard || !navigator.clipboard.read) {
          alert('Tarayıcı pano resim okumayı desteklemiyor. Ctrl+V kullanın.');
          return;
        }
        const items = await navigator.clipboard.read();
        let found = false;
        for (const item of items) {
          const type = item.types.find(t => t.startsWith('image/'));
          if (!type) continue;
          const blob = await item.getType(type);
          insertImageFromFile(blob)
            .then(() => scheduleSave())
            .catch(err => console.error('[image] pasteImage failed', err));
          found = true;
          break;
        }
        if (!found) alert('Panoda resim bulunamadı.');
      } else if (action === 'uploadImage') {
        const inp = $('#imageInput');
        if (inp) { inp.value = ''; inp.click(); }
      } else if (action === 'deleteImage') {
        if (selectedImg && selectedImg.parentNode) {
          const img = selectedImg;
          if (typeof deselectImage === 'function') deselectImage();
          img.remove();
          scheduleSave();
        }
      } else if (action === 'saveImage') {
        if (selectedImg && selectedImg.src) {
          await downloadImage(selectedImg);
        }
      } else if (action === 'imageZoomOut') {
        zoomSelectedImage(0.9);
      } else if (action === 'imageZoomIn') {
        zoomSelectedImage(1.1);
      } else if (action === 'grabText') {
        await runSelectedImageGrabText();
      } else if (action === 'bgToggleMode') {
        if (typeof window.__npToggleBgMode === 'function') window.__npToggleBgMode();
      } else if (action === 'bgClear') {
        if (typeof window.__npClearBg === 'function') window.__npClearBg();
      } else if (action.startsWith('table')) {
        handleTableAction(action);
      }
    } catch (err) {
      console.error('[editorCtx]', err);
      alert('İşlem başarısız: ' + err.message);
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#editorContextMenu')) editorCtx.hidden = true;
    if (translatePopup && !e.target.closest('#translatePopup') && !e.target.closest('#editorContextMenu')) {
      hideTranslatePopup();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      editorCtx.hidden = true;
      hideTranslatePopup();
    }
  });
  window.addEventListener('blur', () => editorCtx.hidden = true);

  $('#translateClose')?.addEventListener('click', hideTranslatePopup);
  $('#translateCopy')?.addEventListener('click', async () => {
    const text = lastTranslatedText || lastTranslateText;
    if (!text) return;
    await copyTextToClipboard(text);
  });
  $('#translateLangSelect')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-translate-pair]');
    if (!btn) return;
    const [sl, tl] = btn.dataset.translatePair.split('-');
    translateSelectionText(sl, tl);
  });

  // Delete note
  $('#btnDelete').addEventListener('click', () => {
    deleteNote(activeId);
  });

  // Find & Replace
  $('#closeFindReplace').addEventListener('click', toggleFindReplace);
  $('#btnFindAll').addEventListener('click', findAll);
  $('#btnFindNext').addEventListener('click', findNext);
  $('#btnReplace').addEventListener('click', replaceText);
  $('#btnReplaceAll').addEventListener('click', replaceAll);

  // --- Multi-format Importer ---
  // Local-first paths; SW also caches CDN as fallback for offline
  const CDN = {
    mammoth: './vendor/mammoth.browser.min.js',
    xlsx: './vendor/xlsx.full.min.js',
    pdfjs: './vendor/pdf.min.mjs',
    pdfWorker: './vendor/pdf.worker.min.mjs',
    // OCR libs stay on CDN (heavy + model files); SW caches opaque
    tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
    paddleOcr: 'https://cdn.jsdelivr.net/npm/@paddlejs-models/ocr@1.1.3/lib/index.js'
  };

  // OCR engine: 'paddle' (fast, WASM, Latin+CJK) | 'tesseract' (slower, better Turkish)
  let ocrEngine = localStorage.getItem('ocr_engine') || 'paddle';
  let paddleOcrReady = null;

  async function runOcr(imageSrc, progressCb) {
    if (ocrEngine === 'paddle') {
      try {
        return await runPaddleOcr(imageSrc, progressCb);
      } catch (err) {
        console.warn('PaddleOCR failed, falling back to tesseract:', err);
        return await runTesseract(imageSrc, progressCb);
      }
    }
    return await runTesseract(imageSrc, progressCb);
  }

  async function runPaddleOcr(imageSrc, progressCb) {
    if (!paddleOcrReady) {
      progressCb && progressCb(0, 'PaddleOCR yükleniyor (ilk seferlik ~8MB)...');
      paddleOcrReady = (async () => {
        const mod = await import(/* webpackIgnore: true */ CDN.paddleOcr);
        await mod.default.init();
        return mod.default;
      })();
    }
    const ocr = await paddleOcrReady;
    progressCb && progressCb(50, 'PaddleOCR tanıma çalışıyor...');
    const img = typeof imageSrc === 'string' ? await loadImg(imageSrc) : imageSrc;
    const result = await ocr.recognize(img);
    progressCb && progressCb(100, 'Tamamlandı');
    const text = Array.isArray(result.text) ? result.text.join('\n') : (result.text || '');
    return { text };
  }

  async function runTesseract(imageSrc, progressCb) {
    await loadScript(CDN.tesseract);
    const { data } = await window.Tesseract.recognize(imageSrc, 'tur+eng', {
      logger: m => {
        if (m.status === 'recognizing text' && progressCb) {
          progressCb(Math.round(m.progress * 100), `Tesseract: ${Math.round(m.progress * 100)}%`);
        }
      }
    });
    return { text: data.text };
  }

  async function runGrabText(imageSrc, progressCb) {
    progressCb && progressCb(0, 'Grab Text başlatılıyor...');
    const { text } = await runTesseract(imageSrc, progressCb);
    return { text: (text || '').replace(/\n{3,}/g, '\n\n').trim() };
  }

  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  const loadedScripts = new Set();
  function loadScript(url, isModule = false) {
    if (loadedScripts.has(url)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      if (isModule) s.type = 'module';
      s.onload = () => { loadedScripts.add(url); resolve(); };
      s.onerror = () => reject(new Error('Script yüklenemedi: ' + url));
      document.head.appendChild(s);
    });
  }

  function showImport(text, pct = 0) {
    const ov = $('#importOverlay');
    ov.hidden = false;
    $('#importText').textContent = text;
    $('#importBar').style.width = Math.max(0, Math.min(100, pct)) + '%';
  }

  function hideImport() {
    $('#importOverlay').hidden = true;
  }

  function readAs(file, how) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r[how](file);
    });
  }

  function sanitizeHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form,svg,math').forEach(el => el.remove());
    doc.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(a => {
        const name = a.name.toLowerCase();
        const value = a.value.trim();
        if (name.startsWith('on') || ['srcdoc', 'action', 'formaction', 'xlink:href'].includes(name)) {
          el.removeAttribute(a.name);
          return;
        }
        if (name === 'href') {
          const safeHref = /^(?:https?:|mailto:|tel:|#|data:application\/pdf;base64,)/i.test(value);
          if (!safeHref) el.removeAttribute(a.name);
          return;
        }
        if (name === 'src') {
          if (!isSafeEditorImageUrl(value)) el.removeAttribute(a.name);
          return;
        }
        if (name === 'data-link-href') {
          if (!isSafeLinkUrl(value)) el.removeAttribute(a.name);
          return;
        }
        if (name === 'style' && /(?:expression\s*\(|javascript\s*:|vbscript\s*:|@import|-moz-binding|behavior\s*:)/i.test(value)) {
          el.removeAttribute(a.name);
        }
      });
      if (el.getAttribute('target') === '_blank') {
        el.setAttribute('rel', 'noopener noreferrer');
      }
    });
    return doc.body.innerHTML;
  }

  async function importTxt(file) {
    const text = await readAs(file, 'readAsText');
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  async function importHtml(file) {
    const text = await readAs(file, 'readAsText');
    return sanitizeHtml(text);
  }

  async function importDocx(file) {
    showImport('Word dosyası yükleniyor...');
    await loadScript(CDN.mammoth);
    const buf = await readAs(file, 'readAsArrayBuffer');
    showImport('Word ayrıştırılıyor...', 50);
    const res = await window.mammoth.convertToHtml({ arrayBuffer: buf });
    return sanitizeHtml(res.value);
  }

  async function importXlsx(file) {
    showImport('Excel dosyası yükleniyor...');
    await loadScript(CDN.xlsx);
    const buf = await readAs(file, 'readAsArrayBuffer');
    showImport('Excel ayrıştırılıyor...', 50);
    const wb = window.XLSX.read(buf, { type: 'array' });
    const parts = [];
    wb.SheetNames.forEach(name => {
      parts.push(`<h3>${escapeHtml(name)}</h3>`);
      parts.push(window.XLSX.utils.sheet_to_html(wb.Sheets[name], { editable: false }));
    });
    return sanitizeHtml(parts.join('\n'));
  }

  async function importPdf(file) {
    showImport('PDF yükleniyor...');
    // pdf.js v4 is ESM; use dynamic import
    const pdfjs = await import(/* webpackIgnore: true */ CDN.pdfjs);
    pdfjs.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
    const buf = await readAs(file, 'readAsArrayBuffer');
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    const total = pdf.numPages;
    const pages = [];
    let needsOcr = false;
    for (let i = 1; i <= total; i++) {
      showImport(`PDF sayfa ${i}/${total} okunuyor...`, (i / total) * 50);
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map(it => it.str).join(' ').trim();
      if (text) {
        pages.push(`<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`);
      } else {
        needsOcr = true;
        pages.push({ ocrPageNum: i, page });
      }
    }
    // OCR empty pages
    if (needsOcr) {
      for (let i = 0; i < pages.length; i++) {
        if (typeof pages[i] !== 'object' || !pages[i].page) continue;
        const { page, ocrPageNum } = pages[i];
        const baseMsg = `OCR sayfa ${ocrPageNum}/${total}`;
        const basePct = 50 + (ocrPageNum / total) * 50;
        showImport(baseMsg, basePct);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const { text } = await runOcr(canvas, (p, msg) => showImport(`${baseMsg}: ${msg}`, basePct));
        pages[i] = `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;
      }
    }
    return pages.join('\n');
  }

  async function importImage(file) {
    showImport('Resim OCR başlatılıyor...');
    const dataUrl = await readAs(file, 'readAsDataURL');
    const { text } = await runOcr(dataUrl, (p, msg) => showImport(msg, p));
    const imgHtml = `<img src="${dataUrl}" class="pasted-image" alt="">`;
    const textHtml = text.trim()
      ? `<p><strong>OCR Metni:</strong></p><p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`
      : '<p><em>Metin bulunamadı.</em></p>';
    return imgHtml + textHtml;
  }

  async function importFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    try {
      let html;
      if (['txt', 'md'].includes(ext)) html = await importTxt(file);
      else if (ext === 'html') html = await importHtml(file);
      else if (ext === 'docx') html = await importDocx(file);
      else if (['xlsx', 'xls', 'csv'].includes(ext)) html = await importXlsx(file);
      else if (ext === 'pdf') html = await importPdf(file);
      else if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) html = await importImage(file);
      else {
        alert('Desteklenmeyen format: ' + ext);
        return;
      }
      createNote();
      const note = getActiveNote();
      note.title = file.name.replace(/\.[^.]+$/, '');
      noteTitle.value = note.title;
      editor.innerHTML = html;
      note.content = editor.innerHTML;
      saveNotes();
      renderNoteList();
      updateCounts();
    } catch (err) {
      console.error(err);
      alert('İçe aktarma hatası: ' + (err.message || err));
    } finally {
      hideImport();
    }
  }

  // Save default accept once so we can always restore it after picker use
  fileInput.dataset.defaultAccept = fileInput.getAttribute('accept') || '';
  function restoreFileInputAccept() {
    const def = fileInput.dataset.defaultAccept || '';
    if (def) fileInput.setAttribute('accept', def);
  }
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    fileInput.value = '';
    if (file) await importFile(file);
    restoreFileInputAccept();
  });
  // Some browsers fire 'cancel' when user dismisses the picker without selecting
  fileInput.addEventListener('cancel', restoreFileInputAccept);
  // Fallback: restore on window focus return (mobile browsers without 'cancel' event)
  window.addEventListener('focus', () => {
    setTimeout(restoreFileInputAccept, 300);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 's':
          e.preventDefault();
          toggleSaveDropdown();
          break;
        case 'h':
          if (!e.shiftKey) {
            e.preventDefault();
            toggleFindReplace();
          }
          break;
        case 'z':
          // Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z = redo (Mac convention)
          e.preventDefault();
          if (e.shiftKey) execCmd('redo'); else execCmd('undo');
          break;
        case 'y':
          // Ctrl/Cmd+Y = redo (Windows convention)
          e.preventDefault();
          execCmd('redo');
          break;
      }
    }
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      createNote();
    }
    // Escape closes find dialog
    if (e.key === 'Escape') {
      const dlg = $('#findReplaceDialog');
      if (dlg.style.display !== 'none') toggleFindReplace();
    }
  });

  // Enter in find dialog triggers Find Next
  ['#findInput', '#replaceInput'].forEach(sel => {
    $(sel).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        findNext();
      }
    });
  });

  // Live re-highlight when find term changes
  $('#findInput').addEventListener('input', () => {
    const v = $('#findInput').value;
    if (!v) { clearFindMarks(); $('#findCount').textContent = ''; return; }
    const c = highlightAllMatches(v);
    $('#findCount').textContent = c + ' eşleşme';
    findIdx = -1;
  });

  // Sidebar toggle (mobile) — body class drives backdrop overlay
  const sidebarEl = $('#sidebar');
  function setSidebarOpen(open) {
    sidebarEl.classList.toggle('open', open);
    document.body.classList.toggle('sidebar-open', open);
  }
  $('#sidebarToggle').addEventListener('click', (e) => {
    e.stopPropagation();
    setSidebarOpen(!sidebarEl.classList.contains('open'));
  });

  // Close sidebar when note clicked on mobile
  noteList.addEventListener('click', () => {
    if (window.innerWidth <= 768) setSidebarOpen(false);
  });

  // Tap backdrop or outside to close
  document.addEventListener('click', (e) => {
    if (window.innerWidth > 768) return;
    if (!sidebarEl.classList.contains('open')) return;
    if (e.target.closest('#sidebar') || e.target.closest('#sidebarToggle')) return;
    setSidebarOpen(false);
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebarEl.classList.contains('open')) {
      setSidebarOpen(false);
    }
  });

  // Email JSON backup — Web Share API with file attachment, fallback to download + mailto
  $('#btnEmailJson').addEventListener('click', async () => {
    const backup = { version: 1, exported: new Date().toISOString(), notes };
    const json = JSON.stringify(backup, null, 2);
    const fileName = `notepad-backup-${new Date().toISOString().slice(0,10)}.json`;
    const blob = new Blob([json], { type: 'application/json' });
    const file = new File([blob], fileName, { type: 'application/json' });

    const to = prompt('Alıcı e-posta (boş bırakabilirsiniz):', '') || '';
    const subject = `Notepad Yedeği — ${new Date().toLocaleDateString()}`;
    const body = `${notes.length} not içeren JSON yedeği ekte.\n\nDışa aktarılma: ${new Date().toLocaleString()}`;

    // Try Web Share API Level 2 (supports file attachment on mobile + some desktop)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: subject, text: body });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.warn('[emailJson] share failed, falling back', err);
      }
    }

    // Fallback: download file + open mailto with instructions
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);

    const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + '\n\n(JSON dosyası indirildi — lütfen ek olarak manuel iliştirin: ' + fileName + ')')}`;
    window.location.href = mailto;
  });

  // Export all notes as JSON backup
  $('#btnExportAll').addEventListener('click', () => {
    const backup = { version: 1, exported: new Date().toISOString(), notes };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `notepad-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // Import JSON backup
  $('#btnImportAll').addEventListener('click', () => $('#backupInput').click());
  $('#backupInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!Array.isArray(data.notes)) throw new Error('Invalid backup');
        if (!confirm(`Import ${data.notes.length} notes? This merges with existing notes.`)) return;
        const existingIds = new Set(notes.map(n => n.id));
        for (const n of data.notes) {
          const normalized = normalizeNote(n);
          if (!existingIds.has(normalized.id)) {
            notes.push(normalized);
            existingIds.add(normalized.id);
          }
        }
        notes.sort((a, b) => (b.updated || 0) - (a.updated || 0));
        saveNotes();
        renderNoteList();
      } catch (err) {
        alert('Invalid backup file: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // --- SQL Export/Import ---
  function sqlEscape(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    return "'" + String(v).replace(/'/g, "''") + "'";
  }

  function buildSqlDump(list) {
    const lines = [
      '-- Notepad SQL Dump',
      '-- Exported: ' + new Date().toISOString(),
      'DROP TABLE IF EXISTS notes;',
      'CREATE TABLE notes (',
      '  id TEXT PRIMARY KEY,',
      '  title TEXT,',
      '  content TEXT,',
      '  page_size TEXT,',
      '  page_orientation TEXT,',
      '  updated INTEGER',
      ');',
      ''
    ];
    for (const n of list) {
      lines.push(
        'INSERT INTO notes (id, title, content, page_size, page_orientation, updated) VALUES (' +
        [sqlEscape(n.id), sqlEscape(n.title || ''), sqlEscape(n.content || ''),
         sqlEscape(n.pageSize || 'free'), sqlEscape(n.pageOrientation || 'portrait'),
         Number(n.updated || Date.now())].join(', ') + ');'
      );
    }
    return lines.join('\n');
  }

  function parseSqlDump(sql) {
    const rows = [];
    const re = /INSERT\s+INTO\s+notes\s*\([^)]*\)\s*VALUES\s*\(([\s\S]*?)\)\s*;/gi;
    let m;
    while ((m = re.exec(sql)) !== null) {
      const vals = splitSqlValues(m[1]);
      if (vals.length < 6) continue;
      rows.push({
        id: unquote(vals[0]),
        title: unquote(vals[1]),
        content: unquote(vals[2]),
        pageSize: unquote(vals[3]) || 'free',
        pageOrientation: unquote(vals[4]) || 'portrait',
        updated: parseInt(vals[5], 10) || Date.now()
      });
    }
    return rows;
  }

  function splitSqlValues(s) {
    const out = [];
    let buf = '', inStr = false, i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (inStr) {
        if (ch === "'" && s[i+1] === "'") { buf += "''"; i += 2; continue; }
        if (ch === "'") { inStr = false; buf += ch; i++; continue; }
        buf += ch; i++;
      } else {
        if (ch === "'") { inStr = true; buf += ch; i++; continue; }
        if (ch === ',') { out.push(buf.trim()); buf = ''; i++; continue; }
        buf += ch; i++;
      }
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
  }

  function unquote(s) {
    s = s.trim();
    if (s === 'NULL') return '';
    if (s.startsWith("'") && s.endsWith("'")) {
      return s.slice(1, -1).replace(/''/g, "'");
    }
    return s;
  }

  $('#btnExportSql').addEventListener('click', () => {
    const sql = buildSqlDump(notes);
    const blob = new Blob([sql], { type: 'application/sql' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `notepad-${new Date().toISOString().slice(0,10)}.sql`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('#btnImportSql').addEventListener('click', () => $('#sqlInput').click());
  $('#sqlInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = parseSqlDump(ev.target.result);
        if (!rows.length) throw new Error('No INSERT rows found');
        if (!confirm(`Import ${rows.length} notes from SQL?`)) return;
        const existingIds = new Set(notes.map(n => n.id));
        let added = 0;
        for (const n of rows) {
          const normalized = normalizeNote(n);
          if (!existingIds.has(normalized.id)) {
            notes.push(normalized);
            existingIds.add(normalized.id);
            added++;
          }
        }
        notes.sort((a, b) => (b.updated || 0) - (a.updated || 0));
        saveNotes();
        renderNoteList();
        alert(`${added} not içe aktarıldı.`);
      } catch (err) {
        alert('SQL içe aktarma başarısız: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // Make find replace dialog draggable
  function makeDraggable(dialog, handle) {
    let offsetX = 0, offsetY = 0, mouseX = 0, mouseY = 0;
    handle.style.cursor = 'move';
    handle.addEventListener('mousedown', dragMouseDown);
    
    function dragMouseDown(e) {
      if (e.target.closest('button') || e.target.closest('input')) return;
      e.preventDefault();
      mouseX = e.clientX;
      mouseY = e.clientY;
      document.addEventListener('mouseup', closeDragElement);
      document.addEventListener('mousemove', elementDrag);
    }
    
    function elementDrag(e) {
      e.preventDefault();
      offsetX = mouseX - e.clientX;
      offsetY = mouseY - e.clientY;
      mouseX = e.clientX;
      mouseY = e.clientY;
      const newTop = dialog.offsetTop - offsetY;
      const newLeft = dialog.offsetLeft - offsetX;
      dialog.style.top = Math.max(0, Math.min(window.innerHeight - dialog.offsetHeight, newTop)) + "px";
      dialog.style.left = Math.max(0, Math.min(window.innerWidth - dialog.offsetWidth, newLeft)) + "px";
    }
    
    function closeDragElement() {
      document.removeEventListener('mouseup', closeDragElement);
      document.removeEventListener('mousemove', elementDrag);
    }
  }

  const findReplaceDialogEl = $('#findReplaceDialog .dialog');
  const findReplaceHeaderEl = $('#findReplaceDialog .dialog-header');
  if (findReplaceDialogEl && findReplaceHeaderEl) {
    makeDraggable(findReplaceDialogEl, findReplaceHeaderEl);
  }

  // Live re-highlight when find options change
  ['#findMatchCase', '#findWholeWord', '#findRegex'].forEach(sel => {
    $(sel).addEventListener('change', () => {
      const v = $('#findInput').value;
      if (!v) { clearFindMarks(); $('#findCount').textContent = ''; return; }
      const c = highlightAllMatches(v);
      $('#findCount').textContent = c + ' eşleşme';
      findIdx = -1;
    });
  });

  // --- Init ---
  // --- Image Editor state (must be declared before loadNotes → loadNote → deselectImage) ---
  let selectedImg = null;
  let cropMode = false;
  let cropDraft = null;
  let lockAspect = true;
  const imagePanel = $('#imagePanel');
  const selOverlay = document.createElement('div');
  selOverlay.className = 'img-sel-overlay';
  selOverlay.hidden = true;
  const HANDLES = ['nw','n','ne','e','se','s','sw','w'];
  selOverlay.innerHTML =
    '<div class="img-crop-mask mask-t"></div>' +
    '<div class="img-crop-mask mask-r"></div>' +
    '<div class="img-crop-mask mask-b"></div>' +
    '<div class="img-crop-mask mask-l"></div>' +
    HANDLES.map(p => `<div class="img-handle h-${p}" data-handle="${p}"></div>`).join('');
  document.body.appendChild(selOverlay);

  // i18n stubs (real table assigned later in init); avoids TDZ during loadNotes()
  var I18N_TABLE = null;
  var CURRENT_LANG = 'tr';
  function tr(key) {
    if (!I18N_TABLE) return key;
    const t = I18N_TABLE[CURRENT_LANG] || I18N_TABLE.tr || {};
    return t[key] != null ? t[key] : key;
  }

  applyEditorZoom(editorZoom);
  applyFormatMarksState();
  loadNotes();

  // Expose globals needed by cloud-sync module
  Object.defineProperty(window, '__npNotes', {
    get() { return notes; },
    set(v) { notes = v; },
    configurable: true
  });
  window.__npSaveNotes = saveNotes;
  window.__npRenderNoteList = renderNoteList;
  window.__npGetActiveId = () => activeId;
  window.__npLoadNote = loadNote;
  window.__npNormalizeNote = normalizeNote;

  let lastInputTime = 0;
  function recordUserActivity() {
    lastInputTime = Date.now();
  }
  editor.addEventListener('input', recordUserActivity);
  editor.addEventListener('keydown', recordUserActivity);
  editor.addEventListener('mousedown', recordUserActivity);
  if (noteTitle) {
    noteTitle.addEventListener('input', recordUserActivity);
    noteTitle.addEventListener('keydown', recordUserActivity);
    noteTitle.addEventListener('mousedown', recordUserActivity);
  }
  window.__npGetLastInputTime = () => lastInputTime;

  // Initialize cloud sync (no-op if client ID not configured)
  if (window.__npCloud && typeof window.__npCloud.init === 'function') {
    window.__npCloud.init().catch(e => console.warn('[cloud] init', e));
    initCloudUI();
  }

  function initCloudUI() {
    const btnSignIn = $('#btnGoogleSignIn');
    const btnSignOut = $('#btnSignOut');
    const userBox = $('#cloudUser');
    const avatar = $('#cloudAvatar');
    const emailEl = $('#cloudEmail');
    const statusEl = $('#cloudSyncStatus');
    if (!btnSignIn || !statusEl) return;

    const ICONS = { idle: '⚪', syncing: '🔄', ok: '✅', error: '⚠️', setupNeeded: '⚙️' };

    function render(state) {
      const icon = ICONS[state.status] || '⚪';
      statusEl.textContent = icon;

      const msgEl = $('#cloudSyncMsg');
      if (msgEl) {
        if (state.status === 'syncing') {
          msgEl.textContent = (CURRENT_LANG === 'en') ? 'Syncing notes, please wait...' : 'Not senkronizasyonu yapılıyor, lütfen bekleyin...';
          msgEl.style.display = 'inline-block';
        } else if (state.status === 'error') {
          msgEl.textContent = state.message || ((CURRENT_LANG === 'en') ? 'Sync error' : 'Senkronizasyon hatası');
          msgEl.style.display = 'inline-block';
        } else {
          msgEl.textContent = '';
          msgEl.style.display = 'none';
        }
      }

      const lastSync = state.lastSync ? new Date(state.lastSync).toLocaleString() : '-';
      // The header text line was removed to save space — fold its meaning into
      // the status tick's tooltip (hover the ✅/⚪ to see it).
      const stateLine = state.signedIn
        ? ((CURRENT_LANG === 'en') ? 'Cloud sync active — backed up' : 'Bulut eşitleme aktif — yedekleniyor')
        : tr('privacy');
      const syncLabel = tr(state.status === 'ok' ? 'syncOk' : state.status === 'syncing' ? 'syncing' : state.status === 'error' ? 'syncError' : state.status === 'setupNeeded' ? 'cloudSetupNeeded' : 'syncIdle');
      statusEl.title = `${stateLine}\n${syncLabel}\n${tr('lastSync')}${lastSync}${state.message ? '\n' + state.message : ''}`;
      if (state.signedIn) {
        btnSignIn.hidden = true;
        userBox.hidden = false;
        if (avatar) {
          avatar.src = (state.user && state.user.picture) ? state.user.picture : 'icon.svg';
        }
        if (emailEl) {
          emailEl.textContent = (state.user && (state.user.email || state.user.name)) ? (state.user.email || state.user.name) : 'Google Drive';
        }
      } else {
        btnSignIn.hidden = false;
        userBox.hidden = true;
      }
      // Keep the button clickable even when setup is pending — clicking shows
      // a clear explanation instead of being a silent dead button.
      btnSignIn.disabled = false;
      btnSignIn.title = state.status === 'setupNeeded' ? tr('cloudSetupNeeded') : '';
      btnSignIn.classList.toggle('needs-setup', state.status === 'setupNeeded');
    }

    btnSignIn.addEventListener('click', () => {
      if (window.__npCloud.getStatus().status === 'setupNeeded') {
        alert(tr('cloudSetupHelp'));
        return;
      }
      window.__npCloud.signIn().catch(e => console.warn('[cloud] signIn', e));
    });
    if (btnSignOut) {
      btnSignOut.addEventListener('click', () => {
        if (confirm(tr('cloudConfirmSignOut'))) {
          window.__npCloud.signOut();
        }
      });
    }
    const btnSwitch = $('#btnSwitchAccount');
    if (btnSwitch) {
      btnSwitch.addEventListener('click', () => {
        if (confirm(tr('cloudConfirmSwitch'))) {
          window.__npCloud.signIn({ switchAccount: true }).catch(e => console.warn('[cloud] switch', e));
        }
      });
    }
    if (statusEl) {
      statusEl.addEventListener('click', () => {
        const state = window.__npCloud.getStatus();
        if (state.signedIn) {
          window.__npCloud.syncNow(true).catch(e => console.warn('[cloud] manual sync', e));
        } else if (state.status !== 'setupNeeded') {
          window.__npCloud.signIn().catch(e => console.warn('[cloud] signIn', e));
        }
      });
    }
    window.__npCloud.onChange(render);
    render(window.__npCloud.getStatus());
    // Let language changes (and the post-init i18n pass) refresh the status
    // tooltip, which is now the only place the sync/privacy text lives.
    window.__npRefreshCloudUI = () => render(window.__npCloud.getStatus());
  }

  // ===== Briefcase (cross-device file transfer via Google Drive) =====
  function initBriefcaseUI() {
    const btnOpen = $('#btnBriefcase');
    const dialog = $('#briefcaseDialog');
    if (!btnOpen || !dialog || !window.__npBriefcase) return;

    const signinBox = $('#briefcaseSignin');
    const signInBtn = $('#briefcaseSignInBtn');
    const contentBox = $('#briefcaseContent');
    const dropzone = $('#briefcaseDropzone');
    const chooseBtn = $('#briefcaseChooseBtn');
    const fileInput = $('#briefcaseFileInput');
    const statusEl = $('#briefcaseStatus');
    const listEl = $('#briefcaseList');
    const emptyEl = $('#briefcaseEmpty');

    function formatSize(bytes) {
      bytes = parseInt(bytes, 10) || 0;
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function setStatus(msg) {
      if (!msg) { statusEl.hidden = true; statusEl.textContent = ''; return; }
      statusEl.hidden = false;
      statusEl.textContent = msg;
    }

    function renderList(files) {
      listEl.innerHTML = '';
      if (!files.length) {
        listEl.hidden = true;
        emptyEl.hidden = false;
        return;
      }
      emptyEl.hidden = true;
      listEl.hidden = false;
      for (const f of files) {
        const li = document.createElement('li');
        li.className = 'briefcase-item';
        const info = document.createElement('div');
        info.className = 'briefcase-item-info';
        const name = document.createElement('span');
        name.className = 'briefcase-item-name';
        name.textContent = f.name;
        name.title = f.name;
        const meta = document.createElement('span');
        meta.className = 'briefcase-item-meta';
        let metaText = `${formatSize(f.size)} · ${new Date(f.modifiedTime).toLocaleString()}`;
        if (f.chunked) metaText += ` · ${f.totalParts} ${tr('briefcaseParts')}`;
        if (f.incomplete) metaText += ` · ⚠ ${tr('briefcaseIncomplete')}`;
        meta.textContent = metaText;
        info.appendChild(name);
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'briefcase-item-actions';
        const dlBtn = document.createElement('button');
        dlBtn.title = tr('shareDevice');
        dlBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/><path d="M5 21h14"/></svg>';
        dlBtn.disabled = !!f.incomplete;
        dlBtn.addEventListener('click', () => downloadFile(f, li));
        const delBtn = document.createElement('button');
        delBtn.className = 'briefcase-delete-btn';
        delBtn.title = tr('delete');
        delBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
        delBtn.addEventListener('click', () => deleteFile(f, li));
        actions.appendChild(dlBtn);
        actions.appendChild(delBtn);

        li.appendChild(info);
        li.appendChild(actions);
        listEl.appendChild(li);
      }
    }

    async function refreshList() {
      try {
        const files = await window.__npBriefcase.list();
        renderList(files);
      } catch (e) {
        console.warn('[briefcase] list', e);
        setStatus(tr('briefcaseListFailed'));
      }
    }

    function progressLabel(prefix, name, cur, total) {
      return total > 1 ? `${prefix}${name} — ${cur}/${total}` : `${prefix}${name}`;
    }

    function setItemBusy(li, busy) {
      if (!li) return;
      li.classList.toggle('downloading', busy);
      li.querySelectorAll('.briefcase-item-actions button').forEach((b) => { b.disabled = busy; });
    }

    async function downloadFile(f, li) {
      if (f.incomplete) return;
      const onProgress = (cur, total) =>
        setStatus(progressLabel(tr('briefcaseDownloading'), f.name, cur, total));

      // Preferred path: stream parts straight to disk. The save dialog must be
      // opened synchronously inside this click gesture, before any await.
      let writable = null;
      if (typeof window.showSaveFilePicker === 'function') {
        try {
          const handle = await window.showSaveFilePicker({ suggestedName: f.name });
          writable = await handle.createWritable();
        } catch (e) {
          if (e && e.name === 'AbortError') return; // user cancelled the save dialog
          writable = null; // API present but failed → fall back to in-memory save
        }
      }

      setItemBusy(li, true);
      onProgress(0, f.chunked ? f.totalParts : 1);
      try {
        if (writable) {
          await window.__npBriefcase.downloadTo(f, writable, onProgress);
        } else {
          const blob = await window.__npBriefcase.download(f, onProgress);
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = f.name;
          a.click();
          URL.revokeObjectURL(a.href);
        }
      } catch (e) {
        console.warn('[briefcase] download', e);
        alert(tr('briefcaseDownloadFailed'));
      } finally {
        setStatus('');
        setItemBusy(li, false);
      }
    }

    async function deleteFile(f, li) {
      if (!confirm(tr('briefcaseDeleteConfirm'))) return;
      try {
        await window.__npBriefcase.remove(f);
        li.remove();
        if (!listEl.children.length) { listEl.hidden = true; emptyEl.hidden = false; }
      } catch (e) {
        console.warn('[briefcase] delete', e);
        alert(tr('briefcaseDeleteFailed'));
      }
    }

    async function uploadFiles(files) {
      for (const file of files) {
        setStatus(tr('briefcaseUploading') + file.name);
        try {
          await window.__npBriefcase.upload(file, (cur, total) => {
            setStatus(progressLabel(tr('briefcaseUploading'), file.name, cur, total));
          });
        } catch (e) {
          console.warn('[briefcase] upload', e);
          alert(tr('briefcaseUploadFailed') + file.name);
        }
      }
      setStatus('');
      refreshList();
    }

    function renderAuthState() {
      const signedIn = window.__npCloud && window.__npCloud.isSignedIn();
      signinBox.hidden = !!signedIn;
      contentBox.hidden = !signedIn;
      if (signedIn) refreshList();
    }

    function openDialog() {
      dialog.hidden = false;
      dialog.style.display = '';
      renderAuthState();
    }
    function closeDialog() {
      dialog.hidden = true;
      dialog.style.display = 'none';
    }

    btnOpen.addEventListener('click', openDialog);
    $('#briefcaseDialogClose').addEventListener('click', closeDialog);
    dialog.addEventListener('click', (e) => { if (e.target === dialog) closeDialog(); });
    if (signInBtn) {
      signInBtn.addEventListener('click', () => {
        window.__npCloud.signIn().catch(e => console.warn('[cloud] signIn', e));
      });
    }
    if (window.__npCloud) {
      window.__npCloud.onChange(() => { if (!dialog.hidden) renderAuthState(); });
    }

    chooseBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) uploadFiles(Array.from(fileInput.files));
      fileInput.value = '';
    });
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length) uploadFiles(Array.from(e.dataTransfer.files));
    });
  }
  initBriefcaseUI();

  function defaultImgState() {
    return {
      filters: { brightness: 1, contrast: 1, saturate: 1, 'hue-rotate': 0, blur: 0, grayscale: 0, sepia: 0, invert: 0 },
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
      xform: { rotate: 0, flipH: false, flipV: false },
      layout: { wrap: 'inline', align: '' }
    };
  }

  function applyLayout(img, layout) {
    if (!layout) return;
    // Reset layout-affecting styles
    img.style.float = '';
    img.style.shapeOutside = '';
    img.style.position = '';
    img.style.zIndex = '';
    img.style.display = '';
    img.style.clear = '';
    img.style.marginLeft = '';
    img.style.marginRight = '';
    img.classList.remove('wrap-inline','wrap-square','wrap-tight','wrap-topbottom','wrap-behind','wrap-front');
    img.classList.add('wrap-' + (layout.wrap || 'inline'));
    const w = layout.wrap;
    if (w === 'square' || w === 'tight') {
      img.style.float = layout.align === 'right' ? 'right' : 'left';
      if (w === 'tight') img.style.shapeOutside = `url(${img.src})`;
      img.style.marginRight = '10px';
      img.style.marginLeft = '10px';
    } else if (w === 'topbottom') {
      img.style.display = 'block';
      img.style.clear = 'both';
      if (layout.align === 'center') { img.style.marginLeft = 'auto'; img.style.marginRight = 'auto'; }
      else if (layout.align === 'right') { img.style.marginLeft = 'auto'; img.style.marginRight = '0'; }
    } else if (w === 'behind') {
      img.style.position = 'absolute';
      img.style.zIndex = '-1';
    } else if (w === 'front') {
      img.style.position = 'absolute';
      img.style.zIndex = '5';
    } else {
      // inline default
      img.style.display = 'inline-block';
      if (layout.align === 'center') { img.style.display = 'block'; img.style.marginLeft = 'auto'; img.style.marginRight = 'auto'; }
      else if (layout.align === 'right') { img.style.display = 'block'; img.style.marginLeft = 'auto'; img.style.marginRight = '0'; }
    }
  }

  function getImgState(img) {
    try {
      return JSON.parse(img.dataset.editState) || defaultImgState();
    } catch {
      return defaultImgState();
    }
  }

  function applyImgState(img, state) {
    const f = state.filters;
    img.style.filter = [
      `brightness(${f.brightness})`,
      `contrast(${f.contrast})`,
      `saturate(${f.saturate})`,
      `hue-rotate(${f['hue-rotate']}deg)`,
      `blur(${f.blur}px)`,
      `grayscale(${f.grayscale})`,
      `sepia(${f.sepia})`,
      `invert(${f.invert})`
    ].join(' ');

    const c = state.crop;
    img.style.clipPath = `inset(${c.top}% ${c.right}% ${c.bottom}% ${c.left}%)`;

    const x = state.xform;
    const scaleX = x.flipH ? -1 : 1;
    const scaleY = x.flipV ? -1 : 1;
    img.style.transform = `rotate(${x.rotate}deg) scale(${scaleX}, ${scaleY})`;

    // Do NOT force width — preserve natural/user-set size
    img.style.maxWidth = '100%';

    if (state.layout) applyLayout(img, state.layout);

    img.dataset.editState = JSON.stringify(state);
  }

  // --- Resize / Crop overlay (Word-style) ---
  function positionOverlay() {
    if (!selectedImg || !document.contains(selectedImg)) {
      selOverlay.hidden = true;
      return;
    }
    const r = selectedImg.getBoundingClientRect();
    selOverlay.hidden = false;
    selOverlay.style.left = r.left + 'px';
    selOverlay.style.top = r.top + 'px';
    selOverlay.style.width = r.width + 'px';
    selOverlay.style.height = r.height + 'px';
    selOverlay.classList.toggle('crop-mode', cropMode);
    updateCropMask();
  }

  function updateCropMask() {
    const c = cropMode ? (cropDraft || { top:0,right:0,bottom:0,left:0 }) : null;
    const t = selOverlay.querySelector('.mask-t');
    const r = selOverlay.querySelector('.mask-r');
    const b = selOverlay.querySelector('.mask-b');
    const l = selOverlay.querySelector('.mask-l');
    if (!cropMode) {
      [t,r,b,l].forEach(el => { if (el) el.style.display = 'none'; });
      return;
    }
    [t,r,b,l].forEach(el => { if (el) el.style.display = 'block'; });
    t.style.cssText += `;top:0;left:0;right:0;height:${c.top}%`;
    b.style.cssText += `;bottom:0;left:0;right:0;height:${c.bottom}%`;
    l.style.cssText += `;top:${c.top}%;bottom:${c.bottom}%;left:0;width:${c.left}%`;
    r.style.cssText += `;top:${c.top}%;bottom:${c.bottom}%;right:0;width:${c.right}%`;
  }

  window.addEventListener('scroll', positionOverlay, true);
  window.addEventListener('resize', positionOverlay);
  editor.addEventListener('dragend', () => setTimeout(positionOverlay, 50));
  editor.addEventListener('drop', () => setTimeout(positionOverlay, 50));

  selOverlay.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.img-handle');
    if (!handle || !selectedImg) return;
    const h = handle.dataset.handle;
    if (!h) return;
    e.preventDefault(); e.stopPropagation();

    if (cropMode) {
      startCropDrag(e, h, handle);
    } else {
      startResizeDrag(e, h, handle);
    }
  });

  function startResizeDrag(e, h, handle) {
    try { handle.setPointerCapture(e.pointerId); } catch {}
    document.body.style.userSelect = 'none';
    const startX = e.clientX, startY = e.clientY;
    const startW = selectedImg.offsetWidth;
    const startH = selectedImg.offsetHeight;
    const aspect = startW / Math.max(1, startH);
    const west = h.includes('w'), east = h.includes('e');
    const north = h.includes('n'), south = h.includes('s');
    const isCorner = (east || west) && (north || south);

    const onMove = (ev) => {
      let dx = ev.clientX - startX;
      let dy = ev.clientY - startY;
      if (west) dx = -dx;
      if (north) dy = -dy;

      let newW = startW, newH = startH;
      if (east || west) newW = Math.max(24, startW + dx);
      if (north || south) newH = Math.max(24, startH + dy);

      if (lockAspect) {
        if (isCorner) {
          // Pick whichever axis user moved more — feels more natural
          const wDelta = Math.abs(newW - startW);
          const hDeltaAsW = Math.abs(newH * aspect - startW);
          if (wDelta >= hDeltaAsW) {
            newH = newW / aspect;
          } else {
            newW = newH * aspect;
          }
        } else if (east || west) {
          newH = newW / aspect;
        } else {
          newW = newH * aspect;
        }
      }
      selectedImg.style.width = newW + 'px';
      selectedImg.style.height = newH + 'px';
      positionOverlay();
      updatePanelPreview();
      syncSizeInputs();
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      try { handle.releasePointerCapture(e.pointerId); } catch {}
      document.body.style.userSelect = '';
      scheduleSave();
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  function startCropDrag(e, h, handle) {
    try { handle.setPointerCapture(e.pointerId); } catch {}
    document.body.style.userSelect = 'none';
    const rect = selectedImg.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const start = { ...cropDraft };
    const MIN_GAP = 5; // min visible window between opposing edges in %

    const onMove = (ev) => {
      const dxP = ((ev.clientX - startX) / Math.max(1, rect.width)) * 100;
      const dyP = ((ev.clientY - startY) / Math.max(1, rect.height)) * 100;
      const c = { ...start };
      if (h.includes('n')) c.top = Math.max(0, Math.min(100 - c.bottom - MIN_GAP, start.top + dyP));
      if (h.includes('s')) c.bottom = Math.max(0, Math.min(100 - c.top - MIN_GAP, start.bottom - dyP));
      if (h.includes('w')) c.left = Math.max(0, Math.min(100 - c.right - MIN_GAP, start.left + dxP));
      if (h.includes('e')) c.right = Math.max(0, Math.min(100 - c.left - MIN_GAP, start.right - dxP));
      cropDraft = c;
      updateCropMask();
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      try { handle.releasePointerCapture(e.pointerId); } catch {}
      document.body.style.userSelect = '';
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  function enterCropMode() {
    if (!selectedImg) return;
    cropMode = true;
    const state = getImgState(selectedImg);
    cropDraft = { ...state.crop };
    $('#ipCropToggle').hidden = true;
    $('#ipCropApply').hidden = false;
    $('#ipCropCancel').hidden = false;
    positionOverlay();
  }

  function exitCropMode() {
    cropMode = false;
    cropDraft = null;
    $('#ipCropToggle').hidden = false;
    $('#ipCropApply').hidden = true;
    $('#ipCropCancel').hidden = true;
    positionOverlay();
  }

  function applyCrop() {
    if (!selectedImg || !cropDraft) { exitCropMode(); return; }
    const state = getImgState(selectedImg);
    state.crop = { ...cropDraft };
    applyImgState(selectedImg, state);
    exitCropMode();
    scheduleSave();
  }

  function syncSizeInputs() {
    const w = $('#ipWidth'), h = $('#ipHeight');
    if (!selectedImg || !w || !h) return;
    w.value = selectedImg.offsetWidth | 0;
    h.value = selectedImg.offsetHeight | 0;
  }

  function updatePanelPreview() {
    if (!selectedImg) return;
    const info = $('#ipInfo');
    if (info) {
      const w = selectedImg.offsetWidth | 0;
      const h = selectedImg.offsetHeight | 0;
      const nw = selectedImg.naturalWidth | 0;
      const nh = selectedImg.naturalHeight | 0;
      info.textContent = `${w}×${h}px · orijinal ${nw}×${nh}`;
    }
  }

  function selectImage(img) {
    if (selectedImg && selectedImg !== img && cropMode) exitCropMode();
    if (selectedImg) selectedImg.classList.remove('img-selected');
    selectedImg = img;
    img.classList.add('img-selected');
    document.body.classList.add('has-image-panel');
    const ipe = $('#imagePanelEmpty');
    const ipb = $('#imagePanelBody');
    if (ipe) ipe.hidden = true;
    if (ipb) ipb.hidden = false;
    syncPanelToImage(img);
    positionOverlay();
    updatePanelPreview();
    syncSizeInputs();
    // On mobile, scroll image into view so panel doesn't cover it
    if (window.innerWidth <= 900) {
      requestAnimationFrame(() => {
        try { img.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
      });
    }
  }

  function deselectImage() {
    if (selectedImg) selectedImg.classList.remove('img-selected');
    selectedImg = null;
    document.body.classList.remove('has-image-panel');
    const ipe = $('#imagePanelEmpty');
    const ipb = $('#imagePanelBody');
    if (ipe) ipe.hidden = true;
    if (ipb) ipb.hidden = true;
    selOverlay.hidden = true;
  }

  function syncPanelToImage(img) {
    const state = getImgState(img);
    applyImgState(img, state);
    // Sliders
    imagePanel.querySelectorAll('input[data-filter]').forEach(inp => {
      const key = inp.dataset.filter;
      inp.value = state.filters[key];
      updateValDisplay(inp);
    });
    imagePanel.querySelectorAll('input[data-crop]').forEach(inp => {
      inp.value = state.crop[inp.dataset.crop];
      updateValDisplay(inp);
    });
    imagePanel.querySelectorAll('input[data-xform]').forEach(inp => {
      inp.value = state.xform[inp.dataset.xform];
      updateValDisplay(inp);
    });
  }

  function updateValDisplay(inp) {
    const valEl = imagePanel.querySelector(`[data-val="${inp.dataset.filter || inp.dataset.xform || inp.dataset.size || ('crop' + cap(inp.dataset.crop || ''))}"]`);
    if (!valEl) return;
    const v = parseFloat(inp.value);
    const key = inp.dataset.filter;
    if (key === 'hue-rotate') valEl.textContent = v + '°';
    else if (key === 'blur') valEl.textContent = v + 'px';
    else if (inp.dataset.filter) valEl.textContent = v.toFixed(2);
    else if (inp.dataset.crop) valEl.textContent = v + '%';
    else if (inp.dataset.xform === 'rotate') valEl.textContent = v + '°';
    else if (inp.dataset.size === 'width') valEl.textContent = v + '%';
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // Image selection — use mousedown without preventDefault so native drag still works
  document.addEventListener('mousedown', (e) => {
    const img = e.target.closest && e.target.closest('#editor img');
    console.log('[select] mousedown target=', e.target.tagName, 'img?', !!img);
    if (img) {
      selectImage(img);
      return;
    }
    if (e.target.closest('.img-sel-overlay')) return;
    if (!selectedImg) return;
    if (e.target.closest('.image-panel')) return;
    if (e.target.closest('.toolbar')) return;
    if (e.target.closest('#editorContextMenu')) return;
    deselectImage();
  }, true);

  // Mobile touch selection
  document.addEventListener('touchstart', (e) => {
    const img = e.target.closest && e.target.closest('#editor img');
    console.log('[select] touchstart target=', e.target.tagName, 'img?', !!img);
    if (img) {
      selectImage(img);
      return;
    }
    if (e.target.closest('.img-sel-overlay')) return;
    if (!selectedImg) return;
    if (e.target.closest('.image-panel')) return;
    if (e.target.closest('.toolbar')) return;
    if (e.target.closest('#editorContextMenu')) return;
    deselectImage();
  }, { capture: true, passive: true });
  // Right-click image also selects it
  document.addEventListener('contextmenu', (e) => {
    const img = e.target.closest && e.target.closest('#editor img');
    console.log('[select] contextmenu-select img?', !!img);
    if (img) selectImage(img);
  }, true);

  // Also handle click as backup
  editor.addEventListener('click', (e) => {
    const img = e.target.closest && e.target.closest('img');
    if (img) {
      e.preventDefault();
      selectImage(img);
    }
  });

  // Slider bindings
  imagePanel.addEventListener('input', (e) => {
    console.log('[panel] input fired', e.target.dataset);
    if (!selectedImg) { console.warn('[panel] no selectedImg'); return; }
    if (e.target.tagName !== 'INPUT') return;
    const inp = e.target;
    const state = getImgState(selectedImg);
    if (inp.dataset.filter) state.filters[inp.dataset.filter] = parseFloat(inp.value);
    else if (inp.dataset.crop) state.crop[inp.dataset.crop] = parseFloat(inp.value);
    else if (inp.dataset.xform) state.xform[inp.dataset.xform] = parseFloat(inp.value);
    applyImgState(selectedImg, state);
    updateValDisplay(inp);
    positionOverlay();
    scheduleSave();
  });

  // Flip / rotate buttons
  imagePanel.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-xform-btn]');
    if (!btn || !selectedImg) return;
    const state = getImgState(selectedImg);
    const key = btn.dataset.xformBtn;
    if (key === 'flipH' || key === 'flipV') {
      state.xform[key] = !state.xform[key];
    } else if (key === 'rotCW') {
      state.xform.rotate = ((state.xform.rotate || 0) + 90) % 360;
    } else if (key === 'rotCCW') {
      state.xform.rotate = ((state.xform.rotate || 0) - 90 + 360) % 360;
    }
    applyImgState(selectedImg, state);
    syncPanelToImage(selectedImg);
    positionOverlay();
    scheduleSave();
  });

  // Crop toggle buttons
  $('#ipCropToggle').addEventListener('click', enterCropMode);
  $('#ipCropApply').addEventListener('click', applyCrop);
  $('#ipCropCancel').addEventListener('click', exitCropMode);

  // Wrap mode buttons
  imagePanel.addEventListener('click', (e) => {
    const wb = e.target.closest('button[data-wrap]');
    if (wb && selectedImg) {
      const state = getImgState(selectedImg);
      state.layout = state.layout || { wrap: 'inline', align: '' };
      state.layout.wrap = wb.dataset.wrap;
      applyImgState(selectedImg, state);
      positionOverlay();
      scheduleSave();
      return;
    }
    const ab = e.target.closest('button[data-align]');
    if (ab && selectedImg) {
      const state = getImgState(selectedImg);
      state.layout = state.layout || { wrap: 'inline', align: '' };
      state.layout.align = ab.dataset.align;
      applyImgState(selectedImg, state);
      positionOverlay();
      scheduleSave();
    }
  });

  // --- OCR on selected image ---
  $('#ipOcr').addEventListener('click', async () => {
    if (!selectedImg) { alert('Önce bir resim seçin.'); return; }
    const popup = $('#ocrPopup');
    const status = $('#ocrPopupStatus');
    const textEl = $('#ocrPopupText');
    popup.hidden = false;
    textEl.value = '';
    status.textContent = 'OCR başlatılıyor...';
    try {
      const { text } = await runOcr(selectedImg.src, (p, msg) => {
        status.textContent = `${msg || 'İşleniyor'} — ${(p*100)|0}%`;
      });
      status.textContent = `Tamamlandı (${text.length} karakter)`;
      textEl.value = text || '(Metin bulunamadı)';
    } catch (err) {
      status.textContent = 'Hata: ' + err.message;
      console.error('[ocr]', err);
    }
  });

  async function runSelectedImageGrabText() {
    if (!selectedImg) { alert('Önce bir resim seçin.'); return; }
    const popup = $('#ocrPopup');
    const status = $('#ocrPopupStatus');
    const textEl = $('#ocrPopupText');
    popup.hidden = false;
    textEl.value = '';
    status.textContent = 'Grab Text başlatılıyor...';
    try {
      const { text } = await runGrabText(selectedImg.src, (p, msg) => {
        status.textContent = `${msg || 'Recognizing text'} — ${p}%`;
      });
      status.textContent = `Grab Text tamamlandı (${text.length} karakter)`;
      textEl.value = text || '(Metin bulunamadı)';
    } catch (err) {
      status.textContent = 'Grab Text hata: ' + err.message;
      console.error('[grab-text]', err);
    }
  }

  $('#ipGrabText').addEventListener('click', runSelectedImageGrabText);

  $('#ocrInsertText').addEventListener('click', () => {
    const txt = $('#ocrPopupText').value;
    if (!txt) return;
    editor.focus();
    document.execCommand('insertText', false, '\n' + txt + '\n');
    $('#ocrPopup').hidden = true;
    scheduleSave();
  });

  $('#ocrCopyText').addEventListener('click', async () => {
    const txt = $('#ocrPopupText').value;
    if (!txt) return;
    try { await navigator.clipboard.writeText(txt); $('#ocrPopupStatus').textContent = 'Panoya kopyalandı'; }
    catch { alert('Kopyalanamadı'); }
  });

  $('#ocrPopupClose').addEventListener('click', () => $('#ocrPopup').hidden = true);
  $('#ocrPopupClose2').addEventListener('click', () => $('#ocrPopup').hidden = true);

  // Aspect lock
  $('#ipLockAspect').addEventListener('click', () => {
    lockAspect = !lockAspect;
    const btn = $('#ipLockAspect');
    btn.textContent = lockAspect ? '🔒' : '🔓';
    btn.setAttribute('aria-pressed', lockAspect);
  });

  // Size inputs
  $('#ipWidth').addEventListener('input', () => {
    if (!selectedImg) return;
    const w = parseInt($('#ipWidth').value, 10);
    if (!w || w < 10) return;
    const aspect = selectedImg.offsetWidth / Math.max(1, selectedImg.offsetHeight);
    selectedImg.style.width = w + 'px';
    if (lockAspect) {
      const h = Math.round(w / aspect);
      selectedImg.style.height = h + 'px';
      $('#ipHeight').value = h;
    }
    positionOverlay(); updatePanelPreview(); scheduleSave();
  });
  $('#ipHeight').addEventListener('input', () => {
    if (!selectedImg) return;
    const h = parseInt($('#ipHeight').value, 10);
    if (!h || h < 10) return;
    const aspect = selectedImg.offsetWidth / Math.max(1, selectedImg.offsetHeight);
    selectedImg.style.height = h + 'px';
    if (lockAspect) {
      const w = Math.round(h * aspect);
      selectedImg.style.width = w + 'px';
      $('#ipWidth').value = w;
    }
    positionOverlay(); updatePanelPreview(); scheduleSave();
  });

  $('#ipResetAll').addEventListener('click', () => {
    if (!selectedImg) return;
    applyImgState(selectedImg, defaultImgState());
    syncPanelToImage(selectedImg);
    scheduleSave();
  });

  $('#ipDelete').addEventListener('click', () => {
    if (!selectedImg) return;
    if (!confirm('Resmi sil?')) return;
    selectedImg.remove();
    deselectImage();
    scheduleSave();
  });

  $('#ipReplace').addEventListener('click', () => {
    if (!selectedImg) return;
    $('#imageReplaceInput').click();
  });

  $('#ipSetBg').addEventListener('click', () => {
    if (!selectedImg) return;
    if (typeof window.__npSetBgFromImage === 'function') {
      window.__npSetBgFromImage(selectedImg);
    }
  });

  $('#imageReplaceInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file || !selectedImg) return;
    fileToDisplayDataUrl(file).then((dataUrl) => {
      selectedImg.src = dataUrl;
      scheduleSave();
    }).catch(err => console.error('[image] replace failed', err));
    e.target.value = '';
  });

  // Image file picker
  $('#imageInput').addEventListener('change', (e) => {
    const allFiles = [...e.target.files];
    console.log('[insertImage] files picked:', allFiles.map(f => f.name + ' ' + f.type));
    const files = allFiles.filter(f => f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic)$/i.test(f.name));
    if (!files.length) {
      alert('Resim dosyası bulunamadı. Seçilen: ' + allFiles.map(f => f.name).join(', '));
      e.target.value = '';
      return;
    }
    if (!getActiveNote()) createNote();
    editor.focus();
    // Put caret at end if no selection in editor
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) {
      const r = document.createRange();
      r.selectNodeContents(editor);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    let remaining = files.length;
    files.forEach(file => {
      insertImageFromFile(file).then(() => {
        remaining--;
        if (remaining === 0) {
          updateCounts();
          scheduleSave();
        }
      }).catch((err) => {
        console.error('[insertImage] insert failed', err);
        alert('Resim eklenemedi: ' + (err && err.message ? err.message : file.name));
        remaining--;
        if (remaining === 0) { updateCounts(); scheduleSave(); }
      });
    });
    e.target.value = '';
  });

  // Import dropup: each option sets accept attribute then triggers picker
  const IMPORT_ACCEPTS = {
    any:   '.txt,.md,.html,.docx,.xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png,.gif,.bmp,.webp',
    txt:   '.txt,.md',
    word:  '.docx',
    excel: '.xlsx,.xls,.csv',
    pdf:   '.pdf',
    image: 'image/*'
  };
  const importMenu = $('#importMenu');
  const btnImportToggle = $('#btnImportToggle');
  if (btnImportToggle && importMenu) {
    btnImportToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      importMenu.classList.toggle('open');
      $('#backupMenu')?.classList.remove('open');
    });
    importMenu.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-import-type]');
      if (!btn) return;
      const type = btn.dataset.importType;
      importMenu.classList.remove('open');
      openFilePicker(IMPORT_ACCEPTS[type] || IMPORT_ACCEPTS.any);
    });
  }

  // Backup dropup toggle
  const backupMenu = $('#backupMenu');
  const btnBackupToggle = $('#btnBackupToggle');
  if (btnBackupToggle && backupMenu) {
    btnBackupToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      backupMenu.classList.toggle('open');
      importMenu?.classList.remove('open');
    });
    backupMenu.addEventListener('click', () => {
      // close after any item click (handlers are attached by id elsewhere)
      setTimeout(() => backupMenu.classList.remove('open'), 0);
    });
  }

  // Close dropups when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropup-wrap')) {
      importMenu?.classList.remove('open');
      backupMenu?.classList.remove('open');
    }
  });

  // Image panel close button
  const ipClose = $('#ipClose');
  if (ipClose) {
    ipClose.addEventListener('click', () => deselectImage());
  }

  // About panel toggle
  const btnAbout = $('#btnAbout');
  const aboutPanel = $('#aboutPanel');
  if (btnAbout && aboutPanel) {
    btnAbout.addEventListener('click', () => {
      aboutPanel.hidden = !aboutPanel.hidden;
    });
  }

  // Tools & Settings Accordion toggle
  const btnToolsToggle = $('#btnToolsToggle');
  const toolsContent = $('#toolsContent');
  function setToolsOpen(open) {
    if (!btnToolsToggle || !toolsContent) return;
    toolsContent.style.display = open ? 'block' : 'none';
    btnToolsToggle.classList.toggle('active', open);
    const arrow = btnToolsToggle.querySelector('.accordion-arrow');
    if (arrow) arrow.textContent = open ? '▴' : '▾';
  }
  if (btnToolsToggle && toolsContent) {
    btnToolsToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      setToolsOpen(toolsContent.style.display === 'none');
    });
    // Close when clicking anywhere outside the accordion (editor, note list, etc.)
    document.addEventListener('click', (e) => {
      if (toolsContent.style.display === 'none') return;
      if (e.target.closest('#toolsContent')) return;
      if (e.target.closest('#btnToolsToggle')) return;
      setToolsOpen(false);
    });
  }


  // Refresh app: clear ONLY this app's cached files (origin-scoped) + reload
  // Notes (localStorage) and other sites' data are NOT touched.
  // Browser-managed HTTP cache is bypassed via cache-bust query param.
  const btnRefreshApp = $('#btnRefreshApp');
  if (btnRefreshApp) {
    btnRefreshApp.addEventListener('click', async () => {
      const msg = (CURRENT_LANG === 'en')
        ? 'Refresh this app and clear its cached files? Your notes are kept. Other websites are not affected.'
        : 'Bu uygulamanın önbelleğe alınmış dosyaları temizlensin ve yenilensin mi? Notlarınız korunacak. Diğer siteler etkilenmez.';
      if (!confirm(msg)) return;
      btnRefreshApp.classList.add('spinning');
      btnRefreshApp.disabled = true;
      try {
        // Service Worker registrations are origin-scoped — only this app's SW affected
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister().catch(() => null)));
        }
        // Cache Storage API is origin-scoped — only this app's caches affected
        if (window.caches) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k).catch(() => null)));
        }
      } catch (err) {
        console.warn('[refresh]', err);
      }
      // Hard reload with cache-bust query — bypasses HTTP cache for this URL only
      const url = new URL(location.href);
      url.searchParams.set('_r', Date.now().toString(36));
      location.replace(url.toString());
    });
  }

  // Direct binding for Insert Image (delegation backup)
  const btnInsertImage = document.querySelector('button[data-action="insertImage"]');
  if (btnInsertImage) {
    btnInsertImage.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const inp = $('#imageInput');
      if (inp) { inp.value = ''; inp.click(); }
    });
  }

  // OCR engine selector
  const ocrSel = $('#ocrEngine');
  if (ocrSel) {
    ocrSel.value = ocrEngine;
    ocrSel.addEventListener('change', (e) => {
      ocrEngine = e.target.value;
      localStorage.setItem('ocr_engine', ocrEngine);
      paddleOcrReady = null;
    });
  }

  // Offline indicator
  const offlineBadge = $('#offlineBadge');
  function updateOnlineStatus() {
    if (offlineBadge) offlineBadge.hidden = navigator.onLine;
  }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

  window.addEventListener('pagehide', flushPendingSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingSave();
  });

  // Handle PWA shortcut ?action=new, protocol handler ?note=, share_target ?title/text/url
  const __qp = new URLSearchParams(location.search);
  if (__qp.get('action') === 'new') {
    createNote();
    history.replaceState(null, '', location.pathname);
  } else if (__qp.get('note')) {
    const payload = { text: __qp.get('note') || '' };
    if (__qp.get('source') === 'chrome-extension') openClipTargetPicker(payload);
    else createExternalNote(payload);
    history.replaceState(null, '', location.pathname);
  } else if (__qp.get('text') || __qp.get('title') || __qp.get('url')) {
    const payload = {
      title: __qp.get('title') || '',
      text: __qp.get('text') || '',
      url: __qp.get('url') || ''
    };
    if (__qp.get('source') === 'chrome-extension') openClipTargetPicker(payload);
    else createExternalNote(payload);
    history.replaceState(null, '', location.pathname);
  }

  // ----- i18n table (assigned to early-declared I18N_TABLE) -----
  I18N_TABLE = {
    tr: {
      notes: 'Notlar',
      myNotes: 'Notlarım',
      trashBin: 'Çöp Kutusu',
      emptyTrash: 'Çöpü Boşalt',
      trashBannerText: 'Bu not Çöp Kutusu\'nda bulunuyor.',
      restore: 'Kurtar',
      deletePermanently: 'Kalıcı Olarak Sil',
      privacy: 'Yerel — sunucuya yüklenmez',
      privacyTooltip: 'Tüm notlar tarayıcınızda yerel olarak saklanır. Hiçbir şey yüklenmez.',
      newNote: 'Yeni Not',
      searchNotes: 'Notlarda ara...',
      sortByDate: 'Tarih',
      sortByName: 'İsim',
      untitled: 'İsimsiz Not',
      clipTargetTitle: 'Web clip nereye eklensin?',
      clipNewNote: 'Yeni not oluştur',
      noNotesFound: 'Not bulunamadı',
      emptyNote: 'Boş not',
      activeNote: 'aktif not',
      webPage: 'Web sayfası',
      import: 'İçe Aktar',
      backup: 'Yedek',
      importAll: 'Tüm Dosyalar',
      importTxt: 'TXT / Markdown',
      importWord: 'Word (.docx)',
      importExcel: 'Excel / CSV',
      importPdf: 'PDF',
      importImage: 'Resim (OCR)',
      exportJson: 'JSON Dışa Aktar',
      importJson: 'JSON İçe Aktar',
      emailJsonBtn: 'JSON E-postala',
      exportSql: 'SQL Dışa Aktar',
      importSql: 'SQL İçe Aktar',
      ocrPaddle: 'PaddleOCR (hızlı)',
      ocrTesseract: 'Tesseract (TR)',
      imageTools: 'Resim Araçları',
      selectImageHint: 'Düzenlemek için bir resme tıklayın',
      close: 'Kapat',
      size: 'Boyut',
      crop: 'Kırp',
      cropMode: '✂ Kırp Modu',
      apply: '✓ Uygula',
      cancel: '✕ İptal',
      lockAspect: 'Oranı kilitle',
      wrapText: 'Metin Kaydırma',
      wrapInline: 'Satır içi',
      wrapSquare: 'Kare',
      wrapTight: 'Sıkı',
      wrapTopBottom: 'Üst/Alt',
      wrapBehind: 'Arka',
      wrapFront: 'Ön',
      position: 'Konum',
      alignLeft: 'Sola',
      alignCenter: 'Ortala',
      alignRight: 'Sağa',
      transform: 'Dönüşüm',
      rotateCCW: 'Sola 90°',
      rotateCW: 'Sağa 90°',
      flipH: 'Yatay çevir',
      flipV: 'Dikey çevir',
      rotate: 'Döndür',
      adjustments: 'Düzeltmeler',
      brightness: 'Parlaklık',
      contrast: 'Kontrast',
      saturate: 'Doygunluk',
      hue: 'Ton',
      blur: 'Bulanıklık',
      artisticFx: 'Sanatsal Efektler',
      grayscale: 'Gri Ton',
      sepia: 'Sepya',
      invert: 'İnvert',
      ocrButton: '🔍 Resimden Metin Çıkar',
      grabText: 'Grab Text',
      grabTextTip: 'Resimdeki metni Tesseract tur+eng ile yakala',
      ocrResult: 'OCR Sonucu',
      ocrPlaceholder: 'OCR sonucu burada görünecek...',
      insertText: 'Metni Ekle',
      replace: 'Değiştir',
      reset: 'Sıfırla',
      delete: 'Sil',
      rename: 'Adını Değiştir',
      duplicate: 'Çoğalt',
      cut: 'Kes',
      copy: 'Kopyala',
      paste: 'Yapıştır',
      translateText: 'Çevir',
      translating: 'Çevriliyor...',
      translateFailed: 'Çeviri başarısız.',
      selectLanguage: 'Dil seç:',
      pasteImage: 'Panodan Resim Yapıştır',
      uploadImage: 'Resim Yükle (Diskten)',
      saveImage: 'Resmi Kaydet',
      imageZoomOut: 'Resim -',
      imageZoomIn: 'Resim +',
      findReplace: 'Bul ve Değiştir',
      find: 'Bul:',
      replaceWith: 'Şununla değiştir:',
      findNext: 'Sonrakini Bul',
      findAll: 'Tümünü Bul',
      replaceOne: 'Değiştir',
      replaceAll: 'Tümünü Değiştir',
      matchCase: 'Büyük/Küçük Harf Duyarlı',
      wholeWord: 'Tam Sözcük',
      useRegex: 'Düzenli İfade (Regex)',
      saveTxt: '.txt olarak kaydet',
      saveMd: 'Markdown (.md) olarak kaydet',
      savePdf: 'PDF olarak kaydet',
      saveWord: 'Word olarak kaydet',
      shareDevice: 'Cihazdan Paylaş (dosya)',
      shareWA: 'WhatsApp (metin)',
      shareEmail: 'E-posta (metin)',
      shareEmailPdf: 'E-posta + PDF indir',
      shareWAPdf: 'WhatsApp + PDF indir',
      zoom: 'Zoom',
      zoomIn: 'Yakınlaştır',
      zoomOut: 'Uzaklaştır',
      pageSize: 'Sayfa Boyutu',
      pageFree: 'Serbest',
      orientation: 'Sayfa Yönü',
      formatMarks: 'Biçimlendirme İşaretleri',
      clearFormat: 'Biçimi Temizle',
      copyFormat: 'Biçimi Kopyala',
      formatCopied: 'Biçim kopyalandı',
      newNoteTip: 'Yeni Not (Ctrl+Alt+N)',
      openTip: 'Aç (Ctrl+O)',
      saveTip: 'Kaydet (Ctrl+S)',
      printTip: 'Yazdır (Ctrl+P)',
      installPwa: 'Uygulamayı Yükle',
      findReplaceTip: 'Bul ve Değiştir (Ctrl+H)',
      insertImage: 'Resim Ekle',
      insertTextBox: 'Metin Kutusu Ekle',
      insertShape: 'Şekil & İkon Ekle',
      insertLink: 'Bağlantı Ekle',
      insertTable: 'Tablo Ekle',
      calculator: 'Hesap Makinesi',
      calendar: 'Takvim',
      insertSheet: 'Mini Tablo (Formüllü)',
      orientationShort: 'Yön',
      findShort: 'Bul',
      imageShort: 'Resim',
      textBoxShort: 'Metin',
      shapeShort: 'Şekil',
      tableShort: 'Tablo',
      linkShort: 'Link',
      gridShort: 'Izgara',
      calcShort: 'Hesap',
      calShort: 'Takvim',
      calToday: 'Bugün',
      calInsertDate: 'Tarihi Ekle',
      refreshShort: 'Yenile',
      sheetShort: 'Formül',
      dateShort: 'Tarih',
      screenShort: 'Ekran',
      noteColor: 'Renk',
      noteGroup: 'Grup',
      sendToGroup: 'Gruba Gönder',
      copyText: 'Notu Kopyala',
      selectAll: 'Tümünü Seç',
      androidApp: 'Android İndir',
      androidAppTip: 'Android uygulaması olarak indir',
      chromeExtension: 'Chrome Eklentisi',
      chromeExtensionTip: 'ZIP’i indirip çıkarın; Chrome Extensions sayfasında Load unpacked ile manifest.json klasörünü seçin.',
      bgImageSet: 'Arka Plan Yap',
      bgImageClear: 'Arka Planı Kaldır',
      bgImageFit: 'Sığdır',
      bgImageCover: 'Kapla',
      linkUrl: 'URL',
      linkText: 'Görünen Metin',
      linkDesc: 'Açıklama',
      tableRows: 'Satır',
      tableCols: 'Sütun',
      color: 'Renk',
      fill: 'Dolu',
      borderColor: 'Çerçeve',
      bgColor: 'Arka plan',
      radius: 'Köşe',
      insertDateTime: 'Tarih/Saat Ekle',
      fullscreen: 'Tam Ekran',
      share: 'Paylaş',
      deleteNote: 'Notu Sil',
      words: 'Kelime',
      chars: 'Karakter',
      saved: 'Kaydedildi',
      saving: 'Kaydediliyor...',
      saveFailed: 'Kaydetme başarısız.',
      storageFull: 'Depolama dolu. Büyük görselleri kaldırın veya yedek alın.',
      about: 'Hakkında',
      rights: 'Tüm hakları saklıdır',
      otherTools: 'Diğer araçlar:',
      toolsSettings: 'Araçlar & Ayarlar',
      moreTools: 'Daha fazla araç → drtr.uk',
      refreshApp: 'Güncelle',
      refreshTip: 'Bu uygulamanın önbelleğini temizle ve yenile (notlar korunur)',
      installApp: 'Uygulama Olarak Yükle',
      installAppTip: 'Cihaza uygulama olarak ekle (PWA)',
      iosStep1: '1. Tarayıcıdaki Paylaş simgesine dokunun',
      iosStep2: '2. Açılan menüden "Ana Ekrana Ekle" seçeneğine dokunun',
      iosStep3: '3. Sağ üstten Ekle deyin — uygulama ana ekranınızda yer alır',
      gotIt: 'Tamam',
      signInGoogle: 'Google ile Bağla',
      signOut: 'Çıkış',
      signedInAs: 'Bağlı: ',
      syncIdle: 'Senkron beklemede',
      syncing: 'Senkronize ediliyor...',
      syncOk: 'Senkronize edildi',
      syncError: 'Senkronizasyon hatası',
      cloudSetupNeeded: 'Google OAuth Client ID eksik (cloud-config.js)',
      cloudSetupHelp: 'Google Drive senkronizasyonu için OAuth Client ID gerekli.\n\nKurulum (uygulama sahibi yapar):\n1. console.cloud.google.com → yeni proje\n2. Google Drive API\'yi etkinleştir\n3. OAuth consent screen + scope: drive.appdata\n4. Credentials → OAuth client ID (Web)\n   - JS origins: https://not.drtr.uk\n   - Redirect URIs: https://not.drtr.uk/ (sonunda slash)\n5. Client ID\'yi js/cloud-config.js içine yapıştır\n6. Yeniden yükle\n\nDetaylar cloud-config.js dosyasının başında.',
      cloudConfirmSignOut: 'Google hesabınızdan çıkış yapılacak. Yerel notlar korunur. Devam edilsin mi?',
      switchAccount: 'Hesap değiştir',
      cloudConfirmSwitch: 'Farklı bir Google hesabına geçilecek. Çıkış yapmanıza gerek yok — hesap seçme ekranı açılacak. Not: yerel notlarınız seçtiğiniz hesabın Drive\'ıyla eşitlenir. Devam edilsin mi?',
      lastSync: 'Son senkron: ',
      briefcase: 'Evrak Çantası',
      briefcaseTip: 'Dosyalarınızı buraya yükleyip başka bir cihazdan indirin',
      briefcaseSignInNeeded: 'Dosya göndermek ve almak için Google ile bağlanın. Dosyalarınız kişisel Google Drive hesabınızda saklanır ve aynı hesapla girdiğiniz diğer cihazlarda görünür.',
      briefcaseDropHint: 'Dosyaları buraya sürükleyin ya da',
      briefcaseChooseFile: 'Dosya Seç',
      briefcaseEmpty: 'Henüz dosya yok.',
      briefcaseUploading: 'Yükleniyor: ',
      briefcaseUploadFailed: 'Yükleme başarısız: ',
      briefcaseTooLarge: 'Dosya çok büyük (100MB üzeri desteklenmiyor): ',
      briefcaseListFailed: 'Dosya listesi alınamadı.',
      briefcaseDeleteConfirm: 'Bu dosya silinsin mi?',
      briefcaseDeleteFailed: 'Silme başarısız.',
      briefcaseDownloadFailed: 'İndirme başarısız.',
      briefcaseDownloading: 'İndiriliyor: ',
      briefcaseParts: 'parça',
      briefcaseIncomplete: 'Eksik parça — indirilemez'
    },
    en: {
      notes: 'Notes',
      myNotes: 'My Notes',
      trashBin: 'Trash Bin',
      emptyTrash: 'Empty Trash',
      trashBannerText: 'This note is in the Trash Bin.',
      restore: 'Restore',
      deletePermanently: 'Delete Permanently',
      privacy: 'Local only — no server',
      privacyTooltip: 'All notes are stored locally in your browser. Nothing is uploaded.',
      newNote: 'New Note',
      searchNotes: 'Search notes...',
      sortByDate: 'Date',
      sortByName: 'Name',
      untitled: 'Untitled Note',
      clipTargetTitle: 'Add web clip to which note?',
      clipNewNote: 'Create new note',
      noNotesFound: 'No notes found',
      emptyNote: 'Empty note',
      activeNote: 'active note',
      webPage: 'Web page',
      import: 'Import',
      backup: 'Backup',
      importAll: 'All Files',
      importTxt: 'TXT / Markdown',
      importWord: 'Word (.docx)',
      importExcel: 'Excel / CSV',
      importPdf: 'PDF',
      importImage: 'Image (OCR)',
      exportJson: 'Export JSON',
      importJson: 'Import JSON',
      emailJsonBtn: 'Email JSON',
      exportSql: 'Export SQL',
      importSql: 'Import SQL',
      ocrPaddle: 'PaddleOCR (fast)',
      ocrTesseract: 'Tesseract (TR)',
      imageTools: 'Image Tools',
      selectImageHint: 'Click an image to edit',
      close: 'Close',
      size: 'Size',
      crop: 'Crop',
      cropMode: '✂ Crop Mode',
      apply: '✓ Apply',
      cancel: '✕ Cancel',
      lockAspect: 'Lock aspect ratio',
      wrapText: 'Text Wrap',
      wrapInline: 'Inline',
      wrapSquare: 'Square',
      wrapTight: 'Tight',
      wrapTopBottom: 'Top/Bottom',
      wrapBehind: 'Behind text',
      wrapFront: 'In front',
      position: 'Position',
      alignLeft: 'Left',
      alignCenter: 'Center',
      alignRight: 'Right',
      transform: 'Transform',
      rotateCCW: 'Rotate left 90°',
      rotateCW: 'Rotate right 90°',
      flipH: 'Flip horizontal',
      flipV: 'Flip vertical',
      rotate: 'Rotate',
      adjustments: 'Adjustments',
      brightness: 'Brightness',
      contrast: 'Contrast',
      saturate: 'Saturation',
      hue: 'Hue',
      blur: 'Blur',
      artisticFx: 'Artistic FX',
      grayscale: 'Grayscale',
      sepia: 'Sepia',
      invert: 'Invert',
      ocrButton: '🔍 Extract Text (OCR)',
      grabText: 'Grab Text',
      grabTextTip: 'Grab text from the image with Tesseract tur+eng',
      ocrResult: 'OCR Result',
      ocrPlaceholder: 'OCR result will appear here...',
      insertText: 'Insert Text',
      replace: 'Replace',
      reset: 'Reset',
      delete: 'Delete',
      rename: 'Rename',
      duplicate: 'Duplicate',
      cut: 'Cut',
      copy: 'Copy',
      paste: 'Paste',
      translateText: 'Translate',
      translating: 'Translating...',
      translateFailed: 'Translation failed.',
      selectLanguage: 'Select language:',
      pasteImage: 'Paste Image from Clipboard',
      uploadImage: 'Upload Image (from disk)',
      saveImage: 'Save Image',
      imageZoomOut: 'Image -',
      imageZoomIn: 'Image +',
      findReplace: 'Find & Replace',
      find: 'Find:',
      replaceWith: 'Replace with:',
      findNext: 'Find Next',
      findAll: 'Find All',
      replaceOne: 'Replace',
      replaceAll: 'Replace All',
      matchCase: 'Match Case',
      wholeWord: 'Whole Word',
      useRegex: 'Regular Expression (Regex)',
      saveTxt: 'Save as .txt',
      saveMd: 'Save as Markdown (.md)',
      savePdf: 'Save as PDF',
      saveWord: 'Save as Word',
      shareDevice: 'Share via device',
      shareWA: 'WhatsApp (text)',
      shareEmail: 'Email (text)',
      shareEmailPdf: 'Email + Download PDF',
      shareWAPdf: 'WhatsApp + Download PDF',
      zoom: 'Zoom',
      zoomIn: 'Zoom In',
      zoomOut: 'Zoom Out',
      pageSize: 'Page Size',
      pageFree: 'Free',
      orientation: 'Page Orientation',
      formatMarks: 'Formatting Marks',
      clearFormat: 'Clear Formatting',
      copyFormat: 'Copy Formatting',
      formatCopied: 'Format copied',
      newNoteTip: 'New Note (Ctrl+Alt+N)',
      openTip: 'Open (Ctrl+O)',
      saveTip: 'Save (Ctrl+S)',
      printTip: 'Print (Ctrl+P)',
      installPwa: 'Install App',
      findReplaceTip: 'Find & Replace (Ctrl+H)',
      insertImage: 'Insert Image',
      insertTextBox: 'Insert Text Box',
      insertShape: 'Insert Shape & Icon',
      insertLink: 'Insert Link',
      insertTable: 'Insert Table',
      calculator: 'Calculator',
      calendar: 'Calendar',
      insertSheet: 'Mini Sheet (Formulas)',
      orientationShort: 'Orient',
      findShort: 'Find',
      imageShort: 'Image',
      textBoxShort: 'Text',
      shapeShort: 'Shape',
      tableShort: 'Table',
      linkShort: 'Link',
      gridShort: 'Grid',
      calcShort: 'Calc',
      calShort: 'Cal',
      calToday: 'Today',
      calInsertDate: 'Insert Date',
      refreshShort: 'Refresh',
      sheetShort: 'Sheet',
      dateShort: 'Date',
      screenShort: 'Screen',
      noteColor: 'Color',
      noteGroup: 'Group',
      sendToGroup: 'Send to Group',
      copyText: 'Copy Note',
      selectAll: 'Select All',
      androidApp: 'Android App',
      androidAppTip: 'Download as Android app',
      chromeExtension: 'Chrome Extension',
      chromeExtensionTip: 'Download and unzip; in Chrome Extensions, choose Load unpacked and select the manifest.json folder.',
      bgImageSet: 'Set as Background',
      bgImageClear: 'Clear Background',
      bgImageFit: 'Fit',
      bgImageCover: 'Cover',
      linkUrl: 'URL',
      linkText: 'Display Text',
      linkDesc: 'Description',
      tableRows: 'Rows',
      tableCols: 'Cols',
      color: 'Color',
      fill: 'Fill',
      borderColor: 'Border',
      bgColor: 'Background',
      radius: 'Radius',
      insertDateTime: 'Insert Date/Time',
      fullscreen: 'Fullscreen',
      share: 'Share',
      deleteNote: 'Delete Note',
      words: 'Words',
      chars: 'Characters',
      saved: 'Saved',
      saving: 'Saving...',
      saveFailed: 'Save failed.',
      storageFull: 'Storage is full. Remove large images or export a backup.',
      about: 'About',
      rights: 'All rights reserved',
      otherTools: 'Other tools:',
      toolsSettings: 'Tools & Settings',
      moreTools: 'More tools → drtr.uk',
      refreshApp: 'Refresh',
      refreshTip: 'Clear this app’s cache and reload (notes are kept)',
      installApp: 'Install as App',
      installAppTip: 'Add to device as an app (PWA)',
      iosStep1: '1. Tap the Share icon in your browser',
      iosStep2: '2. Choose "Add to Home Screen" from the menu',
      iosStep3: '3. Tap Add — the app will appear on your home screen',
      gotIt: 'Got it',
      signInGoogle: 'Sign in with Google',
      signOut: 'Sign out',
      signedInAs: 'Signed in: ',
      syncIdle: 'Sync idle',
      syncing: 'Syncing...',
      syncOk: 'Synced',
      syncError: 'Sync error',
      cloudSetupNeeded: 'Google OAuth Client ID missing (cloud-config.js)',
      cloudSetupHelp: 'Google Drive sync needs an OAuth Client ID.\n\nSetup (app owner):\n1. console.cloud.google.com → new project\n2. Enable Google Drive API\n3. OAuth consent screen + scope: drive.appdata\n4. Credentials → OAuth client ID (Web)\n   - JS origins: https://not.drtr.uk\n   - Redirect URIs: https://not.drtr.uk/ (trailing slash)\n5. Paste the Client ID into js/cloud-config.js\n6. Reload\n\nFull steps at the top of cloud-config.js.',
      cloudConfirmSignOut: 'Sign out from your Google account? Local notes will be kept.',
      switchAccount: 'Switch account',
      cloudConfirmSwitch: 'Switch to a different Google account. No need to sign out first — the account chooser will open. Note: your local notes will sync with the selected account\'s Drive. Continue?',
      lastSync: 'Last sync: ',
      briefcase: 'Briefcase',
      briefcaseTip: 'Upload files here and download them on another device',
      briefcaseSignInNeeded: 'Sign in with Google to send and receive files. Your files are stored in your personal Google Drive account and appear on any other device signed into the same account.',
      briefcaseDropHint: 'Drag files here or',
      briefcaseChooseFile: 'Choose File',
      briefcaseEmpty: 'No files yet.',
      briefcaseUploading: 'Uploading: ',
      briefcaseUploadFailed: 'Upload failed: ',
      briefcaseTooLarge: 'File too large (100MB limit): ',
      briefcaseListFailed: 'Could not load file list.',
      briefcaseDeleteConfirm: 'Delete this file?',
      briefcaseDeleteFailed: 'Delete failed.',
      briefcaseDownloadFailed: 'Download failed.',
      briefcaseDownloading: 'Downloading: ',
      briefcaseParts: 'parts',
      briefcaseIncomplete: 'Missing parts — cannot download'
    }
  };

  function applyI18n(lang) {
    CURRENT_LANG = (I18N_TABLE[lang] ? lang : 'tr');
    const t = I18N_TABLE[CURRENT_LANG];
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      if (t[key] != null) el.textContent = t[key];
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.dataset.i18nTitle;
      if (t[key] != null) el.title = t[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.dataset.i18nPlaceholder;
      if (t[key] != null) el.placeholder = t[key];
    });
    document.documentElement.lang = CURRENT_LANG;
    // Refresh dynamic strings
    updateCounts();
    if (window.__npRefreshCloudUI) window.__npRefreshCloudUI();
    if (saveStatusEl && (saveStatusEl.textContent === 'Saved' || saveStatusEl.textContent === 'Kaydedildi' || saveStatusEl.textContent === 'Saving...' || saveStatusEl.textContent === 'Kaydediliyor...')) {
      saveStatusEl.textContent = t.saved;
    }
  }

  // Detect default language: saved → browser locale → tr
  const savedLang = localStorage.getItem('np_lang');
  const browserPrefersTr = (navigator.language || '').toLowerCase().startsWith('tr');
  const initialLang = savedLang || (browserPrefersTr ? 'tr' : 'en');
  const langSelect = $('#langSelect');
  if (langSelect) {
    langSelect.value = (I18N_TABLE[initialLang] ? initialLang : 'tr');
    langSelect.addEventListener('change', (e) => {
      localStorage.setItem('np_lang', e.target.value);
      applyI18n(e.target.value);
    });
  }
  applyI18n(initialLang);
  updateCounts();

  // ----- PWA install: Android (beforeinstallprompt) + iOS Safari (manual instructions) -----
  let deferredInstallEvent = null;
  const btnInstallPwa = $('#btnInstallPwa');           // toolbar icon (Android only)
  const btnInstallApp = $('#btnInstallApp');           // sidebar prominent button
  const installRow    = $('#installRow');
  const iosInstallDialog = $('#iosInstallDialog');

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  }
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }
  function isAndroid() {
    return /Android/i.test(navigator.userAgent);
  }

  function showInstallButtons() {
    if (isStandalone()) return; // already installed
    if (installRow) installRow.hidden = false;
    if (btnInstallPwa) btnInstallPwa.hidden = false;
  }
  function hideInstallButtons() {
    if (installRow) installRow.hidden = true;
    if (btnInstallPwa) btnInstallPwa.hidden = true;
  }

  // On iOS Safari there's no beforeinstallprompt — show button immediately so user can tap
  if (isIOS() && !isStandalone()) {
    showInstallButtons();
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallEvent = e;
    showInstallButtons();
  });

  async function triggerInstall() {
    if (isStandalone()) return;
    if (deferredInstallEvent) {
      // Android Chrome / Edge: native prompt
      try {
        deferredInstallEvent.prompt();
        await deferredInstallEvent.userChoice;
      } catch {}
      deferredInstallEvent = null;
      hideInstallButtons();
      return;
    }
    if (isIOS()) {
      // iOS Safari: show manual Add-to-Home-Screen instructions
      if (iosInstallDialog) iosInstallDialog.style.display = 'flex';
      return;
    }
    // Fallback: show iOS-style instructions for any browser without native prompt
    if (iosInstallDialog) iosInstallDialog.style.display = 'flex';
  }

  if (btnInstallPwa) btnInstallPwa.addEventListener('click', triggerInstall);
  if (btnInstallApp) btnInstallApp.addEventListener('click', triggerInstall);

  if (iosInstallDialog) {
    const closeIos = () => { iosInstallDialog.style.display = 'none'; };
    $('#iosInstallClose')?.addEventListener('click', closeIos);
    $('#iosInstallOk')?.addEventListener('click', closeIos);
    iosInstallDialog.addEventListener('click', (e) => {
      if (e.target === iosInstallDialog) closeIos();
    });
  }

  window.addEventListener('appinstalled', () => {
    hideInstallButtons();
    deferredInstallEvent = null;
  });

  // If launched standalone, hide install UI
  if (isStandalone()) hideInstallButtons();

  console.log('[init] app.js v28 fully initialized');
  window.__npDebug = {
    get selectedImg() { return selectedImg; },
    get cropMode() { return cropMode; },
    selOverlay, imagePanel, positionOverlay, selectImage, enterCropMode, applyCrop
  };
})();
