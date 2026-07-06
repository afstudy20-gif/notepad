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

    // ===== Color picker (EyeDropper) =====
    async function pickColor() {
      if (typeof EyeDropper === 'undefined') {
        showColorPanel({ error: 'Eyedropper bu tarayıcıda desteklenmiyor (Chrome 95+ / Edge gerekir).' });
        return;
      }
      try {
        const result = await new EyeDropper().open();
        if (result?.sRGBHex) showColorPanel({ hex: result.sRGBHex });
      } catch (err) {
        // User cancelled — stay silent.
        if (err?.name === 'AbortError') return;
        // No user gesture carried over from the context-menu click: inject a
        // clickable trigger so a genuine gesture can launch the picker.
        if (err?.name === 'NotAllowedError' || /gesture|activation/i.test(err?.message || '')) {
          injectColorPickerTrigger();
          return;
        }
        showColorPanel({ error: err?.message || 'Renk seçilemedi.' });
      }
    }

    function injectColorPickerTrigger() {
      removeColorPickerTrigger();
      const btn = document.createElement('button');
      btn.id = 'np-color-trigger';
      btn.type = 'button';
      btn.textContent = '🎨 Renk seçmek için tıkla';
      btn.addEventListener('click', async () => {
        removeColorPickerTrigger();
        try {
          const result = await new EyeDropper().open();
          if (result?.sRGBHex) showColorPanel({ hex: result.sRGBHex });
        } catch (err) {
          if (err?.name === 'AbortError') return;
          showColorPanel({ error: err?.message || 'Renk seçilemedi.' });
        }
      });
      document.body.appendChild(btn);
      // Auto-dismiss the trigger if the user ignores it.
      setTimeout(removeColorPickerTrigger, 15000);
    }

    function removeColorPickerTrigger() {
      document.getElementById('np-color-trigger')?.remove();
    }

    function hexToRgb(hex) {
      const clean = String(hex || '').replace('#', '').trim();
      const full = clean.length === 3
        ? clean.split('').map((c) => c + c).join('')
        : clean;
      const num = parseInt(full, 16);
      if (!Number.isFinite(num) || full.length !== 6) return null;
      return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
    }

    function rgbToHsl(r, g, b) {
      const rn = r / 255, gn = g / 255, bn = b / 255;
      const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
      const l = (max + min) / 2;
      let h = 0, s = 0;
      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
          case gn: h = (bn - rn) / d + 2; break;
          default: h = (rn - gn) / d + 4;
        }
        h *= 60;
      }
      return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
    }

    function showColorPanel({ hex, error }) {
      removeColorPanel();
      removeColorPickerTrigger();

      ensureColorPanelStyles();

      const overlay = document.createElement('div');
      overlay.id = 'np-color-overlay';

      const card = document.createElement('div');
      card.id = 'np-color-card';
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-label', 'Seçilen renk');

      if (error) {
        card.innerHTML = `
          <div class="np-color-header">
            <strong>🎨 Renk Seçici</strong>
            <button type="button" class="np-color-close" aria-label="Kapat">&times;</button>
          </div>
          <div class="np-color-error"></div>`;
        card.querySelector('.np-color-error').textContent = error;
      } else {
        const rgb = hexToRgb(hex) || { r: 0, g: 0, b: 0 };
        const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
        const rgbStr = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
        const hslStr = `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
        const rows = [
          { label: 'HEX', value: hex.toLowerCase() },
          { label: 'RGB', value: rgbStr },
          { label: 'HSL', value: hslStr }
        ];
        card.innerHTML = `
          <div class="np-color-header">
            <strong>🎨 Seçilen Renk</strong>
            <button type="button" class="np-color-close" aria-label="Kapat">&times;</button>
          </div>
          <div class="np-color-swatch"></div>
          <div class="np-color-rows"></div>`;
        card.querySelector('.np-color-swatch').style.background = hex;
        const rowsEl = card.querySelector('.np-color-rows');
        for (const row of rows) {
          const el = document.createElement('button');
          el.type = 'button';
          el.className = 'np-color-row';
          el.innerHTML = `<span class="np-color-label"></span><span class="np-color-value"></span><span class="np-color-cue">Kopyala</span>`;
          el.querySelector('.np-color-label').textContent = row.label;
          el.querySelector('.np-color-value').textContent = row.value;
          el.addEventListener('click', async () => {
            const cue = el.querySelector('.np-color-cue');
            try {
              await navigator.clipboard.writeText(row.value);
              cue.textContent = '✓ Kopyalandı';
            } catch (_) {
              cue.textContent = 'Kopyalanamadı';
            }
            setTimeout(() => { cue.textContent = 'Kopyala'; }, 1500);
          });
          rowsEl.appendChild(el);
        }
      }

      overlay.appendChild(card);
      overlay.addEventListener('click', (ev) => { if (ev.target === overlay) removeColorPanel(); });
      card.querySelector('.np-color-close').addEventListener('click', removeColorPanel);
      document.body.appendChild(overlay);
    }

    function ensureColorPanelStyles() {
      if (document.getElementById('np-color-styles')) return;
      const style = document.createElement('style');
      style.id = 'np-color-styles';
      style.textContent = `
        #np-color-trigger{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);
          z-index:2147483646;padding:10px 16px;border:0;border-radius:10px;cursor:pointer;
          font:600 13px/1.2 system-ui,-apple-system,sans-serif;color:#fff;
          background:linear-gradient(135deg,#4361ee,#3a0ca3);box-shadow:0 6px 18px rgba(67,97,238,.35);}
        #np-color-overlay{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;
          justify-content:center;background:rgba(2,6,23,.5);backdrop-filter:blur(2px);}
        #np-color-card{width:280px;max-width:calc(100vw - 24px);background:#0f172a;color:#f8fafc;
          border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px;
          box-shadow:0 24px 60px rgba(0,0,0,.5);font:13px/1.4 system-ui,-apple-system,sans-serif;}
        .np-color-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}
        .np-color-header strong{font-size:13px;font-weight:800;letter-spacing:.3px;}
        .np-color-close{background:transparent;border:0;color:#94a3b8;font-size:20px;line-height:1;
          cursor:pointer;padding:0 4px;border-radius:6px;}
        .np-color-close:hover{color:#f8fafc;background:rgba(255,255,255,.08);}
        .np-color-swatch{height:64px;border-radius:10px;margin-bottom:10px;
          border:1px solid rgba(255,255,255,.12);box-shadow:inset 0 0 0 1px rgba(0,0,0,.2);}
        .np-color-rows{display:flex;flex-direction:column;gap:6px;}
        .np-color-row{display:grid;grid-template-columns:38px 1fr auto;align-items:center;gap:8px;
          padding:8px 10px;border:1px solid rgba(255,255,255,.06);border-radius:8px;cursor:pointer;
          background:rgba(30,41,59,.4);color:#f1f5f9;text-align:left;transition:all .15s;font:inherit;}
        .np-color-row:hover{background:rgba(30,41,59,.7);border-color:rgba(67,97,238,.5);}
        .np-color-label{font-size:10px;font-weight:800;letter-spacing:.6px;color:#64748b;text-transform:uppercase;}
        .np-color-value{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;}
        .np-color-cue{font-size:11px;font-weight:700;color:#93c5fd;}
        .np-color-error{padding:10px;border-radius:8px;background:rgba(239,68,68,.12);
          border:1px solid rgba(239,68,68,.3);color:#fca5a5;font-size:12px;}
      `;
      document.head.appendChild(style);
    }

    function removeColorPanel() {
      document.getElementById('np-color-overlay')?.remove();
    }

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
          case 'pickColor':
            sendResponse({ success: true });
            pickColor();
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
