const DEFAULT_NOTEPAD_URL = 'https://not.drtr.uk/';
const NOTEPAD_URL_KEY = 'notepadUrl';
const MAX_PDF_BYTES = 4 * 1024 * 1024;
const SCROLL_CAPTURE_DELAY = 300;
const MAX_SCROLL_CAPTURES = 40;
const FULL_SCREENSHOT_MAX_PIXELS = 4_000_000;
const FULL_SCREENSHOT_MAX_HEIGHT = 12_000;
const FULL_SCREENSHOT_QUALITY = 0.62;
const MAX_SCREENSHOT_DATA_URL_LENGTH = 3_500_000;
const MIN_CAPTURE_INTERVAL = 550;

let lastCaptureTime = 0;
let offscreenReady = false;

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(NOTEPAD_URL_KEY);
  if (!stored[NOTEPAD_URL_KEY]) {
    await chrome.storage.sync.set({ [NOTEPAD_URL_KEY]: DEFAULT_NOTEPAD_URL });
  }

  // Create context menus
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'notepad-parent',
      title: "Notepad'e Ekle",
      contexts: ['page', 'link', 'selection']
    });

    chrome.contextMenus.create({
      id: 'clip-url',
      parentId: 'notepad-parent',
      title: 'Sadece Sayfa Adresi (URL)',
      contexts: ['page', 'link', 'selection']
    });

    chrome.contextMenus.create({
      id: 'clip-viewport',
      parentId: 'notepad-parent',
      title: 'Sayfa Adresi ve Screenshot',
      contexts: ['page', 'link', 'selection']
    });

    chrome.contextMenus.create({
      id: 'clip-scroll',
      parentId: 'notepad-parent',
      title: 'Sayfa Adresi ve Scroll Screenshot',
      contexts: ['page', 'link', 'selection']
    });

    chrome.contextMenus.create({
      id: 'clip-pdf',
      parentId: 'notepad-parent',
      title: 'Sayfa Adresi ve PDF (Varsa)',
      contexts: ['page', 'link', 'selection']
    });
  });
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    const result = await saveTabToNotepad(tab, { optionType: 'scroll' });
    await flashBadge(tab.id, 'OK', '#1f9d55');
    return result;
  } catch (error) {
    console.error('[notepad-clipper] save failed', error);
    await flashBadge(tab.id, '!', '#c53030');
    const targetUrl = await buildNotepadUrl(tab);
    await chrome.tabs.create({ url: targetUrl, active: true });
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;

  let optionType = 'scroll';
  if (info.menuItemId === 'clip-url') optionType = 'url';
  else if (info.menuItemId === 'clip-viewport') optionType = 'viewport';
  else if (info.menuItemId === 'clip-scroll') optionType = 'scroll';
  else if (info.menuItemId === 'clip-pdf') optionType = 'pdf';

  try {
    await flashBadge(tab.id, '...', '#4361ee');
    const result = await saveTabToNotepad(tab, {
      optionType,
      focusNotepad: true
    });
    await flashBadge(tab.id, 'OK', '#1f9d55');
  } catch (error) {
    console.error('[notepad-clipper] context menu save failed', error);
    await flashBadge(tab.id, '!', '#c53030');
    const notepadUrl = await getNotepadUrl();
    const targetUrl = buildUrlWithPayload(notepadUrl, {
      title: tab?.title || 'Web sayfası',
      text: '',
      url: isWebUrl(tab?.url) ? tab.url : ''
    });
    await chrome.tabs.create({ url: targetUrl, active: true });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!['get-notes', 'save-active-tab', 'detect-pdf'].includes(message?.type)) return false;

  (async () => {
    try {
      if (message.type === 'get-notes') {
        const result = await getNotepadNotes();
        sendResponse({ ok: true, ...result });
        return;
      }

      if (message.type === 'detect-pdf') {
        const tab = message.sourceTabId
          ? await chrome.tabs.get(message.sourceTabId)
          : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
        const pdfUrls = await findPdfUrls(tab);
        sendResponse({ ok: true, pdfCount: pdfUrls.length });
        return;
      }

      const tab = message.sourceTabId
        ? await chrome.tabs.get(message.sourceTabId)
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      const result = await saveTabToNotepad(tab, {
        targetNoteId: message.targetNoteId || '',
        createNewNote: !!message.createNewNote,
        optionType: message.optionType || 'scroll',
        focusNotepad: !!message.focusNotepad
      });
      if (tab?.id) await flashBadge(tab.id, 'OK', '#1f9d55');
      sendResponse({ ok: true, ...result });
    } catch (error) {
      console.error('[notepad-clipper] popup message handler failed', error);
      sendResponse({ ok: false, error: error?.message || 'Kaydedilemedi' });
    }
  })();

  return true;
});

