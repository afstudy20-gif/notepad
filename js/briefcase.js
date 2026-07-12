// Briefcase — cross-device file transfer via Google Drive appDataFolder.
//
// Reuses the OAuth token already held by cloud-sync.js (window.__npCloud) instead
// of running its own auth flow. Files are tagged with appProperties.np='briefcase'
// so they're isolated from the note storage (notes-index.json, note-<id>.json)
// living in the same hidden appDataFolder.
//
// Large files (> CHUNK_BYTES) are transparently split into multiple Drive files
// ("parts") sharing an appProperties.npGroup id. list() re-groups the parts into a
// single logical entry; download() fetches every part in order and stitches them
// back into one Blob with the original name and mime type.
//
// Exposes window.__npBriefcase with:
//   list()                      -> logical file entries (chunk groups merged)
//   upload(file, onProgress)    -> onProgress(partIndex, totalParts)
//   download(entry, onProgress) -> Blob (reassembled if chunked)
//   remove(entry)               -> deletes the file or all its parts
//
// Depends on: window.__npCloud.driveRequest() (from cloud-sync.js) and window.NP_CLOUD_CONFIG.

(function () {
  'use strict';

  const CFG = window.NP_CLOUD_CONFIG || {};
  // Per-part size. Kept comfortably under the old 100MB single-file ceiling so each
  // chunk's in-memory multipart body stays small and uploads reliably.
  const CHUNK_BYTES = 95 * 1024 * 1024;
  const TAG_QUERY = "appProperties has { key='np' and value='briefcase' }";
  const PART_SUFFIX_RE = /\.part\d+of\d+$/;

  function cloud() { return window.__npCloud; }

  function drive(path, init) {
    if (!cloud() || !cloud().driveRequest) return Promise.reject(new Error('cloud module unavailable'));
    return cloud().driveRequest(path, init, true); // allowRedirect: user-initiated action
  }

  // Multipart upload of one blob (whole file or a single chunk) with metadata.
  async function uploadBlob(name, mimeType, blob, appProperties) {
    const metadata = {
      name,
      parents: ['appDataFolder'],
      mimeType: mimeType || 'application/octet-stream',
      appProperties,
    };
    const boundary = '-------NPBriefcase' + Math.random().toString(36).slice(2);
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ]);
    const r = await drive(`${CFG.DRIVE_UPLOAD}/files?uploadType=multipart`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return await r.json();
  }

  async function upload(file, onProgress) {
    if (!cloud() || !cloud().isSignedIn()) throw new Error('not-signed-in');
    const mime = file.type || 'application/octet-stream';

    // Small enough → single file, no chunk metadata.
    if (file.size <= CHUNK_BYTES) {
      if (onProgress) onProgress(1, 1);
      return await uploadBlob(file.name, mime, file, { np: 'briefcase' });
    }

    // Large file → split into parts under a shared group id.
    const totalParts = Math.ceil(file.size / CHUNK_BYTES);
    const groupId = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const uploaded = [];
    try {
      for (let i = 0; i < totalParts; i++) {
        if (onProgress) onProgress(i + 1, totalParts);
        const start = i * CHUNK_BYTES;
        const chunk = file.slice(start, Math.min(start + CHUNK_BYTES, file.size));
        const partName = `${file.name}.part${i + 1}of${totalParts}`;
        const res = await uploadBlob(partName, mime, chunk, {
          np: 'briefcase',
          npGroup: groupId,
          npPart: String(i + 1),
          npParts: String(totalParts),
          npSize: String(file.size),
          npType: mime,
        });
        uploaded.push(res.id);
      }
    } catch (e) {
      // Best-effort rollback so a failed multi-part upload doesn't leave orphans.
      for (const id of uploaded) {
        try { await drive(`/files/${id}`, { method: 'DELETE' }); } catch (_) {}
      }
      throw e;
    }
    return { group: groupId, parts: uploaded.length };
  }

  // Reconstruct the original file name from a part file name.
  function baseName(partName) {
    return partName.replace(PART_SUFFIX_RE, '');
  }

  async function list() {
    const q = encodeURIComponent(TAG_QUERY);
    const r = await drive(`/files?spaces=appDataFolder&q=${q}&fields=files(id,name,mimeType,size,modifiedTime,appProperties)&pageSize=1000&orderBy=modifiedTime desc`);
    const data = await r.json();
    const files = data.files || [];

    const groups = new Map();
    const entries = [];

    for (const f of files) {
      const ap = f.appProperties || {};
      if (ap.npGroup) {
        let g = groups.get(ap.npGroup);
        if (!g) {
          g = {
            id: ap.npGroup,
            name: baseName(f.name),
            mimeType: ap.npType || f.mimeType,
            size: parseInt(ap.npSize, 10) || 0,
            totalParts: parseInt(ap.npParts, 10) || 0,
            modifiedTime: f.modifiedTime,
            chunked: true,
            _parts: [],
          };
          groups.set(ap.npGroup, g);
          entries.push(g);
        }
        g._parts.push({ id: f.id, index: parseInt(ap.npPart, 10) || 0, size: parseInt(f.size, 10) || 0 });
        if (f.modifiedTime > g.modifiedTime) g.modifiedTime = f.modifiedTime;
      } else {
        entries.push({
          id: f.id,
          fileId: f.id,
          name: f.name,
          mimeType: f.mimeType,
          size: parseInt(f.size, 10) || 0,
          modifiedTime: f.modifiedTime,
          chunked: false,
        });
      }
    }

    // Finalize chunk groups: order parts, compute completeness, expose partIds.
    for (const g of groups.values()) {
      g._parts.sort((a, b) => a.index - b.index);
      g.partIds = g._parts.map((p) => p.id);
      g.incomplete = g.totalParts > 0 ? g._parts.length !== g.totalParts : false;
      if (!g.size) g.size = g._parts.reduce((s, p) => s + p.size, 0);
      delete g._parts;
    }

    entries.sort((a, b) => (a.modifiedTime < b.modifiedTime ? 1 : -1));
    return entries;
  }

  async function fetchBlob(fileId) {
    const r = await drive(`/files/${fileId}?alt=media`);
    return await r.blob();
  }

  function partIdsOf(entry) {
    return entry.chunked ? entry.partIds : [entry.fileId || entry.id];
  }

  // In-memory reassembly → single Blob. Used as the fallback save path on browsers
  // without the File System Access API (Firefox / Safari).
  async function download(entry, onProgress) {
    if (entry.incomplete) throw new Error('incomplete');
    const ids = partIdsOf(entry);
    if (ids.length === 1) {
      if (onProgress) onProgress(1, 1);
      return await fetchBlob(ids[0]);
    }
    const blobs = [];
    for (let i = 0; i < ids.length; i++) {
      if (onProgress) onProgress(i + 1, ids.length);
      blobs.push(await fetchBlob(ids[i]));
    }
    return new Blob(blobs, { type: entry.mimeType || 'application/octet-stream' });
  }

  // Stream each part straight to a FileSystemWritableFileStream so the save dialog
  // appears immediately and nothing large is held in memory. Caller supplies the
  // writable (opened inside the click gesture via showSaveFilePicker).
  async function downloadTo(entry, writable, onProgress) {
    if (entry.incomplete) throw new Error('incomplete');
    const ids = partIdsOf(entry);
    try {
      for (let i = 0; i < ids.length; i++) {
        if (onProgress) onProgress(i + 1, ids.length);
        const blob = await fetchBlob(ids[i]);
        await writable.write(blob);
      }
      await writable.close();
    } catch (e) {
      try { await writable.abort(); } catch (_) {}
      throw e;
    }
  }

  async function remove(entry) {
    if (!entry.chunked) {
      await drive(`/files/${entry.fileId || entry.id}`, { method: 'DELETE' });
      return;
    }
    for (const id of entry.partIds) {
      await drive(`/files/${id}`, { method: 'DELETE' });
    }
  }

  window.__npBriefcase = { list, upload, download, downloadTo, remove, CHUNK_BYTES };
})();
