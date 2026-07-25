# Memory Snapshot Architecture

## What we keep, what we throw away

For each page visited, we generate one **memory snapshot** — a deliberately compact record.

```
RAW PAGE (~500KB HTML, scripts, ads, nav, footer)
        │
        │   extractor.ts strips:  scripts, styles, nav, header,
        │                          footer, aside, [aria-hidden],
        │                          iframes, comments
        ▼
CLEANED TEXT (~3-8KB, the actual readable content)
        │
        │   extract first 4000 chars + title + url + favicon
        ▼
SNAPSHOT (~6KB total on average)
        │
        │   stored in Postgres as `memories` row
        │   excerpt_clean field capped at 4000 chars
        ▼
PROCESSED SNAPSHOT (~8KB total)
        │
        │   + summary (≤ 280 chars)
        │   + tags (≤ 8)
        │   + category (1)
        │   + embedding (1536 floats = 6KB binary)
        ▼
INDEXED MEMORY (queryable, ~14KB in Postgres)
```

We never store the raw HTML. The original URL is enough to "reopen" — and we re-fetch only when the user clicks.

## Schema recap (snapshot fields)

```sql
CREATE TABLE memories (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL,
  url             TEXT NOT NULL,
  domain          TEXT NOT NULL,                  -- extracted
  title           TEXT NOT NULL,
  excerpt_clean   TEXT NOT NULL,                  -- ≤ 4000 chars
  summary         TEXT,                           -- AI summary, 1-2 sentences
  category        TEXT,                           -- 1 of 12
  tags            TEXT[],                         -- ≤ 8
  embedding       vector(1536),                   -- 6KB binary
  favicon_url     TEXT,
  content_type    TEXT,
  word_count      INT,
  language        TEXT,
  visited_at      TIMESTAMPTZ NOT NULL,
  indexed_at      TIMESTAMPTZ NOT NULL,
  processing_status TEXT NOT NULL,                -- processing | ready | failed
  pinned          BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at      TIMESTAMPTZ
);
```

## Processing pipeline

When a snapshot lands in `memories` with `processing_status='processing'`, a worker:

```
1.  Generate summary
    model:      gemini-2.0-flash
    prompt:     "Summarize the following web page in 1-2 sentences.
                 Be specific — name the actual topic, technology, or claim.
                 Page title: {title}
                 First 4000 chars: {excerpt_clean}"
    output:     string, 80–280 chars
    fallback:   first 2 sentences of excerpt_clean
    cost:       ~$0.000075 per call

2.  Classify into one of 12 categories
    model:      gemini-2.0-flash (same call as #1 if we batch)
    categories: ['repo','article','video','doc','recipe','paper',
                 'social','shopping','email','forum','news','other']
    output:     single string
    fallback:   'other'
    cost:       included in #1

3.  Extract 3-8 tags
    model:      gemini-2.0-flash (same call as #1)
    output:     JSON array of lowercase strings
    fallback:   empty array
    cost:       included in #1

4.  Generate embedding
    model:      text-embedding-3-small
    input:      title + " " + summary + " " + first 500 chars of excerpt_clean
    output:     1536-dim float vector
    cost:       ~$0.00002 per call

5.  Compute read_time, word_count, language
    cost:       free, computed locally

6.  UPDATE memories SET summary=..., category=..., tags=...,
                         embedding=..., word_count=..., read_time_sec=...,
                         processing_status='ready'
      WHERE id = $1;
```

All five model steps typically batch into **one** LLM call with structured output. Total per-snapshot processing cost is **~$0.0001**.

## Why this shape

- **No raw HTML** — privacy, storage, legal.
- **Cleaned excerpt capped at 4000 chars** — enough context for LLM, doesn't blow storage.
- **Summary is the primary surface** — users almost never read the excerpt; the summary is what they recall by.
- **Embedding is on title + summary + first 500 chars of excerpt** — captures concept without bloat.
- **`pinned` field** — users can pin a memory to keep it out of auto-deletion.

## Retention

- Default: memories kept indefinitely.
- User can delete individually or in bulk.
- After 30 days in `deleted_at`, a cron hard-deletes.
- Free tier cap: 5,000 memories per user. Beyond that, oldest non-pinned memories are auto-archived (still searchable in summary, but moved to cold storage).
