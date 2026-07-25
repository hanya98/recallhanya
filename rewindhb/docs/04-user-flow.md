# User Flow

## Flow A — Onboarding (first 90 seconds)

```
[1] Install extension from Chrome Web Store
    ↓
[2] Extension popup → "Welcome to RecallOS"
    - One sentence: "We remember what you browse. Search with words."
    - "Sign in with Google" CTA
    ↓
[3] OAuth → returns to popup → "All set. Open the dashboard."
    - "Try a search" CTA
    ↓
[4] First-time user browses 3-5 pages normally.
    Extension silently snapshots each.
    ↓
[5] User opens dashboard.app.recallos.com
    - Empty state: "You have 5 memories. Try searching."
    - Search bar pre-focused.
```

## Flow B — The Core Loop (the one that matters)

```
[User types in spotlight: "react auth repo last week"]

  ↓
[Spotlight returns, in <300ms:]
  - Top result: GitHub → "nextauthjs/next-auth" — AI summary card
  - 3 related: a blog post, a YouTube tutorial, a StackOverflow answer
  - "Open" button on each → reopens tab

  ↓
[User clicks "Open" → tab opens → user is back where they left off]
```

## Flow C — Context Resume

```
[User: "Continue my AI research"]
  ↓
[Dashboard switches to a Smart Collection view: "AI Research — 14 memories"]
  - Memory cards arranged by date
  - Top: "Resume session" CTA
    "Reopen the 6 tabs you had open last night"
  ↓
[Click → extension API calls chrome.tabs.create() for each URL in cluster]
```

## Flow D — Memory Capture (passive, the user never thinks about this)

```
[User opens any page]
  ↓
[Extension content script fires on document_idle]
  - Reads title, URL, meta description, first 4000 chars of text
  - Skips if URL matches blocklist (banking, gmail, etc.)
  - Skips if user is in private/incognito mode
  ↓
[POST /v1/memories with payload]
  ↓
[Server enqueues: extract → embed → summarize → classify → store]
  ↓
[<2s later: memory is queryable]
```

## Flow E — Smart Collection generation

```
[Every 24h, OR on demand:]
  - Cluster recent memories by embedding similarity
  - LLM proposes 3-7 collection titles + 1-sentence descriptions
  - User is shown "New collections" toast: "We grouped 12 memories into 'AI Research'"
  - User can rename, merge, or delete collections
```

## Flow F — Privacy kill switch

```
[Extension popup → "Pause capture" toggle]
  - Extension stops POSTing
  - Existing memories still searchable
  ↓
[Settings → "Delete all memories" → confirmation → wipe]
```

## Flow G — Onboarding empty states

| When                                | Empty state                                                |
|-------------------------------------|------------------------------------------------------------|
| First open, 0 memories              | "Browse a few pages. We'll remember them. Search anything." |
| 5 memories, no search history       | "5 memories indexed. Try: 'the React thing I read today.'" |
| 100 memories, no collections        | "We noticed clusters. Tap 'Group into collections.'"       |
| Search with zero results            | "Nothing matches yet. Try fewer words or a different angle." |
