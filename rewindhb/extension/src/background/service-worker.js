// RecallOS Chrome Extension — Service Worker
// Receives captures from content scripts, dedupes, and POSTs to API (default http://localhost:8000).

const DEFAULT_API_URL = 'http://localhost:8000';
const OFFLINE_QUEUE_KEY = 'recallos:offline-queue';
const LAST_CAPTURE_KEY = 'recallos:last-capture';
const SETTINGS_KEY = 'recallos:settings';

// ============================================================
// MESSAGE HANDLER
// ============================================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'RECALLOS_CAPTURE') {
    handleCapture(msg.payload).then(res => {
      console.log('[RecallOS SW] Capture processed:', res);
      sendResponse(res);
    }).catch(err => {
      console.error('[RecallOS SW] Capture error:', err);
      sendResponse({ status: 'error', error: err.message });
    });
    return true; // async response
  }
  if (msg?.type === 'RECALLOS_OPEN_SPOTLIGHT') {
    openSpotlight();
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === 'RECALLOS_GET_STATUS') {
    getStatus().then(sendResponse);
    return true;
  }
  if (msg?.type === 'RECALLOS_TOGGLE_PAUSE') {
    togglePause().then(sendResponse);
    return true;
  }
  if (msg?.type === 'RECALLOS_SET_API_URL') {
    setApiUrl(msg.url).then(sendResponse);
    return true;
  }
  return false;
});

// ============================================================
// COMMAND HANDLER
// ============================================================
chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === 'open-spotlight') openSpotlight();
});

// ============================================================
// ALARM — periodic offline flush
// ============================================================
chrome.alarms.create('recallos-flush', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(a => {
  if (a.name === 'recallos-flush') flushOfflineQueue();
});

// ============================================================
// CAPTURE
// ============================================================
async function handleCapture(payload) {
  if (!payload || !payload.url) return { status: 'skipped', reason: 'invalid_payload' };

  if (isBrowserNoise(payload.url)) return { status: 'skipped', reason: 'browser_noise' };
  if (await isOnBlocklist(payload.url)) return { status: 'skipped', reason: 'blocklist' };

  const isManual = !!payload.force;
  if (!isManual && await isDuplicate(payload.url)) {
    return { status: 'duplicate', reason: 'duplicate' };
  }

  const settings = await getSettings();
  if (settings.capture_paused) return { status: 'skipped', reason: 'paused' };

  const visited_at = new Date().toISOString();
  const dedup_key = await sha256(payload.url + bucketMinute(new Date()));

  const body = {
    url: payload.url,
    title: payload.title,
    excerpt: payload.excerpt,
    favicon_url: payload.faviconUrl ?? null,
    visited_at,
    content_type: payload.contentType ?? null,
    word_count: payload.wordCount ?? null,
    language: payload.language ?? null,
    dedup_key
  };

  const apiUrl = settings.api_url || DEFAULT_API_URL;
  console.log(`[RecallOS SW] POSTing to ${apiUrl}/v1/memories for URL: ${payload.url}`);

  try {
    const res = await fetch(`${apiUrl}/v1/memories`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[RecallOS SW] Backend API Error ${res.status}:`, errText);
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 100)}`);
    }
    const data = await res.json();
    console.log('[RecallOS SW] Backend Response:', data);

    await chrome.storage.local.set({
      [LAST_CAPTURE_KEY]: {
        id: data.memory_id || 'mem_' + Date.now(),
        at: visited_at,
        url: payload.url,
        title: payload.title
      }
    });

    return { status: 'success', memory_id: data.memory_id, data };
  } catch (e) {
    console.warn('[RecallOS SW] API call failed, queueing offline:', e.message);
    await enqueueOffline(body);
    await chrome.storage.local.set({
      [LAST_CAPTURE_KEY]: {
        id: 'offline_' + Date.now(),
        at: visited_at,
        url: payload.url,
        title: payload.title
      }
    });
    return { status: 'queued', error: e.message };
  }
}

