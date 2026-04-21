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
  function createNote() {
    const note = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: '',
      content: '',
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
    insertImage: () => $('#imageInput').click(),
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
    const dd = $('#saveDropdown');
    dd.classList.toggle('open');
  }

  function closeSaveDropdown() {
    $('#saveDropdown').classList.remove('open');
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
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(img);
      range.setStartAfter(img);
      range.setEndAfter(img);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      editor.appendChild(img);
    }
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

  // Open file
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      createNote();
      const note = getActiveNote();
      note.title = file.name.replace(/\.[^.]+$/, '');
      noteTitle.value = note.title;
      if (file.name.endsWith('.html')) {
        // Sanitize: parse and strip scripts/event handlers
        const parser = new DOMParser();
        const doc = parser.parseFromString(ev.target.result, 'text/html');
        doc.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(el => el.remove());
        doc.querySelectorAll('*').forEach(el => {
          [...el.attributes].forEach(a => {
            if (a.name.startsWith('on') || /^(href|src)$/i.test(a.name) && /^javascript:/i.test(a.value)) {
              el.removeAttribute(a.name);
            }
          });
        });
        editor.innerHTML = doc.body.innerHTML;
      } else {
        editor.innerText = ev.target.result;
      }
      note.content = editor.innerHTML;
      saveNotes();
      renderNoteList();
      updateCounts();
    };
    reader.readAsText(file);
    fileInput.value = '';
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
  loadNotes();

  // --- Image Editor ---
  let selectedImg = null;
  const imagePanel = $('#imagePanel');

  const defaultImgState = () => ({
    filters: { brightness: 1, contrast: 1, saturate: 1, 'hue-rotate': 0, blur: 0, grayscale: 0, sepia: 0, invert: 0 },
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    xform: { rotate: 0, flipH: false, flipV: false },
    size: { width: 100 }
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

    img.style.width = state.size.width + '%';
    img.style.maxWidth = '100%';

    img.dataset.editState = JSON.stringify(state);
  }

  function selectImage(img) {
    if (selectedImg) selectedImg.classList.remove('img-selected');
    selectedImg = img;
    img.classList.add('img-selected');
    imagePanel.hidden = false;
    syncPanelToImage(img);
  }

  function deselectImage() {
    if (selectedImg) selectedImg.classList.remove('img-selected');
    selectedImg = null;
    imagePanel.hidden = true;
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
    imagePanel.querySelectorAll('input[data-size]').forEach(inp => {
      inp.value = state.size[inp.dataset.size];
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

  // Click image in editor → select
  editor.addEventListener('click', (e) => {
    if (e.target.tagName === 'IMG') {
      e.preventDefault();
      selectImage(e.target);
    } else if (selectedImg) {
      deselectImage();
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
    else if (inp.dataset.size) state.size[inp.dataset.size] = parseFloat(inp.value);
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

  $('#closeImagePanel').addEventListener('click', deselectImage);

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
    const files = [...e.target.files].filter(f => f.type.startsWith('image/'));
    editor.focus();
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        insertImage(ev.target.result);
        scheduleSave();
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  });

  // Handle PWA shortcut ?action=new
  if (new URLSearchParams(location.search).get('action') === 'new') {
    createNote();
    history.replaceState(null, '', location.pathname);
  }
})();
