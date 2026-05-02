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
    saveStatusEl.textContent = (typeof tr === 'function') ? tr('saved') : 'Saved';
  }

  function scheduleSave() {
    saveStatusEl.textContent = (typeof tr === 'function') ? tr('saving') : 'Saving...';
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

  const toolbarActions = {
    new: () => createNote(),
    open: () => openFilePicker(),
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
    // If right-click landed on an image, select it so tools/handles appear
    const img = e.target.closest && e.target.closest('#editor img');
    if (img && typeof selectImage === 'function') {
      try { selectImage(img); } catch (err) { console.error('[editorCtx] selectImage failed', err); }
    }
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
          if (!n.id) n.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          if (!existingIds.has(n.id)) { notes.push(n); added++; }
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

  // Click outside dialog to close
  $('#findReplaceDialog').addEventListener('click', (e) => {
    if (e.target === $('#findReplaceDialog')) {
      toggleFindReplace();
    }
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

  loadNotes();

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

  // Handle PWA shortcut ?action=new
  if (new URLSearchParams(location.search).get('action') === 'new') {
    createNote();
    history.replaceState(null, '', location.pathname);
  }

  // ----- i18n table (assigned to early-declared I18N_TABLE) -----
  I18N_TABLE = {
    tr: {
      notes: 'Notlar',
      privacy: 'Yerel — sunucuya yüklenmez',
      privacyTooltip: 'Tüm notlar tarayıcınızda yerel olarak saklanır. Hiçbir şey yüklenmez.',
      newNote: 'Yeni Not',
      searchNotes: 'Notlarda ara...',
      untitled: 'İsimsiz Not',
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
      ocrResult: 'OCR Sonucu',
      ocrPlaceholder: 'OCR sonucu burada görünecek...',
      insertText: 'Metni Ekle',
      replace: 'Değiştir',
      reset: 'Sıfırla',
      delete: 'Sil',
      rename: 'Adını Değiştir',
      duplicate: 'Kopyala',
      cut: 'Kes',
      copy: 'Kopyala',
      paste: 'Yapıştır',
      pasteImage: 'Panodan Resim Yapıştır',
      uploadImage: 'Resim Yükle (Diskten)',
      findReplace: 'Bul ve Değiştir',
      find: 'Bul:',
      replaceWith: 'Şununla değiştir:',
      findNext: 'Sonrakini Bul',
      replaceOne: 'Değiştir',
      replaceAll: 'Tümünü Değiştir',
      saveTxt: '.txt olarak kaydet',
      savePdf: 'PDF olarak kaydet',
      saveWord: 'Word olarak kaydet',
      shareDevice: 'Cihazdan Paylaş (dosya)',
      shareWA: 'WhatsApp (metin)',
      shareEmail: 'E-posta (metin)',
      shareEmailPdf: 'E-posta + PDF indir',
      shareWAPdf: 'WhatsApp + PDF indir',
      pageSize: 'Sayfa Boyutu',
      pageFree: 'Serbest',
      orientation: 'Sayfa Yönü',
      newNoteTip: 'Yeni Not (Ctrl+Alt+N)',
      openTip: 'Aç (Ctrl+O)',
      saveTip: 'Kaydet (Ctrl+S)',
      printTip: 'Yazdır (Ctrl+P)',
      installPwa: 'Uygulamayı Yükle',
      findReplaceTip: 'Bul ve Değiştir (Ctrl+H)',
      insertImage: 'Resim Ekle',
      insertDateTime: 'Tarih/Saat Ekle',
      fullscreen: 'Tam Ekran',
      share: 'Paylaş',
      deleteNote: 'Notu Sil',
      words: 'Kelime',
      chars: 'Karakter',
      saved: 'Kaydedildi',
      saving: 'Kaydediliyor...',
      about: 'Hakkında',
      rights: 'Tüm hakları saklıdır',
      otherTools: 'Diğer araçlar:',
      moreTools: 'Daha fazla araç → drtr.uk',
      refreshApp: 'Güncelle',
      refreshTip: 'Bu uygulamanın önbelleğini temizle ve yenile (notlar korunur)'
    },
    en: {
      notes: 'Notes',
      privacy: 'Local only — no server',
      privacyTooltip: 'All notes are stored locally in your browser. Nothing is uploaded.',
      newNote: 'New Note',
      searchNotes: 'Search notes...',
      untitled: 'Untitled Note',
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
      pasteImage: 'Paste Image from Clipboard',
      uploadImage: 'Upload Image (from disk)',
      findReplace: 'Find & Replace',
      find: 'Find:',
      replaceWith: 'Replace with:',
      findNext: 'Find Next',
      replaceOne: 'Replace',
      replaceAll: 'Replace All',
      saveTxt: 'Save as .txt',
      savePdf: 'Save as PDF',
      saveWord: 'Save as Word',
      shareDevice: 'Share via device',
      shareWA: 'WhatsApp (text)',
      shareEmail: 'Email (text)',
      shareEmailPdf: 'Email + Download PDF',
      shareWAPdf: 'WhatsApp + Download PDF',
      pageSize: 'Page Size',
      pageFree: 'Free',
      orientation: 'Page Orientation',
      newNoteTip: 'New Note (Ctrl+Alt+N)',
      openTip: 'Open (Ctrl+O)',
      saveTip: 'Save (Ctrl+S)',
      printTip: 'Print (Ctrl+P)',
      installPwa: 'Install App',
      findReplaceTip: 'Find & Replace (Ctrl+H)',
      insertImage: 'Insert Image',
      insertDateTime: 'Insert Date/Time',
      fullscreen: 'Fullscreen',
      share: 'Share',
      deleteNote: 'Delete Note',
      words: 'Words',
      chars: 'Characters',
      saved: 'Saved',
      saving: 'Saving...',
      about: 'About',
      rights: 'All rights reserved',
      otherTools: 'Other tools:',
      moreTools: 'More tools → drtr.uk',
      refreshApp: 'Refresh',
      refreshTip: 'Clear this app’s cache and reload (notes are kept)'
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

  // ----- PWA install prompt -----
  let deferredInstallEvent = null;
  const btnInstallPwa = $('#btnInstallPwa');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallEvent = e;
    if (btnInstallPwa) btnInstallPwa.hidden = false;
  });
  if (btnInstallPwa) {
    btnInstallPwa.addEventListener('click', async () => {
      if (!deferredInstallEvent) return;
      deferredInstallEvent.prompt();
      try { await deferredInstallEvent.userChoice; } catch {}
      deferredInstallEvent = null;
      btnInstallPwa.hidden = true;
    });
  }
  window.addEventListener('appinstalled', () => {
    if (btnInstallPwa) btnInstallPwa.hidden = true;
  });

  console.log('[init] app.js v28 fully initialized');
  window.__npDebug = {
    get selectedImg() { return selectedImg; },
    get cropMode() { return cropMode; },
    selOverlay, imagePanel, positionOverlay, selectImage, enterCropMode, applyCrop
  };
})();
