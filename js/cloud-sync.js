// Google Drive Cloud Sync (appDataFolder).
//
// Architecture:
//   - Auth: Google Identity Services (GIS) implicit token flow
//   - Storage: Drive REST v3, scope=drive.appdata (hidden per-app folder)
//   - Layout:
//       notes-index.json  → { version, lastSync, notes: [{id, updated, deleted, rev}] }
//       note-<id>.json    → full note object
//   - Sync: last-write-wins by `updated` timestamp
//   - Triggers: pull on token acquired, push on dirty (debounced), background pull every 60s
//
// Exposes window.__npCloud with:
//   init(), signIn(), signOut(), markDirty(noteId), syncNow(), isSignedIn(), getStatus()
//
// Depends on:
//   - window.NP_CLOUD_CONFIG (from cloud-config.js)
//   - app.js globals: window.__npNotes, window.__npSaveNotes, window.__npRenderNoteList,
//                     window.__npGetActiveId, window.__npLoadNote
//   - GIS loaded from https://accounts.google.com/gsi/client

(function () {
  'use strict';

  const CFG = window.NP_CLOUD_CONFIG || {};
  const LS_TOKEN = 'np_cloud_token';
  const LS_USER = 'np_cloud_user';
  const LS_LAST_SYNC = 'np_cloud_last_sync';

  // ---------- State ----------
  let tokenClient = null;
  let accessToken = null;
  let tokenExpiresAt = 0;
  let userInfo = null;
  let signedIn = false;
  let status = 'idle';      // idle | syncing | ok | error | setupNeeded
  let statusMsg = '';
  let dirtyIds = new Set();
  let pushTimer = null;
  let pullTimer = null;
  let initialized = false;
  let listeners = [];
  let inFlight = false;

  // ---------- Listeners ----------
  function emit() {
    for (const fn of listeners) {
      try { fn(getStatus()); } catch (e) { console.warn('[cloud] listener', e); }
    }
  }
  function onChange(fn) { listeners.push(fn); }

  function setStatus(s, msg) {
    status = s;
    statusMsg = msg || '';
    emit();
  }

  function getStatus() {
    return {
      signedIn,
      status,
      message: statusMsg,
      user: userInfo,
      lastSync: parseInt(localStorage.getItem(LS_LAST_SYNC) || '0', 10) || null,
    };
  }

  // ---------- Token persistence ----------
  function persistToken() {
    if (accessToken && tokenExpiresAt > Date.now()) {
      localStorage.setItem(LS_TOKEN, JSON.stringify({ t: accessToken, e: tokenExpiresAt }));
    } else {
      localStorage.removeItem(LS_TOKEN);
    }
  }

  function restoreToken() {
    try {
      const raw = localStorage.getItem(LS_TOKEN);
      if (!raw) return false;
      const { t, e } = JSON.parse(raw);
      if (!t || !e || e <= Date.now() + 60000) return false; // expired or expiring soon
      accessToken = t;
      tokenExpiresAt = e;
      return true;
    } catch { return false; }
  }

  function restoreUser() {
    try {
      const raw = localStorage.getItem(LS_USER);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  // ---------- GIS init ----------
  function ensureGISLoaded() {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        resolve();
        return;
      }
      let waited = 0;
      const poll = setInterval(() => {
        if (window.google && window.google.accounts && window.google.accounts.oauth2) {
          clearInterval(poll);
          resolve();
        } else if ((waited += 100) > 10000) {
          clearInterval(poll);
          reject(new Error('GIS client failed to load'));
        }
      }, 100);
    });
  }

  async function initTokenClient() {
    await ensureGISLoaded();
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CFG.GOOGLE_CLIENT_ID,
      scope: CFG.SCOPE,
      callback: (resp) => {
        if (resp.error) {
          console.error('[cloud] token error', resp);
          setStatus('error', resp.error_description || resp.error);
          signedIn = false;
          return;
        }
        accessToken = resp.access_token;
        tokenExpiresAt = Date.now() + (resp.expires_in - 60) * 1000;
        signedIn = true;
        persistToken();
        fetchUserInfo().then(() => {
          setStatus('syncing', 'Initial sync...');
          syncNow().catch((e) => setStatus('error', e.message));
        });
      },
    });
  }

  async function fetchUserInfo() {
    try {
      const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: 'Bearer ' + accessToken },
      });
      if (r.ok) {
        userInfo = await r.json();
        localStorage.setItem(LS_USER, JSON.stringify(userInfo));
      }
    } catch (e) { console.warn('[cloud] userinfo', e); }
  }

  // ---------- Sign in / out ----------
  async function signIn() {
    if (!CFG.GOOGLE_CLIENT_ID) {
      setStatus('setupNeeded', 'OAuth client ID not configured in cloud-config.js');
      return;
    }
    if (!tokenClient) await initTokenClient();
    // GIS prompts for consent on first call; silent thereafter
    tokenClient.requestAccessToken({ prompt: signedIn ? '' : 'consent' });
  }

  async function signOut() {
    if (accessToken && window.google && google.accounts && google.accounts.oauth2) {
      try { google.accounts.oauth2.revoke(accessToken, () => {}); } catch (_) {}
    }
    accessToken = null;
    tokenExpiresAt = 0;
    signedIn = false;
    userInfo = null;
    dirtyIds.clear();
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_USER);
    clearTimeout(pushTimer);
    clearInterval(pullTimer);
    pullTimer = null;
    setStatus('idle', '');
  }

  // ---------- Drive REST ----------
  async function driveFetch(path, init) {
    if (!accessToken) throw new Error('No access token');
    if (tokenExpiresAt && tokenExpiresAt <= Date.now()) {
      // Silent refresh
      await new Promise((resolve, reject) => {
        const prev = tokenClient.callback;
        tokenClient.callback = (resp) => {
          tokenClient.callback = prev;
          if (resp.error) { reject(new Error(resp.error)); return; }
          accessToken = resp.access_token;
          tokenExpiresAt = Date.now() + (resp.expires_in - 60) * 1000;
          persistToken();
          resolve();
        };
        tokenClient.requestAccessToken({ prompt: '' });
      });
    }
    const opts = init || {};
    opts.headers = Object.assign({}, opts.headers || {}, {
      Authorization: 'Bearer ' + accessToken,
    });
    const url = path.startsWith('http') ? path : (CFG.DRIVE_API + path);
    const r = await fetch(url, opts);
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      throw new Error(`Drive ${r.status}: ${errText.slice(0, 200)}`);
    }
    return r;
  }

  async function listAppData() {
    const r = await driveFetch('/files?spaces=appDataFolder&fields=files(id,name,modifiedTime,size)&pageSize=1000');
    const data = await r.json();
    return data.files || [];
  }

  async function downloadJson(fileId) {
    const r = await driveFetch(`/files/${fileId}?alt=media`);
    return await r.json();
  }

  async function uploadJson(name, json, existingFileId) {
    const meta = existingFileId
      ? { name }
      : { name, parents: ['appDataFolder'], mimeType: 'application/json' };
    const boundary = '-------NPCloud' + Math.random().toString(36).slice(2);
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(meta) + `\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      JSON.stringify(json) + `\r\n` +
      `--${boundary}--`;
    const path = existingFileId
      ? `${CFG.DRIVE_UPLOAD}/files/${existingFileId}?uploadType=multipart`
      : `${CFG.DRIVE_UPLOAD}/files?uploadType=multipart`;
    const r = await driveFetch(path, {
      method: existingFileId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return await r.json();
  }

  async function deleteFile(fileId) {
    try {
      await driveFetch(`/files/${fileId}`, { method: 'DELETE' });
    } catch (e) { console.warn('[cloud] delete failed', fileId, e); }
  }

  // ---------- Sync ----------
  function notesArr() { return window.__npNotes || []; }

  function findFile(files, name) { return files.find((f) => f.name === name); }

  async function pull() {
    const files = await listAppData();
    const indexFile = findFile(files, 'notes-index.json');
    if (!indexFile) return { pulled: 0 }; // first sync, nothing remote
    const remoteIndex = await downloadJson(indexFile.id);
    const remoteNotes = remoteIndex.notes || [];
    const local = notesArr();
    const localById = new Map(local.map((n) => [n.id, n]));
    const fileById = new Map(files.map((f) => [f.name, f]));
    let pulled = 0;
    for (const r of remoteNotes) {
      const loc = localById.get(r.id);
      const remoteNewer = !loc || (r.updated || 0) > (loc.updated || 0);
      if (!remoteNewer) continue;
      // Handle soft delete cheaply
      if (r.deleted) {
        if (loc) {
          loc.deleted = r.deleted;
          loc.updated = r.updated;
        }
        pulled++;
        continue;
      }
      const noteFile = fileById.get(`note-${r.id}.json`);
      if (!noteFile) continue;
      try {
        const fullNote = await downloadJson(noteFile.id);
        fullNote.rev = noteFile.id;
        const idx = local.findIndex((n) => n.id === fullNote.id);
        if (idx >= 0) local[idx] = fullNote;
        else local.unshift(fullNote);
        pulled++;
      } catch (e) {
        console.warn('[cloud] pull note failed', r.id, e);
      }
    }
    if (pulled > 0) {
      // commit changes back into app state
      window.__npNotes = local;
      window.__npSaveNotes && window.__npSaveNotes();
      window.__npRenderNoteList && window.__npRenderNoteList();
      // Refresh active note in editor if it was changed remotely
      const activeId = window.__npGetActiveId && window.__npGetActiveId();
      if (activeId && remoteNotes.some((r) => r.id === activeId)) {
        window.__npLoadNote && window.__npLoadNote(activeId);
      }
    }
    return { pulled };
  }

  async function push() {
    const files = await listAppData();
    const indexFile = findFile(files, 'notes-index.json');
    const remoteIndex = indexFile ? await downloadJson(indexFile.id) : { version: 1, notes: [] };
    const remoteMap = new Map((remoteIndex.notes || []).map((r) => [r.id, r]));
    const fileMap = new Map(files.map((f) => [f.name, f]));
    const local = notesArr();
    let pushed = 0;
    for (const note of local) {
      const r = remoteMap.get(note.id);
      const localNewer = !r || (note.updated || 0) > (r.updated || 0);
      if (!localNewer) continue;
      // Size guard
      const payload = JSON.stringify(note);
      if (payload.length > CFG.MAX_NOTE_BYTES) {
        console.warn('[cloud] note too large, skipping', note.id, payload.length);
        continue;
      }
      const fname = `note-${note.id}.json`;
      const existing = fileMap.get(fname);
      try {
        const uploaded = await uploadJson(fname, note, existing ? existing.id : null);
        note.rev = uploaded.id;
        remoteMap.set(note.id, {
          id: note.id,
          updated: note.updated,
          deleted: note.deleted || null,
          rev: uploaded.id,
        });
        pushed++;
      } catch (e) {
        console.warn('[cloud] push note failed', note.id, e);
      }
    }
    // Always rebuild + push index
    const newIndex = {
      version: 1,
      lastSync: Date.now(),
      notes: Array.from(remoteMap.values()),
    };
    try {
      await uploadJson('notes-index.json', newIndex, indexFile ? indexFile.id : null);
    } catch (e) {
      console.warn('[cloud] push index failed', e);
    }
    // Persist rev IDs to local
    window.__npSaveNotes && window.__npSaveNotes();
    return { pushed };
  }

  async function syncNow() {
    if (!signedIn) return;
    if (inFlight) return;
    inFlight = true;
    setStatus('syncing', '');
    try {
      const p1 = await pull();
      const p2 = await push();
      dirtyIds.clear();
      localStorage.setItem(LS_LAST_SYNC, String(Date.now()));
      setStatus('ok', `Pulled ${p1.pulled}, pushed ${p2.pushed}`);
    } catch (e) {
      console.error('[cloud] sync error', e);
      setStatus('error', e.message);
    } finally {
      inFlight = false;
    }
  }

  function markDirty(noteId) {
    if (!signedIn) return;
    if (noteId) dirtyIds.add(noteId);
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      syncNow().catch((e) => console.warn('[cloud] debounced sync', e));
    }, CFG.PUSH_DEBOUNCE_MS);
  }

  function startBackgroundPull() {
    clearInterval(pullTimer);
    pullTimer = setInterval(() => {
      if (!signedIn || !navigator.onLine || inFlight) return;
      syncNow().catch((e) => console.warn('[cloud] bg pull', e));
    }, CFG.PULL_INTERVAL_MS);
  }

  // ---------- Init ----------
  async function init() {
    if (initialized) return;
    initialized = true;
    userInfo = restoreUser();
    if (!CFG.GOOGLE_CLIENT_ID) {
      setStatus('setupNeeded', 'OAuth client ID not configured');
      return;
    }
    try {
      await initTokenClient();
    } catch (e) {
      setStatus('error', e.message);
      return;
    }
    // Try silent restore
    if (restoreToken()) {
      signedIn = true;
      setStatus('ok', '');
      // Try refresh silently to verify token still valid
      try {
        await driveFetch('/about?fields=user');
        setStatus('syncing', '');
        await syncNow();
        startBackgroundPull();
      } catch (e) {
        // Token revoked / invalid → require re-sign-in
        accessToken = null;
        tokenExpiresAt = 0;
        signedIn = false;
        localStorage.removeItem(LS_TOKEN);
        setStatus('idle', 'Re-sign-in required');
      }
    }
    window.addEventListener('online', () => { if (signedIn) syncNow(); });
  }

  // Public API
  window.__npCloud = {
    init,
    signIn,
    signOut,
    syncNow,
    markDirty,
    isSignedIn: () => signedIn,
    getStatus,
    onChange,
  };
})();
