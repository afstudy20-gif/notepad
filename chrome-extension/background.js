const DEFAULT_NOTEPAD_URL = 'https://not.drtr.uk/';
const NOTEPAD_URL_KEY = 'notepadUrl';
const MAX_PDF_BYTES = 4 * 1024 * 1024;

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(NOTEPAD_URL_KEY);
  if (!stored[NOTEPAD_URL_KEY]) {
    await chrome.storage.sync.set({ [NOTEPAD_URL_KEY]: DEFAULT_NOTEPAD_URL });
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    const result = await saveTabToNotepad(tab);
    await flashBadge(tab.id, 'OK', '#1f9d55');
    return result;
  } catch (error) {
    console.error('[notepad-clipper] save failed', error);
    await flashBadge(tab.id, '!', '#c53030');
    const targetUrl = await buildNotepadUrl(tab);
    await chrome.tabs.create({ url: targetUrl, active: true });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!['get-notes', 'save-active-tab'].includes(message?.type)) return false;

  (async () => {
    try {
      if (message.type === 'get-notes') {
        const result = await getNotepadNotes();
        sendResponse({ ok: true, ...result });
        return;
      }

      const tab = message.sourceTabId
        ? await chrome.tabs.get(message.sourceTabId)
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      const result = await saveTabToNotepad(tab, {
        targetNoteId: message.targetNoteId || '',
        createNewNote: !!message.createNewNote,
        includeScreenshot: message.includeScreenshot !== false
      });
      if (tab?.id) await flashBadge(tab.id, 'OK', '#1f9d55');
      sendResponse({ ok: true, ...result });
    } catch (error) {
      console.error('[notepad-clipper] popup save failed', error);
      sendResponse({ ok: false, error: error?.message || 'Kaydedilemedi' });
    }
  })();

  return true;
});

async function saveTabToNotepad(tab, target = {}) {
  const payload = {
    title: tab?.title || 'Web sayfası',
    text: '',
    url: isWebUrl(tab?.url) ? tab.url : '',
    screenshotDataUrl: target.includeScreenshot === false ? '' : await captureScreenshot(tab),
    pdfAttachment: await capturePdfAttachment(tab)
  };
  const notepadUrl = await getNotepadUrl();
  const targetUrl = buildUrlWithPayload(notepadUrl, payload);
  const notepadTab = await ensureNotepadTab(notepadUrl, { active: false });

  if (notepadTab?.id) {
    const injected = await injectIntoNotepad(notepadTab.id, payload, target);
    if (injected) return resultSummary(payload);

    await chrome.tabs.update(notepadTab.id, { url: targetUrl, active: true });
    return { screenshotIncluded: false, pdfIncluded: false };
  }

  const createdTab = await chrome.tabs.create({ url: buildOpenUrl(notepadUrl), active: true });
  if (createdTab?.id) {
    await waitForTabComplete(createdTab.id);
    const injected = await injectIntoNotepad(createdTab.id, payload);
    if (injected) return resultSummary(payload);
    await chrome.tabs.update(createdTab.id, { url: targetUrl });
  } else {
    await chrome.tabs.create({ url: targetUrl, active: true });
  }

  return { screenshotIncluded: false, pdfIncluded: false };
}

async function getNotepadNotes() {
  const notepadUrl = await getNotepadUrl();
  const tab = await ensureNotepadTab(notepadUrl, { active: false });
  if (!tab?.id) return { notes: [] };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: () => {
      if (typeof window.__npListClipTargetNotes !== 'function') return [];
      return window.__npListClipTargetNotes();
    }
  });

  return {
    notes: results?.[0]?.result || [],
    notepadTabId: tab.id
  };
}

async function getNotepadUrl() {
  const stored = await chrome.storage.sync.get(NOTEPAD_URL_KEY);
  return stored[NOTEPAD_URL_KEY] || DEFAULT_NOTEPAD_URL;
}

async function buildNotepadUrl(tab) {
  const notepadUrl = await getNotepadUrl();
  return buildUrlWithPayload(notepadUrl, {
    title: tab?.title || 'Web sayfası',
    text: '',
    url: isWebUrl(tab?.url) ? tab.url : ''
  });
}