function isBrowserNoise(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  if (lower.startsWith('blob:') || lower.startsWith('chrome:') || lower.startsWith('chrome-extension:') || lower.startsWith('edge:')) return true;
  if (lower.includes('collector.github.com') || lower.includes('youtube.com/api/stats') || lower.includes('google-analytics.com')) return true;
  if (lower.includes('.mp4') || lower.includes('.webm') || lower.includes('m3u8') || lower.includes('mediasource')) return true;
  return false;
}

async function getStatus() {
  const settings = await getSettings();
  const { [LAST_CAPTURE_KEY]: lastCapture = null, [OFFLINE_QUEUE_KEY]: queue = [] } = await chrome.storage.local.get([LAST_CAPTURE_KEY, OFFLINE_QUEUE_KEY]);
  return {
    paused: !!settings.capture_paused,
    apiUrl: settings.api_url || DEFAULT_API_URL,
    lastCapture,
    queuedCount: queue.length
  };
}

async function togglePause() {
  const settings = await getSettings();
  settings.capture_paused = !settings.capture_paused;
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return { paused: settings.capture_paused };
}

async function setApiUrl(url) {
  const settings = await getSettings();
  settings.api_url = url || DEFAULT_API_URL;
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return { apiUrl: settings.api_url };
}

async function flushOfflineQueue() {
  const { [OFFLINE_QUEUE_KEY]: queue } = await chrome.storage.local.get(OFFLINE_QUEUE_KEY);
  if (!queue || queue.length === 0) return;
  const settings = await getSettings();
  const apiUrl = settings.api_url || DEFAULT_API_URL;
  const remaining = [];
  for (const body of queue) {
    try {
      const res = await fetch(`${apiUrl}/v1/memories`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify(body)
      });
      if (!res.ok) remaining.push(body);
    } catch (e) {
      remaining.push(body);
    }
  }
  await chrome.storage.local.set({ [OFFLINE_QUEUE_KEY]: remaining });
}

async function enqueueOffline(body) {
  const { [OFFLINE_QUEUE_KEY]: queue = [] } = await chrome.storage.local.get(OFFLINE_QUEUE_KEY);
  queue.push(body);
  if (queue.length > 500) queue.shift();
  await chrome.storage.local.set({ [OFFLINE_QUEUE_KEY]: queue });
}

// ============================================================
// HELPERS
// ============================================================
async function authHeaders() {
  const { [SETTINGS_KEY]: settings = {} } = await chrome.storage.local.get(SETTINGS_KEY);
  const headers = { 'Content-Type': 'application/json' };
  if (settings.jwt) headers['Authorization'] = `Bearer ${settings.jwt}`;
  return headers;
}

async function getSettings() {
  const { [SETTINGS_KEY]: settings = {} } = await chrome.storage.local.get(SETTINGS_KEY);
  return {
    api_url: DEFAULT_API_URL,
    capture_paused: false,
    blocklist_domains: [],
    ...settings
  };
}

async function isOnBlocklist(url) {
  try {
    const settings = await getSettings();
    const host = new URL(url).hostname;
    const default_block = ['bank', 'health', 'mail.google', 'accounts.google'];
    if (default_block.some(d => host.includes(d))) return true;
    if (settings.blocklist_domains?.some(d => host.includes(d))) return true;
    return false;
  } catch {
    return false;
  }
}

async function isDuplicate(url) {
  const minute = bucketMinute(new Date());
  const key = `recallos:seen:${url}:${minute}`;
  const { [key]: seen } = await chrome.storage.local.get(key);
  if (seen) return true;
  await chrome.storage.local.set({ [key]: true });
  setTimeout(() => chrome.storage.local.remove(key), 5 * 60 * 1000);
  return false;
}

function bucketMinute(d) {
  return Math.floor(d.getTime() / 60_000);
}

async function sha256(s) {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function openSpotlight() {
  chrome.tabs.create({ url: chrome.runtime.getURL('spotlight.html') });
}
