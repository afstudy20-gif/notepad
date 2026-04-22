(() => {
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

  // --- Storage ---
  function loadNotes() {
    try {
      notes = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      notes = [];
    }
    activeId = localStorage.getItem(ACTIVE_KEY);
    if (notes.length === 0) {
      createNote();
    } else {
      const found = notes.find(n => n.id === activeId);
      if (!found) activeId = notes[0].id;
      renderNoteList();
      loadNote(activeId);
    }
  }

  function saveNotes() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    localStorage.setItem(ACTIVE_KEY, activeId);
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
    const note = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: '',
      content: '',
      pageSize: 'free',
      pageOrientation: 'portrait',
      updated: Date.now()
    };
    notes.unshift(note);
    activeId = note.id;
    saveNotes();
    renderNoteList();
    loadNote(note.id);
    noteTitle.focus();
  }

  function deleteNote(id) {
    if (notes.length <= 1) {
      notes = [];
      createNote();
      return;
    }
    notes = notes.filter(n => n.id !== id);
    if (activeId === id) {
      activeId = notes[0].id;
      loadNote(activeId);
    }
    saveNotes();
    renderNoteList();
  }

  function loadNote(id) {
    const note = notes.find(n => n.id === id);
    if (!note) return;
    activeId = id;
    noteTitle.value = note.title;
    editor.innerHTML = note.content;
    updateCounts();
    renderNoteList();
    localStorage.setItem(ACTIVE_KEY, activeId);
    if (typeof deselectImage === 'function') deselectImage();
    applyPageLayout(note);
    syncPageControls(note);
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

  function autoSave() {
    const note = getActiveNote();
    if (!note) return;
    note.title = noteTitle.value;
    note.content = editor.innerHTML;
    note.updated = Date.now();

    // Move to top
    notes = notes.filter(n => n.id !== note.id);
    notes.unshift(note);

    saveNotes();
    renderNoteList();
    saveStatusEl.textContent = 'Saved';
  }

  function scheduleSave() {
    saveStatusEl.textContent = 'Saving...';
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(autoSave, 500);
  }

  // --- Render ---
  function renderNoteList() {
    const query = searchInput.value.toLowerCase();
    const filtered = query
      ? notes.filter(n =>
          n.title.toLowerCase().includes(query) ||
          stripHtml(n.content).toLowerCase().includes(query)
        )
      : notes;

    noteList.innerHTML = filtered.map(n => {
      const preview = stripHtml(n.content).slice(0, 80) || 'Empty note';
      const title = n.title || 'Untitled Note';
      const time = formatTime(n.updated);
      return `
        <div class="note-item ${n.id === activeId ? 'active' : ''}" data-id="${n.id}">
          <div class="note-item-title">${escapeHtml(title)}</div>
          <div class="note-item-preview">${escapeHtml(preview)}</div>
          <div class="note-item-time">${time}</div>
        </div>`;
    }).join('');

    noteList.querySelectorAll('.note-item').forEach(el => {
      el.addEventListener('click', () => loadNote(el.dataset.id));
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
    return div.innerHTML;
  }

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
    wordCountEl.textContent = `Words: ${words}`;
    charCountEl.textContent = `Characters: ${chars}`;
  }

  // --- Toolbar Actions ---
  function execCmd(cmd, value) {
    document.execCommand(cmd, false, value || null);
    editor.focus();
  }

  const toolbarActions = {
    new: () => createNote(),
    open: () => fileInput.click(),
    toggleSaveMenu: () => toggleSaveDropdown(),
    saveTxt: () => { closeSaveDropdown(); downloadNote(); },
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
    bold: () => execCmd('bold'),
    italic: () => execCmd('italic'),
    underline: () => execCmd('underline'),
    strikeThrough: () => execCmd('strikeThrough'),
    justifyLeft: () => execCmd('justifyLeft'),
    justifyCenter: () => execCmd('justifyCenter'),
    justifyRight: () => execCmd('justifyRight'),
    insertOrderedList: () => execCmd('insertOrderedList'),
    insertUnorderedList: () => execCmd('insertUnorderedList'),
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

  // Paste as plain text only (like a real notepad)
  editor.addEventListener('paste', (e) => {
    const cd = e.clipboardData || window.clipboardData;
    if (!cd) return;
    // Check for images in clipboard
    for (const item of cd.items || []) {
      if (item.type && item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          insertImage(ev.target.result);
          scheduleSave();
        };
        reader.readAsDataURL(file);
        return;
      }
    }
    // Fallback: plain text paste
    e.preventDefault();
    const text = cd.getData('text/plain');
    document.execCommand('insertText', false, text);
  });

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
    img.scrollIntoView({ block: 'nearest' });
  }

  // Drag & drop image files into editor
  editor.addEventListener('dragover', (e) => {
    if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
      e.preventDefault();
    }
  });
  editor.addEventListener('drop', (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    const imgs = [...files].filter(f => f.type.startsWith('image/'));
    if (!imgs.length) return;
    e.preventDefault();
    imgs.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        insertImage(ev.target.result);
        scheduleSave();
      };
      reader.readAsDataURL(file);
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

  // --- Find & Replace ---
  function toggleFindReplace() {
    const dialog = $('#findReplaceDialog');
    dialog.style.display = dialog.style.display === 'none' ? 'flex' : 'none';
    if (dialog.style.display === 'flex') {
      $('#findInput').focus();
    }
  }

  function findNext() {
    const text = $('#findInput').value;
    if (!text) return;
    window.find(text, false, false, true);
  }

  function replaceText() {
    const findText = $('#findInput').value;
    const replaceWith = $('#replaceInput').value;
    if (!findText) return;
    if (window.find(findText)) {
      document.execCommand('insertText', false, replaceWith);
    }
  }

  function replaceAll() {
    const findText = $('#findInput').value;
    const replaceWith = $('#replaceInput').value;
    if (!findText) return;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    const needle = findText.toLowerCase();
    let count = 0;
    for (const n of nodes) {
      const hay = n.nodeValue;
      const lower = hay.toLowerCase();
      if (!lower.includes(needle)) continue;
      let out = '';
      let i = 0;
      while (i < hay.length) {
        if (lower.slice(i, i + needle.length) === needle) {
          out += replaceWith;
          i += needle.length;
          count++;
        } else {
          out += hay[i++];
        }
      }
      n.nodeValue = out;
    }
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

  // Font selects
  $('#fontFamily').addEventListener('change', (e) => {
    execCmd('fontName', e.target.value);
  });
  $('#fontSize').addEventListener('change', (e) => {
    execCmd('fontSize', e.target.value);
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

  // Create note
  $('#btnCreate').addEventListener('click', createNote);

  // Note context menu (right-click on note item)
  const ctxMenu = $('#noteContextMenu');
  let ctxTargetId = null;

  noteList.addEventListener('contextmenu', (e) => {
    const item = e.target.closest('.note-item');
    if (!item) return;
    e.preventDefault();
    ctxTargetId = item.dataset.id;
    ctxMenu.hidden = false;
    const vw = window.innerWidth, vh = window.innerHeight;
    const mw = 180, mh = 130;
    ctxMenu.style.left = Math.min(e.clientX, vw - mw) + 'px';
    ctxMenu.style.top = Math.min(e.clientY, vh - mh) + 'px';
  });

  ctxMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-ctx]');
    if (!btn || !ctxTargetId) return;
    const action = btn.dataset.ctx;
    const note = notes.find(n => n.id === ctxTargetId);
    ctxMenu.hidden = true;
    if (!note) return;
    if (action === 'rename') {
      const name = prompt('Yeni ad:', note.title || 'Untitled Note');
      if (name === null) return;
      note.title = name.trim();
      if (activeId === note.id) noteTitle.value = note.title;
      saveNotes();
      renderNoteList();
    } else if (action === 'duplicate') {
      const copy = {
        ...note,
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        title: (note.title || 'Untitled') + ' (kopya)',
        updated: Date.now()
      };
      notes.unshift(copy);
      activeId = copy.id;
      saveNotes();
      renderNoteList();
      loadNote(copy.id);
    } else if (action === 'delete') {
      if (confirm(`"${note.title || 'Untitled Note'}" silinsin mi?`)) {
        deleteNote(note.id);
      }
    }
    ctxTargetId = null;
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
  let savedRange = null;

  function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      savedRange = sel.getRangeAt(0).cloneRange();
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

  document.addEventListener('contextmenu', (e) => {
    const inEditor = e.target === editor || (editor.contains && editor.contains(e.target));
    console.log('[editorCtx] contextmenu target=', e.target, 'inEditor=', inEditor);
    if (!inEditor) return;
    e.preventDefault();
    e.stopPropagation();
    saveSelection();
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
      } else if (action === 'paste') {
        if (navigator.clipboard && navigator.clipboard.readText) {
          const txt = await navigator.clipboard.readText();
          document.execCommand('insertText', false, txt);
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
          const reader = new FileReader();
          reader.onload = (ev) => { insertImage(ev.target.result); scheduleSave(); };
          reader.readAsDataURL(blob);
          found = true;
          break;
        }
        if (!found) alert('Panoda resim bulunamadı.');
      } else if (action === 'uploadImage') {
        const inp = $('#imageInput');
        if (inp) { inp.value = ''; inp.click(); }
      }
    } catch (err) {
      console.error('[editorCtx]', err);
      alert('İşlem başarısız: ' + err.message);
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#editorContextMenu')) editorCtx.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') editorCtx.hidden = true;
  });
  window.addEventListener('blur', () => editorCtx.hidden = true);

  // Delete note
  $('#btnDelete').addEventListener('click', () => {
    if (confirm('Delete this note?')) {
      deleteNote(activeId);
    }
  });

  // Find & Replace
  $('#closeFindReplace').addEventListener('click', toggleFindReplace);
  $('#btnFindNext').addEventListener('click', findNext);
  $('#btnReplace').addEventListener('click', replaceText);
  $('#btnReplaceAll').addEventListener('click', replaceAll);

  // --- Multi-format Importer ---
  const CDN = {
    mammoth: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js',
    xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs',
    pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs',
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
    doc.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(el => el.remove());
    doc.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(a => {
        if (a.name.startsWith('on')) el.removeAttribute(a.name);
        if (/^(href|src)$/i.test(a.name) && /^javascript:/i.test(a.value)) el.removeAttribute(a.name);
      });
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

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    fileInput.value = '';
    if (file) await importFile(file);
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
      }
    }
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      createNote();
    }
    // Escape closes find dialog
    if (e.key === 'Escape') {
      const dlg = $('#findReplaceDialog');
      if (dlg.style.display === 'flex') toggleFindReplace();
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

  // Sidebar toggle (mobile)
  $('#sidebarToggle').addEventListener('click', () => {
    $('#sidebar').classList.toggle('open');
  });

  // Close sidebar when note clicked on mobile
  noteList.addEventListener('click', () => {
    if (window.innerWidth <= 768) $('#sidebar').classList.remove('open');
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
          if (!n.id || !existingIds.has(n.id)) notes.push(n);
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

  // Click outside dialog to close
  $('#findReplaceDialog').addEventListener('click', (e) => {
    if (e.target === $('#findReplaceDialog')) {
      toggleFindReplace();
    }
  });

  // --- Init ---
  // --- Image Editor state (must be declared before loadNotes → loadNote → deselectImage) ---
  let selectedImg = null;

  document.body.classList.add('has-image-panel');
  loadNotes();

  // --- Image Editor ---
  const imagePanel = $('#imagePanel');

  const defaultImgState = () => ({
    filters: { brightness: 1, contrast: 1, saturate: 1, 'hue-rotate': 0, blur: 0, grayscale: 0, sepia: 0, invert: 0 },
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    xform: { rotate: 0, flipH: false, flipV: false }
  });

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

    img.dataset.editState = JSON.stringify(state);
  }

  // --- Resize overlay ---
  const selOverlay = document.createElement('div');
  selOverlay.className = 'img-sel-overlay';
  selOverlay.hidden = true;
  selOverlay.innerHTML = ['nw','ne','sw','se'].map(p =>
    `<div class="img-handle h-${p}" data-handle="${p}"></div>`
  ).join('');
  document.body.appendChild(selOverlay);

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
  }

  window.addEventListener('scroll', positionOverlay, true);
  window.addEventListener('resize', positionOverlay);
  // Refresh overlay after drop/drag
  editor.addEventListener('dragend', () => setTimeout(positionOverlay, 50));
  editor.addEventListener('drop', () => setTimeout(positionOverlay, 50));

  selOverlay.addEventListener('pointerdown', (e) => {
    const h = e.target.dataset.handle;
    if (!h || !selectedImg) return;
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const startW = selectedImg.offsetWidth;
    const startH = selectedImg.offsetHeight;
    const aspect = startW / Math.max(1, startH);
    const leftHandle = h.includes('w');
    const onMove = (ev) => {
      let dx = ev.clientX - startX;
      if (leftHandle) dx = -dx;
      const newW = Math.max(24, startW + dx);
      selectedImg.style.width = newW + 'px';
      selectedImg.style.height = (newW / aspect) + 'px';
      positionOverlay();
      updatePanelPreview();
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      scheduleSave();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });

  function updatePanelPreview() {
    if (!selectedImg) return;
    const prev = $('#ipPreview');
    const info = $('#ipInfo');
    if (prev) prev.src = selectedImg.src;
    if (info) {
      const w = selectedImg.offsetWidth | 0;
      const h = selectedImg.offsetHeight | 0;
      const nw = selectedImg.naturalWidth | 0;
      const nh = selectedImg.naturalHeight | 0;
      info.textContent = `${w}×${h}px (orjinal ${nw}×${nh})`;
    }
  }

  function selectImage(img) {
    if (selectedImg) selectedImg.classList.remove('img-selected');
    selectedImg = img;
    img.classList.add('img-selected');
    $('#imagePanelEmpty').hidden = true;
    $('#imagePanelBody').hidden = false;
    syncPanelToImage(img);
    positionOverlay();
    updatePanelPreview();
  }

  function deselectImage() {
    if (selectedImg) selectedImg.classList.remove('img-selected');
    selectedImg = null;
    $('#imagePanelEmpty').hidden = false;
    $('#imagePanelBody').hidden = true;
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
    if (img) {
      selectImage(img);
      return;
    }
    if (e.target.closest('.img-sel-overlay')) return;
    if (!selectedImg) return;
    if (e.target.closest('.image-panel')) return;
    if (e.target.closest('.toolbar')) return;
    deselectImage();
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
    if (!selectedImg || e.target.tagName !== 'INPUT') return;
    const inp = e.target;
    const state = getImgState(selectedImg);
    if (inp.dataset.filter) state.filters[inp.dataset.filter] = parseFloat(inp.value);
    else if (inp.dataset.crop) state.crop[inp.dataset.crop] = parseFloat(inp.value);
    else if (inp.dataset.xform) state.xform[inp.dataset.xform] = parseFloat(inp.value);
    applyImgState(selectedImg, state);
    updateValDisplay(inp);
    scheduleSave();
  });

  // Flip buttons
  imagePanel.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-xform-btn]');
    if (!btn || !selectedImg) return;
    const state = getImgState(selectedImg);
    const key = btn.dataset.xformBtn;
    state.xform[key] = !state.xform[key];
    applyImgState(selectedImg, state);
    scheduleSave();
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

  $('#imageReplaceInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file || !selectedImg) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      selectedImg.src = ev.target.result;
      scheduleSave();
    };
    reader.readAsDataURL(file);
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
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          insertImage(ev.target.result);
        } catch (err) {
          console.error('[insertImage] insert failed', err);
          alert('Resim eklenemedi: ' + err.message);
        }
        remaining--;
        if (remaining === 0) {
          updateCounts();
          scheduleSave();
        }
      };
      reader.onerror = () => {
        alert('Resim yüklenemedi: ' + file.name);
        remaining--;
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  });

  // Sidebar "Dosya İçe Aktar" triggers main file picker
  const btnImportFile = $('#btnImportFile');
  if (btnImportFile) {
    btnImportFile.addEventListener('click', () => fileInput.click());
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

  // Handle PWA shortcut ?action=new
  if (new URLSearchParams(location.search).get('action') === 'new') {
    createNote();
    history.replaceState(null, '', location.pathname);
  }
})();
