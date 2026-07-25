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
    handleCapture(msg.payload).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
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
  if (!payload || !payload.url) return { skipped: true };

  if (await isOnBlocklist(payload.url)) return { skipped: true, reason: 'blocklist' };
  if (await isDuplicate(payload.url)) return { skipped: true, reason: 'duplicate' };

  const settings = await getSettings();
  if (settings.capture_paused) return { skipped: true, reason: 'paused' };

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

  try {
    const res = await fetch(`${apiUrl}/v1/memories`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    await chrome.storage.local.set({ [LAST_CAPTURE_KEY]: { id: data.memory_id || 'mem_' + Date.now(), at: visited_at, url: payload.url, title: payload.title } });
    return data;
  } catch (e) {
    await enqueueOffline(body);
    await chrome.storage.local.set({ [LAST_CAPTURE_KEY]: { id: 'offline_' + Date.now(), at: visited_at, url: payload.url, title: payload.title } });
    return { queued: true };
  }
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
