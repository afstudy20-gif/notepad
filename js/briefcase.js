// Briefcase — cross-device file transfer via Google Drive appDataFolder.
//
// Reuses the OAuth token already held by cloud-sync.js (window.__npCloud) instead
// of running its own auth flow. Files are tagged with appProperties.np='briefcase'
// so they're isolated from the note storage (notes-index.json, note-<id>.json)
// living in the same hidden appDataFolder.
//
// Exposes window.__npBriefcase with: list(), upload(file), download(fileId), remove(fileId)
//
// Depends on: window.__npCloud.driveRequest() (from cloud-sync.js) and window.NP_CLOUD_CONFIG.

(function () {
  'use strict';

  const CFG = window.NP_CLOUD_CONFIG || {};
  const MAX_BYTES = 100 * 1024 * 1024; // 100MB per file — in-memory multipart upload guard
  const TAG_QUERY = "appProperties has { key='np' and value='briefcase' }";

  function cloud() { return window.__npCloud; }

  function drive(path, init) {
    if (!cloud() || !cloud().driveRequest) return Promise.reject(new Error('cloud module unavailable'));
    return cloud().driveRequest(path, init, true); // allowRedirect: user-initiated action
  }

  async function list() {
    const q = encodeURIComponent(TAG_QUERY);
    const r = await drive(`/files?spaces=appDataFolder&q=${q}&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=1000&orderBy=modifiedTime desc`);
    const data = await r.json();
    return data.files || [];
  }

  async function upload(file) {
    if (!cloud() || !cloud().isSignedIn()) throw new Error('not-signed-in');
    if (file.size > MAX_BYTES) throw new Error('too-large');
    const metadata = {
      name: file.name,
      parents: ['appDataFolder'],
      mimeType: file.type || 'application/octet-stream',
      appProperties: { np: 'briefcase' },
    };
    const boundary = '-------NPBriefcase' + Math.random().toString(36).slice(2);
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n`,
      file,
      `\r\n--${boundary}--`,
    ]);
    const r = await drive(`${CFG.DRIVE_UPLOAD}/files?uploadType=multipart`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return await r.json();
  }

  async function download(fileId) {
    const r = await drive(`/files/${fileId}?alt=media`);
    return await r.blob();
  }

  async function remove(fileId) {
    await drive(`/files/${fileId}`, { method: 'DELETE' });
  }

  window.__npBriefcase = { list, upload, download, remove, MAX_BYTES };
})();
