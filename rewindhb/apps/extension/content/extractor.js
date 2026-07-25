// RecallOS Content Script — runs on every page at document_idle
// Extracts title, URL, visible text, and sends to background SW.

(function () {
  function extractAndSend() {
    try {
      // Skip iframes
      if (window !== window.top) return;

      // Skip obvious non-content surfaces
      const ct = document.contentType || '';
      if (ct.startsWith('image/') || ct === 'application/pdf') return;

      const title = (document.title || '').trim();
      const url = location.href;
      if (!title || !url) return;

      // Clean text — clone body, strip nav/scripts/etc.
      const clone = document.body.cloneNode(true);
      const junk = clone.querySelectorAll(
        'script, style, nav, header, footer, aside, [aria-hidden="true"], [role="navigation"], [role="banner"], [role="contentinfo"], noscript, iframe, svg'
      );
      junk.forEach(n => n.remove());

      const text = (clone.innerText || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 4000);

      if (text.length < 50) return; // too short

      const favicon =
        document.querySelector('link[rel*="icon"]')?.href ||
        `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`;

      const payload = {
        url,
        title,
        excerpt: text,
        faviconUrl: favicon,
        contentType: ct,
        wordCount: text.split(/\s+/).length,
        language: document.documentElement.lang || null
      };

      chrome.runtime.sendMessage({ type: 'RECALLOS_CAPTURE', payload });
    } catch (err) {
      // never throw in a content script
    }
  }

  // Auto extract on idle
  extractAndSend();

  // Listen for manual trigger from popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'RECALLOS_TRIGGER_EXTRACTION') {
      extractAndSend();
      sendResponse({ ok: true });
    }
  });
})();