async function saveTabToNotepad(tab, target = {}) {
  const optionType = target.optionType || 'scroll'; // 'url', 'viewport', 'scroll', 'pdf'
  
  let screenshot = { dataUrl: '', mode: 'none' };
  let pdfAttachment = null;

  if (optionType === 'viewport') {
    screenshot = await captureScreenshot(tab, { fullPage: false });
  } else if (optionType === 'scroll') {
    screenshot = await captureScreenshot(tab, { fullPage: true });
  }

  if (optionType === 'pdf') {
    pdfAttachment = await capturePdfAttachment(tab);
  }

  const payload = {
    title: tab?.title || 'Web sayfası',
    text: '',
    url: isWebUrl(tab?.url) ? tab.url : '',
    screenshotDataUrl: screenshot.dataUrl,
    screenshotMode: screenshot.mode,
    pdfAttachment: pdfAttachment
  };

  const notepadUrl = await getNotepadUrl();
  const targetUrl = buildUrlWithPayload(notepadUrl, payload);
  const notepadTab = await ensureNotepadTab(notepadUrl, { active: !!target.focusNotepad });

  if (notepadTab?.id) {
    const injected = await injectIntoNotepad(notepadTab.id, payload, target);
    if (injected) {
      if (target.focusNotepad) await focusTab(notepadTab);
      return resultSummary(payload);
    }

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
  const tab = await findOpenNotepadTab(notepadUrl);
  if (!tab?.id) {
    return { notes: [], noTabOpen: true };
  }

  if (tab.status !== 'complete') {
    await waitForTabComplete(tab.id);
  }

  const results = await executeWhenNotepadReady(tab.id, () => {
    if (typeof window.__npListClipTargetNotes !== 'function') return { ready: false, notes: [] };
    return { ready: true, notes: window.__npListClipTargetNotes() };
  });
  const payload = results?.[0]?.result || {};

  return {
    notes: payload.notes || [],
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
  const defaultTarget = normalizeNotepadUrl(DEFAULT_NOTEPAD_URL);
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => {
    if (!tab.url) return false;
    try {
      const current = new URL(tab.url);
      
      // 1. Match configured target URL
      if (current.origin === target.origin &&
          (current.pathname === target.pathname || current.pathname === '/' || current.pathname.endsWith('/index.html'))) {
        return true;
      }
      
      // 2. Match default production URL (https://not.drtr.uk)
      if (current.origin === defaultTarget.origin &&
          (current.pathname === '/' || current.pathname.endsWith('/index.html'))) {
        return true;
      }
      
      // 3. Match localhost or 127.0.0.1 running Notepad
      const isLocal = current.hostname === 'localhost' || current.hostname === '127.0.0.1';
      const isNotepad = tab.title && /Notepad/i.test(tab.title);
      if (isLocal && isNotepad && (current.pathname === '/' || current.pathname.endsWith('/index.html'))) {
        return true;
      }
      
      return false;
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

async function executeWhenNotepadReady(tabId, func, args = [], retries = 8) {
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        args,
        func
      });
      const value = results?.[0]?.result;
      if (value?.ready === false) {
        await delay(250);
        continue;
      }
      return results;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  if (lastError) throw lastError;
  throw new Error('Notepad hazır değil');
}

async function injectIntoNotepad(tabId, payload, target = {}) {
  try {
    const results = await executeWhenNotepadReady(tabId, (notePayload, noteTarget) => {
        const ready = typeof window.__npAppendExternalClipToNote === 'function' ||
          typeof window.__npCreateExternalNoteDirect === 'function' ||
          typeof window.__npOpenClipTargetPicker === 'function' ||
          typeof window.__npCreateExternalNote === 'function';
        if (!ready) return { ready: false, saved: false };
        if (noteTarget?.targetNoteId && typeof window.__npAppendExternalClipToNote === 'function') {
          return { ready: true, saved: !!window.__npAppendExternalClipToNote(noteTarget.targetNoteId, notePayload) };
        }
        if (noteTarget?.createNewNote && typeof window.__npCreateExternalNoteDirect === 'function') {
          window.__npCreateExternalNoteDirect(notePayload);
          return { ready: true, saved: true };
        }
        if (typeof window.__npOpenClipTargetPicker === 'function') {
          window.__npOpenClipTargetPicker(notePayload);
          return { ready: true, saved: true };
        }
        if (typeof window.__npCreateExternalNote !== 'function') return { ready: false, saved: false };
        window.__npCreateExternalNote(notePayload);
        return { ready: true, saved: true };
      },
      [payload, target]
    );

    return results?.[0]?.result?.saved === true;
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
    screenshotMode: payload.screenshotMode || (payload.screenshotDataUrl ? 'viewport' : 'none'),
    pdfIncluded: !!payload.pdfAttachment?.dataUrl,
    pdfDownloaded: !!payload.pdfAttachment?.downloadedExternally,
    pdfLinkedOnly: !!payload.pdfAttachment?.url && !payload.pdfAttachment?.dataUrl && !payload.pdfAttachment?.downloadedExternally
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!response || !response.success) {
        reject(new Error(response?.error || 'No response'));
      } else {
        resolve(response.data);
      }
    });
  });
}

