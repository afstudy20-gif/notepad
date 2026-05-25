const DEFAULT_NOTEPAD_URL = 'https://not.drtr.uk/';
const NOTEPAD_URL_KEY = 'notepadUrl';

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(NOTEPAD_URL_KEY);
  if (!stored[NOTEPAD_URL_KEY]) {
    await chrome.storage.sync.set({ [NOTEPAD_URL_KEY]: DEFAULT_NOTEPAD_URL });
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await saveTabToNotepad(tab);
    await flashBadge(tab.id, 'OK', '#1f9d55');
  } catch (error) {
    console.error('[notepad-clipper] save failed', error);
    await flashBadge(tab.id, '!', '#c53030');
    const targetUrl = await buildNotepadUrl(tab);
    await chrome.tabs.create({ url: targetUrl, active: true });
  }
});

async function saveTabToNotepad(tab) {
  const payload = {
    title: tab?.title || 'Web sayfası',
    text: '',
    url: isWebUrl(tab?.url) ? tab.url : ''
  };
  const notepadUrl = await getNotepadUrl();
  const targetUrl = buildUrlWithPayload(notepadUrl, payload);
  const notepadTab = await findOpenNotepadTab(notepadUrl);

  if (notepadTab?.id) {
    const injected = await injectIntoNotepad(notepadTab.id, payload);
    if (injected) return;

    await chrome.tabs.update(notepadTab.id, { url: targetUrl });
    return;
  }

  await chrome.tabs.create({ url: targetUrl, active: true });
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

async function injectIntoNotepad(tabId, payload) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [payload],
      func: (notePayload) => {
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

function isWebUrl(url) {
  return /^https?:\/\//i.test(url || '');
}

async function flashBadge(tabId, text, color) {
  if (!tabId) return;
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  }, 1500);
}