function buildUrlWithPayload(baseUrl, payload) {
  const url = normalizeNotepadUrl(baseUrl);
  url.searchParams.set('title', payload.title || 'Web sayfası');
  if (payload.text) url.searchParams.set('text', payload.text);
  if (payload.url) url.searchParams.set('url', payload.url);
  url.searchParams.set('source', 'chrome-extension');
  return url.toString();
}

function buildOpenUrl(baseUrl) {
  const url = normalizeNotepadUrl(baseUrl);
  url.searchParams.set('source', 'chrome-extension');
  return url.toString();
}

function normalizeNotepadUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  const candidate = trimmed || DEFAULT_NOTEPAD_URL;
  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  const url = new URL(withScheme);
  if (!url.pathname || url.pathname === '/') {
    url.pathname = '/index.html';
  }
  return url;
}

async function findOpenNotepadTab(baseUrl) {
  const target = normalizeNotepadUrl(baseUrl);
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => {
    if (!tab.url) return false;
    try {
      const current = new URL(tab.url);
      return current.origin === target.origin &&
        (current.pathname === target.pathname || current.pathname === '/' || current.pathname.endsWith('/index.html'));
    } catch (_) {
      return false;
    }
  });
}

async function ensureNotepadTab(baseUrl, options = {}) {
  const existing = await findOpenNotepadTab(baseUrl);
  if (existing?.id) {
    await waitForTabComplete(existing.id);
    return existing;
  }

  const created = await chrome.tabs.create({
    url: buildOpenUrl(baseUrl),
    active: !!options.active
  });
  if (created?.id) await waitForTabComplete(created.id);
  return created;
}

async function injectIntoNotepad(tabId, payload, target = {}) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [payload, target],
      func: (notePayload, noteTarget) => {
        if (noteTarget?.targetNoteId && typeof window.__npAppendExternalClipToNote === 'function') {
          return !!window.__npAppendExternalClipToNote(noteTarget.targetNoteId, notePayload);
        }
        if (noteTarget?.createNewNote && typeof window.__npCreateExternalNoteDirect === 'function') {
          window.__npCreateExternalNoteDirect(notePayload);
          return true;
        }
        if (typeof window.__npOpenClipTargetPicker === 'function') {
          window.__npOpenClipTargetPicker(notePayload);
          return true;
        }
        if (typeof window.__npCreateExternalNote !== 'function') return false;
        window.__npCreateExternalNote(notePayload);
        return true;
      }
    });

    return results?.[0]?.result === true;
  } catch (error) {
    console.warn('[notepad-clipper] injection fallback', error);
    return false;
  }
}

async function focusTab(tab) {
  if (!tab?.id) return;
  try {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  } catch (error) {
    console.warn('[notepad-clipper] focus skipped', error);
  }
}

function isWebUrl(url) {
  return /^https?:\/\//i.test(url || '');
}

function resultSummary(payload) {
  return {
    screenshotIncluded: !!payload.screenshotDataUrl,
    pdfIncluded: !!payload.pdfAttachment?.dataUrl,
    pdfDownloaded: !!payload.pdfAttachment?.downloadedExternally,
    pdfLinkedOnly: !!payload.pdfAttachment?.url && !payload.pdfAttachment?.dataUrl && !payload.pdfAttachment?.downloadedExternally
  };
}

async function captureScreenshot(tab) {
  if (!tab?.windowId || !/^https?:\/\//i.test(tab?.url || '')) return '';

  try {
    return await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 72
    });
  } catch (error) {
    console.warn('[notepad-clipper] screenshot skipped', error);
    return '';
  }
}

async function capturePdfAttachment(tab) {
  const pdfUrls = await findPdfUrls(tab);
  if (!pdfUrls.length) return null;

  let fallback = null;
  for (const pdfUrl of pdfUrls) {
    const attachment = await fetchPdfAttachment(pdfUrl, tab);
    if (attachment?.dataUrl || attachment?.tooLarge) return attachment;
    if (attachment?.url && !fallback) fallback = attachment;
  }

  if (fallback?.url) {
    const downloaded = await downloadPdfFallback(fallback.url, fallback.name);
    return { ...fallback, downloadedExternally: downloaded };
  }

  return fallback;
}