async function captureVisibleTabThrottled(windowId, options, retries = 3) {
  const elapsed = Date.now() - lastCaptureTime;
  if (elapsed < MIN_CAPTURE_INTERVAL) {
    await delay(MIN_CAPTURE_INTERVAL - elapsed);
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      lastCaptureTime = Date.now();
      return await chrome.tabs.captureVisibleTab(windowId, options);
    } catch (error) {
      const rateLimited = /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(error?.message || '');
      if (rateLimited && attempt < retries - 1) {
        await delay(MIN_CAPTURE_INTERVAL);
        continue;
      }
      throw error;
    }
  }
  return '';
}

async function ensureOffscreen() {
  if (offscreenReady) return;
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Stitch scrolling screenshots for Notepad notes'
    });
    offscreenReady = true;
  } catch (error) {
    if (/already exists/i.test(error?.message || '')) {
      offscreenReady = true;
      return;
    }
    throw error;
  }
}

async function closeOffscreen() {
  try {
    await chrome.offscreen.closeDocument();
  } catch (_) {
    // Ignore: it may already be closed.
  } finally {
    offscreenReady = false;
  }
}

function sendToOffscreen(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

function broadcastProgress(progress) {
  chrome.runtime.sendMessage({ type: 'captureProgress', ...progress }).catch(() => {});
}

function scrollPositions(scrollHeight, viewportHeight) {
  const safeViewport = Math.max(1, viewportHeight || 1);
  const safeScrollHeight = Math.max(safeViewport, scrollHeight || safeViewport);
  const maxScrollY = Math.max(0, safeScrollHeight - safeViewport);
  const positions = [0];

  for (let y = safeViewport; y < maxScrollY && positions.length < MAX_SCROLL_CAPTURES - 1; y += safeViewport) {
    positions.push(y);
  }
  if (maxScrollY > 0 && positions[positions.length - 1] !== maxScrollY && positions.length < MAX_SCROLL_CAPTURES) {
    positions.push(maxScrollY);
  }

  return positions;
}

async function captureScreenshot(tab, options = {}) {
  if (!tab?.windowId || !/^https?:\/\//i.test(tab?.url || '')) {
    return { dataUrl: '', mode: 'none' };
  }

  if (options.fullPage) {
    const fullPage = await captureFullPageScreenshot(tab);
    if (fullPage && fullPage.length <= MAX_SCREENSHOT_DATA_URL_LENGTH) {
      return { dataUrl: fullPage, mode: 'scroll' };
    }
    if (fullPage) {
      console.warn('[notepad-clipper] full-page screenshot too large, falling back to viewport');
    }
  }

  try {
    const dataUrl = await captureVisibleTabThrottled(tab.windowId, {
      format: 'jpeg',
      quality: 72
    });
    return { dataUrl, mode: 'viewport' };
  } catch (error) {
    console.warn('[notepad-clipper] screenshot skipped', error);
    return { dataUrl: '', mode: 'none' };
  }
}

async function captureFullPageScreenshot(tab) {
  let prepared = false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
    await delay(80);

    const dims = await sendToTab(tab.id, { action: 'getDimensions' });
    const viewportHeight = Math.max(1, dims.viewportHeight || 1);
    const positions = scrollPositions(dims.scrollHeight, viewportHeight);
    const totalCaptures = positions.length;
    const captures = [];
    const seenScrollY = new Set();

    await sendToTab(tab.id, { action: 'prepareCapture' });
    prepared = true;
    broadcastProgress({ phase: 'capturing', current: 0, total: totalCaptures });

    for (let i = 0; i < positions.length; i++) {
      const scrollY = positions[i];
      const scrollResult = await sendToTab(tab.id, { action: 'scrollTo', x: 0, y: scrollY });
      await delay(SCROLL_CAPTURE_DELAY);
      await sendToTab(tab.id, { action: 'handleFixed' });
      await delay(50);

      const actualY = Math.max(0, Math.round(scrollResult.actualY || 0));
      if (seenScrollY.has(actualY)) {
        continue;
      }
      seenScrollY.add(actualY);

      const dataUrl = await captureVisibleTabThrottled(tab.windowId, {
        format: 'jpeg',
        quality: 72
      });
      captures.push({
        dataUrl,
        scrollY: actualY,
        index: i
      });
      broadcastProgress({ phase: 'capturing', current: Math.min(i + 1, totalCaptures), total: totalCaptures });
    }

    if (!captures.length) throw new Error('No scroll captures were produced');

    await sendToTab(tab.id, { action: 'restore' });
    prepared = false;

    await ensureOffscreen();
    broadcastProgress({ phase: 'stitching', current: 0, total: 1 });
    const result = await sendToOffscreen({
      target: 'offscreen',
      action: 'stitch',
      captures: captures.map((capture) => ({
        dataUrl: capture.dataUrl,
        scrollY: capture.scrollY
      })),
      dimensions: {
        ...dims,
        scrollHeight: Math.min(
          dims.scrollHeight || viewportHeight,
          Math.max(...captures.map((capture) => capture.scrollY)) + viewportHeight
        )
      },
      format: 'jpg',
      jpgQuality: FULL_SCREENSHOT_QUALITY,
      maxPixels: FULL_SCREENSHOT_MAX_PIXELS,
      maxHeight: FULL_SCREENSHOT_MAX_HEIGHT
    });
    broadcastProgress({ phase: 'done', current: 1, total: 1 });
    return result?.dataUrl || '';
  } catch (error) {
    console.warn('[notepad-clipper] full-page screenshot skipped', error);
    broadcastProgress({ phase: 'error', error: error?.message || 'Full-page screenshot failed' });
    return '';
  } finally {
    if (prepared) {
      try { await sendToTab(tab.id, { action: 'restore' }); } catch (_) {}
    }
    await closeOffscreen();
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
