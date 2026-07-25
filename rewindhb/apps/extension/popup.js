document.addEventListener('DOMContentLoaded', async () => {
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const lastTitle = document.getElementById('last-capture-title');
  const lastUrl = document.getElementById('last-capture-url');
  const lastTime = document.getElementById('last-capture-time');
  const btnTogglePause = document.getElementById('btn-toggle-pause');
  const btnCaptureNow = document.getElementById('btn-capture-now');
  const btnOpenSpotlight = document.getElementById('btn-open-spotlight');
  const apiUrlInput = document.getElementById('api-url-input');
  const btnSaveApi = document.getElementById('btn-save-api');

  // Load state from service worker / chrome.storage
  try {
    const status = await chrome.runtime.sendMessage({ type: 'RECALLOS_GET_STATUS' });
    if (status) {
      apiUrlInput.value = status.apiUrl || 'http://localhost:8000';
      updatePauseUI(status.paused);
      if (status.lastCapture) {
        updateLastCaptureUI(status.lastCapture);
      }
    }
  } catch (e) {
    const settings = await chrome.storage.local.get(['recallos:settings', 'recallos:last-capture']);
    const userSettings = settings['recallos:settings'] || {};
    apiUrlInput.value = userSettings.api_url || 'http://localhost:8000';
    updatePauseUI(userSettings.capture_paused || false);
    if (settings['recallos:last-capture']) {
      updateLastCaptureUI(settings['recallos:last-capture']);
    }
  }

  function updatePauseUI(isPaused) {
    if (isPaused) {
      statusDot.className = 'status-dot paused';
      statusText.textContent = 'Paused';
      btnTogglePause.textContent = 'Resume Capture';
    } else {
      statusDot.className = 'status-dot';
      statusText.textContent = 'Active';
      btnTogglePause.textContent = 'Pause Capture';
    }
  }

  function updateLastCaptureUI(lastCapture) {
    if (lastCapture && (lastCapture.title || lastCapture.url)) {
      lastTitle.textContent = lastCapture.title || lastCapture.url;
      lastUrl.textContent = lastCapture.url || '';
      if (lastCapture.at) {
        const date = new Date(lastCapture.at);
        lastTime.textContent = 'Captured at ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    }
  }

  btnTogglePause.addEventListener('click', async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'RECALLOS_TOGGLE_PAUSE' });
      updatePauseUI(res.paused);
    } catch (err) {
      const settings = await chrome.storage.local.get('recallos:settings');
      const s = settings['recallos:settings'] || {};
      s.capture_paused = !s.capture_paused;
      await chrome.storage.local.set({ 'recallos:settings': s });
      updatePauseUI(s.capture_paused);
    }
  });

  btnCaptureNow.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;

    const tabUrl = tab.url || '';
    if (tabUrl.startsWith('chrome://') || tabUrl.startsWith('chrome-extension://') || tabUrl.startsWith('edge://') || tabUrl.startsWith('about:')) {
      btnCaptureNow.textContent = 'Restricted Page';
      setTimeout(() => { btnCaptureNow.textContent = 'Capture Page'; }, 2500);
      return;
    }

    btnCaptureNow.textContent = 'Capturing...';

    try {
      let payload = null;
      try {
        const extractRes = await chrome.tabs.sendMessage(tab.id, { type: 'RECALLOS_TRIGGER_EXTRACTION' });
        if (extractRes && extractRes.ok && extractRes.payload) {
          payload = extractRes.payload;
        }
      } catch (e) {
        console.log('[RecallOS Popup] content script sendMessage failed, using tab metadata fallback:', e);
      }

      if (!payload) {
        payload = {
          url: tab.url,
          title: tab.title || tab.url,
          excerpt: tab.title || tab.url,
          faviconUrl: tab.favIconUrl || null,
          contentType: 'web',
          wordCount: (tab.title || '').split(/\s+/).length,
          force: true
        };
      } else {
        payload.force = true;
      }

      console.log('[RecallOS Popup] Sending capture payload to SW:', payload);

      const swRes = await chrome.runtime.sendMessage({ type: 'RECALLOS_CAPTURE', payload });
      console.log('[RecallOS Popup] Service Worker Response:', swRes);

      if (swRes?.status === 'success' || swRes?.status === 'queued' || swRes?.status === 'updated' || swRes?.status === 'processing') {
        btnCaptureNow.textContent = 'Captured!';
        updateLastCaptureUI({ title: payload.title, url: payload.url, at: new Date().toISOString() });
      } else if (swRes?.status === 'duplicate' || swRes?.reason === 'duplicate') {
        btnCaptureNow.textContent = 'Already Captured';
      } else if (swRes?.status === 'paused' || swRes?.reason === 'paused') {
        btnCaptureNow.textContent = 'Capture Paused';
      } else if (swRes?.status === 'blocklist' || swRes?.reason === 'blocklist') {
        btnCaptureNow.textContent = 'Domain Blocked';
      } else if (swRes?.reason === 'browser_noise' || swRes?.reason === 'invalid_payload') {
        btnCaptureNow.textContent = 'System Page';
      } else {
        const errMsg = swRes?.error || swRes?.message || 'API Error';
        console.error('[RecallOS Popup] Capture error:', errMsg, swRes);
        btnCaptureNow.textContent = errMsg.length > 22 ? errMsg.slice(0, 20) + '...' : errMsg;
      }

      setTimeout(() => { btnCaptureNow.textContent = 'Capture Page'; }, 2500);
    } catch (err) {
      console.error('[RecallOS Popup] Exception:', err);
      btnCaptureNow.textContent = 'Restricted Page';
      setTimeout(() => { btnCaptureNow.textContent = 'Capture Page'; }, 2500);
    }
  });

  btnOpenSpotlight.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RECALLOS_OPEN_SPOTLIGHT' });
  });

  btnSaveApi.addEventListener('click', async () => {
    const url = apiUrlInput.value.trim() || 'http://localhost:8000';
    try {
      await chrome.runtime.sendMessage({ type: 'RECALLOS_SET_API_URL', url });
    } catch (e) {
      const settings = await chrome.storage.local.get('recallos:settings');
      const s = settings['recallos:settings'] || {};
      s.api_url = url;
      await chrome.storage.local.set({ 'recallos:settings': s });
    }
    btnSaveApi.textContent = 'Saved!';
    setTimeout(() => { btnSaveApi.textContent = 'Save'; }, 1500);
  });
});