async function fetchPdfAttachment(pdfUrl, tab) {
  try {
    const response = await fetch(pdfUrl, { credentials: 'include' });
    if (!response.ok) throw new Error(`PDF fetch failed: ${response.status}`);

    const blob = await response.blob();
    const contentType = blob.type || response.headers.get('content-type') || '';
    const disposition = response.headers.get('content-disposition') || '';
    if (!isPdfResponse(pdfUrl, contentType, disposition)) return null;

    const name = pdfFileName(pdfUrl, tab?.title, disposition);
    if (blob.size > MAX_PDF_BYTES) {
      return { name, url: pdfUrl, size: blob.size, tooLarge: true };
    }

    const buffer = await blob.arrayBuffer();
    return {
      name,
      url: pdfUrl,
      size: blob.size,
      dataUrl: `data:application/pdf;base64,${arrayBufferToBase64(buffer)}`
    };
  } catch (error) {
    console.warn('[notepad-clipper] pdf skipped', error);
    return { name: pdfFileName(pdfUrl, tab?.title), url: pdfUrl };
  }
}

async function downloadPdfFallback(pdfUrl, name) {
  if (!chrome.downloads?.download) return false;

  try {
    await chrome.downloads.download({
      url: pdfUrl,
      filename: sanitizeDownloadPath(name || 'notepad-web-page.pdf'),
      saveAs: false
    });
    return true;
  } catch (error) {
    console.warn('[notepad-clipper] pdf download fallback failed', error);
    return false;
  }
}

async function findPdfUrls(tab) {
  if (!isWebUrl(tab?.url)) return [];
  const candidates = [tab.url];

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [tab.url],
      func: (pageUrl) => {
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
            if (raw) found.push(new URL(raw, pageUrl).href);
          }
        }
        return found;
      }
    });
    candidates.push(...(results?.[0]?.result || []));
  } catch (error) {
    console.warn('[notepad-clipper] pdf detection skipped', error);
  }

  return [...new Set(candidates.filter(isWebUrl))];
}

function isPdfResponse(pdfUrl, contentType, disposition) {
  return /pdf/i.test(contentType || '') ||
    /\.pdf(?:$|[?#])/i.test(pdfUrl || '') ||
    /filename\*?=.*\.pdf/i.test(disposition || '') ||
    /\/(?:show|view|download)?pdf\b/i.test(new URL(pdfUrl).pathname || '');
}

function pdfFileName(pdfUrl, tabTitle, disposition = '') {
  const fromDisposition = fileNameFromContentDisposition(disposition);
  if (fromDisposition) return fromDisposition;

  try {
    const url = new URL(pdfUrl);
    const last = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
    if (/\.pdf$/i.test(last)) return last.replace(/[\\/:*?"<>|]+/g, '-');
  } catch (_) {}
  const base = (tabTitle || 'web-page').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'web-page';
  return `${base}.pdf`;
}

function fileNameFromContentDisposition(disposition) {
  if (!disposition) return '';
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const rawMatch = disposition.match(/filename="?([^";]+)"?/i);
  const raw = utfMatch?.[1] || rawMatch?.[1] || '';
  if (!raw) return '';
  try {
    return decodeURIComponent(raw).replace(/[\\/:*?"<>|]+/g, '-');
  } catch (_) {
    return raw.replace(/[\\/:*?"<>|]+/g, '-');
  }
}

function sanitizeDownloadPath(name) {
  const safe = String(name || 'notepad-web-page.pdf').replace(/[\\/:*?"<>|]+/g, '-');
  return safe.toLowerCase().endsWith('.pdf') ? safe : `${safe}.pdf`;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    let done = false;
    const timeout = setTimeout(finish, 8000);

    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finish();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((currentTab) => {
      if (currentTab.status === 'complete') finish();
    }).catch(finish);
  });
}

async function flashBadge(tabId, text, color) {
  if (!tabId) return;
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  }, 1500);
}
