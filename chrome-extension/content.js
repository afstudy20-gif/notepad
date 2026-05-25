// ScrollDown - Content Script

if (window._scrdwnInjected) {
  window._scrdwnReset();
} else {
  window._scrdwnInjected = true;

  (function () {
    'use strict';

    let originalState = null;
    let removedElements = [];

    function getPageDimensions() {
      const body = document.body;
      const html = document.documentElement;

      const scrollWidth = Math.max(
        body.scrollWidth || 0, html.scrollWidth || 0,
        body.offsetWidth || 0, html.offsetWidth || 0,
        body.clientWidth || 0, html.clientWidth || 0
      );
      const scrollHeight = Math.max(
        body.scrollHeight || 0, html.scrollHeight || 0,
        body.offsetHeight || 0, html.offsetHeight || 0,
        body.clientHeight || 0, html.clientHeight || 0
      );

      return {
        scrollWidth,
        scrollHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
      };
    }

    // Scan and remove ALL fixed/sticky elements currently in the DOM
    function purgeFixedElements() {
      const all = document.querySelectorAll('*');
      let count = 0;
      for (const el of all) {
        // Skip our own injected style
        if (el.id === 'scrdwn-capture-styles') continue;
        let pos;
        try {
          pos = window.getComputedStyle(el).position;
        } catch (e) { continue; }

        if (pos === 'fixed' || pos === 'sticky') {
          let rect;
          try { rect = el.getBoundingClientRect(); } catch (e) { continue; }
          if (rect.width > 0 && rect.height > 0) {
            const parent = el.parentNode;
            const next = el.nextSibling;
            if (parent) {
              parent.removeChild(el);
              removedElements.push({ element: el, parent, next });
              count++;
            }
          }
        }
      }
      return count;
    }

    function prepareCapture() {
      const html = document.documentElement;
      const body = document.body;

      originalState = {
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        htmlOverflow: html.style.overflow,
        bodyOverflow: body.style.overflow,
        htmlScrollBehavior: html.style.scrollBehavior,
      };

      html.style.scrollBehavior = 'auto';

      // Hide scrollbars
      const styleEl = document.createElement('style');
      styleEl.id = 'scrdwn-capture-styles';
      styleEl.textContent = `
        ::-webkit-scrollbar { display: none !important; }
        * { scrollbar-width: none !important; }
      `;
      document.head.appendChild(styleEl);

      // Initial purge
      removedElements = [];
      const count = purgeFixedElements();

      return { fixedElementCount: count };
    }

    function scrollTo(x, y) {
      window.scrollTo(x, y);
      return {
        actualX: window.scrollX,
        actualY: window.scrollY,
      };
    }

    function handleFixedElements() {
      // Re-scan and remove any NEW fixed/sticky elements
      // that the site's JS may have created after scroll
      purgeFixedElements();
    }

    function restorePage() {
      if (!originalState) return;

      // Re-insert ALL removed elements in reverse order
      for (let i = removedElements.length - 1; i >= 0; i--) {
        const info = removedElements[i];
        try {
          if (info.next && info.next.parentNode === info.parent) {
            info.parent.insertBefore(info.element, info.next);
          } else {
            info.parent.appendChild(info.element);
          }
        } catch (e) {
          try { document.body.appendChild(info.element); } catch (_) {}
        }
      }
      removedElements = [];

      const html = document.documentElement;
      const body = document.body;

      window.scrollTo(originalState.scrollX, originalState.scrollY);
      html.style.overflow = originalState.htmlOverflow;
      body.style.overflow = originalState.bodyOverflow;
      html.style.scrollBehavior = originalState.htmlScrollBehavior;

      const styleEl = document.getElementById('scrdwn-capture-styles');
      if (styleEl) styleEl.remove();

      originalState = null;
    }

    window._scrdwnReset = function () {
      restorePage();
    };

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      try {
        switch (message.action) {
          case 'getDimensions':
            sendResponse({ success: true, data: getPageDimensions() });
            break;
          case 'prepareCapture':
            sendResponse({ success: true, data: prepareCapture() });
            break;
          case 'scrollTo':
            sendResponse({ success: true, data: scrollTo(message.x, message.y) });
            break;
          case 'handleFixed':
            handleFixedElements();
            sendResponse({ success: true });
            break;
          case 'restore':
            restorePage();
            sendResponse({ success: true });
            break;
          default:
            sendResponse({ success: false, error: 'Unknown action' });
        }
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
    });
  })();
}
