# Chrome Extension Architecture

## Manifest V3 — top level

```json
{
  "manifest_version": 3,
  "name": "RecallOS — remember everything you browse",
  "version": "0.1.0",
  "description": "An AI second brain that remembers what you browse. Search with words.",
  "icons": {
    "16": "icons/16.png",
    "48": "icons/48.png",
    "128": "icons/128.png"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": "icons/16.png"
  },
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },
  "permissions": [
    "storage",
    "activeTab",
    "tabs",
    "alarms"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content/extractor.js"],
      "run_at": "document_idle",
      "all_frames": false
    }
  ],
  "commands": {
    "_execute_action": {
      "suggested_key": { "default": "Ctrl+Shift+K", "mac": "Command+Shift+K" }
    },
    "open-spotlight": {
      "suggested_key": { "default": "Ctrl+K", "mac": "Command+K" },
      "description": "Open RecallOS Spotlight"
    }
  },
  "web_accessible_resources": [
    { "resources": ["spotlight/spotlight.html"], "matches": ["<all_urls>"] }
  ],
  "oauth2": {
    "client_id": "...",
    "scopes": ["openid", "email", "profile"]
  }
}
```

## Component diagram

```
┌──────────────────────────────────────────────────────┐
│                 CHROME BROWSER                        │
│                                                       │
│  ┌───────────────────────────────────────────────┐   │
│  │  Content Script (extractor.js)                │   │
│  │  injected into every page                     │   │
│  │                                               │   │
│  │  • runs on document_idle                      │   │
│  │  • extracts title, URL, text                  │   │
│  │  • sends to background via runtime.sendMessage│   │
│  └────────────────────┬──────────────────────────┘   │
│                       │                              │
│                       ▼                              │
│  ┌───────────────────────────────────────────────┐   │
│  │  Service Worker (background/service-worker.js)│   │
│  │                                               │   │
│  │  • receives captures from content scripts     │   │
│  │  • applies blocklist, dedup                   │   │
│  │  • POSTs to /v1/memories                      │   │
│  │  • queues offline captures                    │   │
│  │  • listens for chrome.commands                │   │
│  │  • listens for chrome.alarms (periodic flush) │   │
│  │  • reads settings from chrome.storage         │   │
│  └────────────────────┬──────────────────────────┘   │
│                       │                              │
│         ┌─────────────┴──────────────┐               │
│         ▼                            ▼               │
│  ┌──────────────────┐      ┌──────────────────────┐ │
│  │ Popup (popup.html)│      │ Spotlight overlay   │ │
│  │                   │      │ (spotlight.html)    │ │
│  │ • status          │      │                     │ │
│  │ • pause toggle    │      │ • ⌘K to open       │ │
│  │ • last capture    │      │ • search bar        │ │
│  │ • quick search    │      │ • results inline    │ │
│  └──────────────────┘      └──────────────────────┘ │
│                                                       │
└──────────────────────────────────────────────────────┘
```

## Content script — what it captures

```ts
// content/extractor.ts

type Extraction = {
  url: string
  title: string
  excerpt: string
  faviconUrl: string | null
  contentType: string | null
  wordCount: number
  language: string | null
};

export function extract(): Extraction | null {
  // Skip iframes, PDF viewers, etc.
  if (window !== window.top) return null;
  if (document.contentType?.startsWith('image/')) return null;

  const title = document.title?.trim();
  const url = location.href;
  if (!title || !url) return null;

  // Strip junk
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(
    'script, style, nav, header, footer, aside, [aria-hidden="true"]'
  ).forEach(n => n.remove());

  // Visible text only, take first 4000 chars
  const text = (clone.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
  if (text.length < 50) return null; // skip near-empty pages

  // Favicon — try a few sources
  const faviconUrl =
    document.querySelector<HTMLLinkElement>('link[rel*="icon"]')?.href ??
    `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`;

  return {
    url,
    title,
    excerpt: text,
    faviconUrl,
    contentType: document.contentType,
    wordCount: text.split(/\s+/).length,
    language: document.documentElement.lang ?? null
  };
}

chrome.runtime.sendMessage({ type: 'RECALLOS_CAPTURE', payload: extract() });
```

## Service worker — the orchestrator

```ts
// background/service-worker.ts

const API = 'https://api.recallos.com';
const OFFLINE_QUEUE_KEY = 'recallos:offline-queue';
const LAST_CAPTURE_KEY = 'recallos:last-capture';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'RECALLOS_CAPTURE') {
    handleCapture(msg.payload).then(sendResponse);
    return true; // async response
  }
});

chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === 'open-spotlight') openSpotlight();
});

chrome.alarms.create('recallos-flush', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(a => {
  if (a.name === 'recallos-flush') flushOfflineQueue();
});

async function handleCapture(payload: CapturePayload) {
  // Skip noisy surfaces
  if (await isOnBlocklist(payload.url)) return { skipped: true };
  if (await isDuplicate(payload.url)) return { skipped: true, reason: 'duplicate' };
  if (await isIncognito()) return { skipped: true, reason: 'incognito' };

  const settings = await getSettings();
  if (settings.capture_paused) return { skipped: true, reason: 'paused' };

  const body = {
    url: payload.url,
    title: payload.title,
    excerpt: payload.excerpt,
    favicon_url: payload.faviconUrl,
    visited_at: new Date().toISOString(),
    content_type: payload.contentType,
    word_count: payload.wordCount,
    language: payload.language,
    dedup_key: await sha256(payload.url + bucketMinute(new Date()))
  };

  try {
    const res = await fetch(`${API}/v1/memories`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(body)
    });
    const data = await res.json();
    chrome.storage.local.set({ [LAST_CAPTURE_KEY]: data.memory_id });
    return data;
  } catch (e) {
    await enqueueOffline(body);
    return { queued: true };
  }
}
```

## Popup

Single small HTML. Shows:
- A status row (working / paused / offline).
- A "Pause capture" toggle.
- Last memory card (read-only preview).
- A big CTA: "Open Spotlight ⌘K" and "Open Dashboard ↗".

## Spotlight overlay

- Lives in `spotlight/spotlight.html`, injected into `<all_urls>` as a web-accessible resource.
- Open via `chrome.windows` / `chrome.tabs` create → small popup window or full-page tab.
- First implementation: **open in a new tab** (`chrome.tabs.create({ url: 'https://app.recallos.com/spotlight' })`). Simpler than an in-page overlay, plays nicely with Cmd+K via `chrome.commands`.

## Privacy controls in extension

- `chrome.storage.local` for settings, last capture, offline queue.
- Hard-coded blocklist: banking, health portals, email web clients, password managers.
- User can extend via Settings page.
- Pause switch in popup. Persisted to backend so settings sync across machines.

## Permissions rationale

| Permission           | Why                                                  |
|----------------------|------------------------------------------------------|
| `storage`            | Settings + offline queue                             |
| `activeTab`          | Read current tab on demand (manual capture trigger)  |
| `tabs`               | Required by `chrome.commands` to open Spotlight tab  |
| `alarms`             | Periodic offline-flush                               |
| `host_permissions: <all_urls>` | To capture every page you visit          |

We do **not** request `cookies`, `history`, `bookmarks`, `downloads`, or `geolocation`.
