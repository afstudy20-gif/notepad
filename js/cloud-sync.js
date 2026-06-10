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
  const LS_MODE = 'np_cloud_mode';     // 'popup' | 'redirect'
  const SS_STATE = 'np_oauth_state';   // CSRF state (sessionStorage)
  const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

  // ---------- State ----------
  let tokenClient = null;
  let accessToken = null;
  let tokenExpiresAt = 0;
  let userInfo = null;
  let signedIn = false;
  let authMode = localStorage.getItem(LS_MODE) || 'popup'; // how the active token was obtained
  let status = 'idle';      // idle | syncing | ok | error | setupNeeded
  let statusMsg = '';
  let dirtyIds = new Set();
  let pushTimer = null;
  let pullTimer = null;
  let initialized = false;
  let listeners = [];
  let inFlight = false;

  // ---------- Platform detection ----------
  // iOS standalone PWAs (and some embedded contexts) break window.open OAuth popups.
  // Detect and route those to a full-page redirect flow instead.
  function isStandalone() {
    try {
      return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
             window.navigator.standalone === true;
    } catch { return false; }
  }
  function isIOS() {
    return /iP(hone|ad|od)/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function gisAvailable() {
    return !!(window.google && window.google.accounts && window.google.accounts.oauth2);
  }
  // Prefer redirect when popups are unreliable: iOS standalone, or GIS lib unavailable.
  function preferRedirect() {
    if (isStandalone() && isIOS()) return true;
    return false;
  }
  function redirectUri() {
    // Must EXACTLY match an "Authorized redirect URI" in the OAuth client config.
    return location.origin + '/';
  }
  function randomState() {
    try {
      const a = new Uint8Array(16);
      crypto.getRandomValues(a);
      return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return Date.now().toString(36) + Math.random().toString(36).slice(2);
    }
  }

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
      localStorage.setItem(LS_MODE, authMode);
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
        authMode = 'popup';
        persistToken();
        fetchUserInfo().then(() => {
          setStatus('syncing', 'Initial sync...');
          syncNow().catch((e) => setStatus('error', e.message));
          startBackgroundPull();
        });
      },
      error_callback: (err) => {
        // Popup blocked / failed to open (common in TWA / restrictive WebViews)
        // → fall back to the universal redirect flow. User-cancelled = stay put.
        console.warn('[cloud] GIS error', err);
        if (err && (err.type === 'popup_failed_to_open' || err.type === 'unknown')) {
          startRedirectAuth(false);
        } else {
          setStatus('idle', err && err.type === 'popup_closed' ? '' : (err && err.type) || 'auth cancelled');
        }
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
        return;
      }
    } catch (e) {
      console.warn('[cloud] userinfo fetch failed, trying Drive about', e);
    }

    try {
      // Fallback: use Drive API's about endpoint (authorized by drive.appdata scope)
      const r = await driveFetch('/about?fields=user');
      const data = await r.json();
      if (data && data.user) {
        userInfo = {
          email: data.user.emailAddress,
          name: data.user.displayName,
          picture: data.user.photoLink
        };
        localStorage.setItem(LS_USER, JSON.stringify(userInfo));
      }
    } catch (e) {
      console.warn('[cloud] userinfo fallback failed', e);
    }
  }

  // ---------- Redirect (implicit) flow — universal, works on iOS standalone & TWA ----------
  // Full-page navigation to Google, returns with #access_token=... in URL fragment.
  function buildAuthUrl(silent) {
    const state = randomState();
    try { sessionStorage.setItem(SS_STATE, state); } catch (_) {}
    const params = new URLSearchParams({
      client_id: CFG.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri(),
      response_type: 'token',
      scope: CFG.SCOPE,
      include_granted_scopes: 'true',
      state: state,
    });
    if (silent) params.set('prompt', 'none');
    if (userInfo && userInfo.email) params.set('login_hint', userInfo.email);
    return AUTH_ENDPOINT + '?' + params.toString();
  }

  function startRedirectAuth(silent) {
    if (!CFG.GOOGLE_CLIENT_ID) { setStatus('setupNeeded', ''); return; }
    authMode = 'redirect';
    localStorage.setItem(LS_MODE, 'redirect');
    location.href = buildAuthUrl(!!silent);
  }

  // Parse #access_token / #error from the URL after a redirect return.
  // Returns 'ok' | 'error' | null (not a callback).
  function handleRedirectCallback() {
    const hash = location.hash || '';
    if (hash.indexOf('access_token') === -1 && hash.indexOf('error=') === -1) return null;
    const frag = new URLSearchParams(hash.replace(/^#/, ''));
    const token = frag.get('access_token');
    const err = frag.get('error');
    const state = frag.get('state');
    let savedState = null;
    try { savedState = sessionStorage.getItem(SS_STATE); sessionStorage.removeItem(SS_STATE); } catch (_) {}
    // Clean the URL (drop fragment + any query) regardless of outcome
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
    if (err) {
      console.warn('[cloud] redirect auth error:', err);
      return 'error';
    }
    if (!token) return 'error';
    if (savedState && state !== savedState) {
      console.warn('[cloud] OAuth state mismatch — possible CSRF, ignoring token');
      return 'error';
    }
    const expiresIn = parseInt(frag.get('expires_in') || '3600', 10);
    accessToken = token;
    tokenExpiresAt = Date.now() + (expiresIn - 60) * 1000;
    signedIn = true;
    authMode = 'redirect';
    persistToken();
    return 'ok';
  }

  // ---------- Sign in / out ----------
  async function signIn() {
    if (!CFG.GOOGLE_CLIENT_ID) {
      setStatus('setupNeeded', 'OAuth client ID not configured in cloud-config.js');
      return;
    }
    // Route platforms with broken popups straight to redirect
    if (preferRedirect()) { startRedirectAuth(false); return; }
    try {
      if (!tokenClient) await initTokenClient();
      // GIS prompts for consent on first call; silent thereafter
      tokenClient.requestAccessToken({ prompt: signedIn ? '' : 'consent' });
    } catch (e) {
      // GIS unavailable (offline lib, blocked) → fall back to redirect
      console.warn('[cloud] popup auth unavailable, using redirect', e);
      startRedirectAuth(false);
    }
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
    localStorage.removeItem(LS_MODE);
    clearTimeout(pushTimer);
    clearInterval(pullTimer);
    pullTimer = null;
    setStatus('idle', '');
  }

  // Refresh the access token before it expires.
  // popup mode: silent GIS re-grant (no UI). redirect mode: navigate with prompt=none
  // (Google immediately bounces back with a fresh token if consent is still valid).
  async function refreshToken(allowRedirect = true) {
    if (authMode === 'redirect') {
      if (!allowRedirect) {
        throw new Error('Token expired, redirect refresh deferred');
      }
      startRedirectAuth(true); // prompt=none → page navigates; resumes via init() on return
      // Halt this call; the page is unloading.
      await new Promise(() => {});
      return;
    }
    if (!gisAvailable()) throw new Error('Token expired and GIS unavailable');
    if (!tokenClient) await initTokenClient();
    await new Promise((resolve, reject) => {
      const prev = tokenClient.callback;
      const timeoutId = setTimeout(() => {
        tokenClient.callback = prev;
        reject(new Error('Silent token refresh timed out (often due to blocked third-party cookies)'));
      }, 5000);

      tokenClient.callback = (resp) => {
        clearTimeout(timeoutId);
        tokenClient.callback = prev;
        if (resp.error) { reject(new Error(resp.error)); return; }
        accessToken = resp.access_token;
        tokenExpiresAt = Date.now() + (resp.expires_in - 60) * 1000;
        authMode = 'popup';
        persistToken();
        resolve();
      };
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  // ---------- Drive REST ----------
  async function driveFetch(path, init, allowRedirect = false) {
    if (!accessToken) throw new Error('No access token');
    if (tokenExpiresAt && tokenExpiresAt <= Date.now()) {
      await refreshToken(allowRedirect);
    }
    const opts = init || {};
    opts.headers = Object.assign({}, opts.headers || {}, {
      Authorization: 'Bearer ' + accessToken,
    });
    const url = path.startsWith('http') ? path : (CFG.DRIVE_API + path);
    let r = await fetch(url, opts);
    // 401 → token rejected server-side (revoked/expired early). Refresh once, retry.
    if (r.status === 401) {
      try {
        await refreshToken(allowRedirect);
        opts.headers.Authorization = 'Bearer ' + accessToken;
        r = await fetch(url, opts);
      } catch (e) {
        signedIn = false;
        localStorage.removeItem(LS_TOKEN);
        setStatus('idle', 'Re-sign-in required');
        throw new Error('Token rejected (401), re-sign-in required');
      }
    }
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      throw new Error(`Drive ${r.status}: ${errText.slice(0, 200)}`);
    }
    return r;
  }

  async function listAppData(allowRedirect = false) {
    const r = await driveFetch('/files?spaces=appDataFolder&fields=files(id,name,modifiedTime,size)&pageSize=1000', null, allowRedirect);
    const data = await r.json();
    return data.files || [];
  }

  async function downloadJson(fileId, allowRedirect = false) {
    const r = await driveFetch(`/files/${fileId}?alt=media`, null, allowRedirect);
    return await r.json();
  }

  async function uploadJson(name, json, existingFileId, allowRedirect = false) {
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
    }, allowRedirect);
    return await r.json();
  }

  async function deleteFile(fileId, allowRedirect = false) {
    await driveFetch(`/files/${fileId}`, { method: 'DELETE' }, allowRedirect);
  }

  // ---------- Sync ----------
  function notesArr() { return window.__npNotes || []; }

  function findFile(files, name) { return files.find((f) => f.name === name); }

  async function pull(allowRedirect = false) {
    const files = await listAppData(allowRedirect);
    const indexFile = findFile(files, 'notes-index.json');
    if (!indexFile) return { pulled: 0, failures: [] }; // first sync, nothing remote
    const remoteIndex = await downloadJson(indexFile.id, allowRedirect);
    const remoteNotes = remoteIndex.notes || [];
    const local = notesArr();
    const localById = new Map(local.map((n) => [n.id, n]));
    const fileById = new Map(files.map((f) => [f.name, f]));
    let pulled = 0;
    const failures = [];
    let activeNoteUpdated = false;
    const activeId = window.__npGetActiveId && window.__npGetActiveId();
    for (const r of remoteNotes) {
      const loc = localById.get(r.id);
      const remoteNewer = !loc || (r.updated || 0) > (loc.updated || 0);
      if (!remoteNewer) continue;
      // Handle soft delete cheaply
      if (r.deleted) {
        if (loc) {
          loc.deleted = r.deleted;
          loc.updated = r.updated;
          if (r.id === activeId) activeNoteUpdated = true;
        }
        pulled++;
        continue;
      }
      const noteFile = fileById.get(`note-${r.id}.json`);
      if (!noteFile) {
        failures.push(r.id);
        continue;
      }
      try {
        const downloaded = await downloadJson(noteFile.id, allowRedirect);
        const fullNote = window.__npNormalizeNote ? window.__npNormalizeNote(downloaded) : downloaded;
        fullNote.rev = noteFile.id;
        const idx = local.findIndex((n) => n.id === fullNote.id);
        if (idx >= 0) local[idx] = fullNote;
        else local.unshift(fullNote);
        pulled++;
        if (fullNote.id === activeId) activeNoteUpdated = true;
      } catch (e) {
        console.warn('[cloud] pull note failed', r.id, e);
        failures.push(r.id);
      }
    }
    if (pulled > 0) {
      // commit changes back into app state
      window.__npNotes = local;
      if (window.__npSaveNotes && window.__npSaveNotes() === false) {
        throw new Error('Local storage save failed after cloud pull');
      }
      window.__npRenderNoteList && window.__npRenderNoteList();
      // Refresh active note in editor only if it was changed remotely
      if (activeNoteUpdated) {
        window.__npLoadNote && window.__npLoadNote(activeId);
      }
    }
    return { pulled, failures };
  }

  async function push(allowRedirect = false) {
    const files = await listAppData(allowRedirect);
    const indexFile = findFile(files, 'notes-index.json');
    const remoteIndex = indexFile ? await downloadJson(indexFile.id, allowRedirect) : { version: 1, notes: [] };
    const remoteMap = new Map((remoteIndex.notes || []).map((r) => [r.id, r]));
    const fileMap = new Map(files.map((f) => [f.name, f]));
    const local = notesArr();
    let pushed = 0;
    const failures = [];
    const syncedDeletedIds = new Set();
    for (const note of local) {
      const r = remoteMap.get(note.id);
      const localNewer = !r || (note.updated || 0) > (r.updated || 0);
      if (!localNewer) {
        if (note.deleted && r && r.deleted) syncedDeletedIds.add(note.id);
        continue;
      }

      const fname = `note-${note.id}.json`;
      const existing = fileMap.get(fname);

      if (note.deleted) {
        // If note is deleted locally, delete the note file from Drive (if exists)
        if (existing) {
          try {
            await deleteFile(existing.id, allowRedirect);
            fileMap.delete(fname);
          } catch (e) {
            console.warn('[cloud] failed to delete note file from Drive', note.id, e);
            failures.push(note.id);
            continue;
          }
        }
        remoteMap.set(note.id, {
          id: note.id,
          updated: note.updated,
          deleted: note.deleted,
          rev: null,
        });
        syncedDeletedIds.add(note.id);
        pushed++;
        continue;
      }

      // Size guard
      const payload = JSON.stringify(note);
      if (payload.length > CFG.MAX_NOTE_BYTES) {
        console.warn('[cloud] note too large, skipping', note.id, payload.length);
        failures.push(note.id);
        continue;
      }
      try {
        const uploaded = await uploadJson(fname, note, existing ? existing.id : null, allowRedirect);
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
        failures.push(note.id);
      }
    }

    // Clean up remote index: remove tombstones that are older than 30 days
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const [id, r] of remoteMap.entries()) {
      if (r.deleted && typeof r.deleted === 'number' && r.deleted < thirtyDaysAgo) {
        remoteMap.delete(id);
      }
    }

    // Always rebuild + push index
    const newIndex = {
      version: 1,
      lastSync: Date.now(),
      notes: Array.from(remoteMap.values()),
    };
    await uploadJson('notes-index.json', newIndex, indexFile ? indexFile.id : null, allowRedirect);

    // Clean up local notes that are permanently deleted (deleted === 1) or older than 30 days
    let hasPurged = false;
    const cleanLocal = local.filter((note) => {
      if (note.deleted === 1 && syncedDeletedIds.has(note.id)) {
        hasPurged = true;
        return false;
      }
      if (note.deleted && typeof note.deleted === 'number' && note.deleted < thirtyDaysAgo && syncedDeletedIds.has(note.id)) {
        hasPurged = true;
        return false;
      }
      return true;
    });

    if (hasPurged) {
      window.__npNotes = cleanLocal;
    }

    // Persist rev IDs to local (and saves the cleaned list)
    if (window.__npSaveNotes && window.__npSaveNotes() === false) {
      throw new Error('Local storage save failed after cloud sync');
    }
    return { pushed, failures };
  }

  async function syncNow(allowRedirect = false) {
    if (!signedIn) return;
    if (inFlight) return;
    inFlight = true;
    setStatus('syncing', '');
    try {
      const p1 = await pull(allowRedirect);
      const p2 = await push(allowRedirect);
      const failures = [...p1.failures, ...p2.failures];
      if (failures.length) {
        throw new Error(`${failures.length} note(s) could not be synced`);
      }
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
      const lastInput = window.__npGetLastInputTime ? window.__npGetLastInputTime() : 0;
      if (Date.now() - lastInput < 30000) {
        console.log('[cloud] background pull deferred due to user activity');
        return;
      }
      syncNow().catch((e) => console.warn('[cloud] bg pull', e));
    }, CFG.PULL_INTERVAL_MS);
  }

  async function afterSignedIn() {
    setStatus('syncing', '');
    await fetchUserInfo();
    await syncNow();
    startBackgroundPull();
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

    window.addEventListener('online', () => {
      if (!signedIn) return;
      const lastInput = window.__npGetLastInputTime ? window.__npGetLastInputTime() : 0;
      if (Date.now() - lastInput < 30000) return;
      syncNow();
    });

    // 1. Returning from a redirect sign-in? Token is in the URL fragment.
    const cb = handleRedirectCallback();
    if (cb === 'ok') {
      try { await afterSignedIn(); }
      catch (e) { setStatus('error', e.message); }
      return;
    }
    if (cb === 'error') {
      // Silent (prompt=none) refresh failed → user must re-consent interactively
      setStatus('idle', 'Re-sign-in required');
      // fall through to allow popup client init for browsers
    }

    // 2. Restore a cached token or try silent refresh if it's expired but we were signed in
    let tokenRestored = restoreToken();
    if (!tokenRestored && cb !== 'error' && userInfo && navigator.onLine) {
      try {
        setStatus('syncing', 'Restoring session...');
        await refreshToken(true); // allow redirect since it is page load
        tokenRestored = true;
      } catch (err) {
        console.warn('[cloud] silent token restore failed:', err);
        // If silent refresh failed and we are not in redirect mode, attempt silent redirect
        if (authMode !== 'redirect') {
          console.log('[cloud] falling back to redirect silent auth...');
          startRedirectAuth(true);
          return;
        }
      }
    }

    if (tokenRestored) {
      signedIn = true;
      setStatus('ok', '');
      try {
        await driveFetch('/about?fields=user', null, true); // validates token, allow redirect
        await afterSignedIn();
        return;
      } catch (e) {
        // refreshToken in redirect mode navigates away; only reaches here in popup mode on failure
        accessToken = null;
        tokenExpiresAt = 0;
        signedIn = false;
        localStorage.removeItem(LS_TOKEN);
        setStatus('idle', 'Re-sign-in required');
      }
    } else {
      // Set status to idle or whatever if not restoring, ensuring it doesn't get stuck in 'syncing'
      if (status === 'syncing') {
        setStatus('idle', cb === 'error' ? 'Re-sign-in required' : '');
      }
    }

    // 3. Redirect-mode users with an expired token: attempt a silent re-auth
    //    (prompt=none) on a clean load. Loop-safe: only when there was no callback
    //    fragment this load, so an error return falls through to the sign-in button.
    if (cb === null && !signedIn && authMode === 'redirect' && userInfo && navigator.onLine) {
      startRedirectAuth(true); // navigates away; returns via handleRedirectCallback
      return;
    }

    // 4. Warm up the GIS popup client for browser sign-in (non-blocking; ignore on failure).
    initTokenClient().catch(() => { /* redirect flow remains available */ });
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
