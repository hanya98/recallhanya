# Technical Architecture

## High-level

```
┌────────────────────┐    ┌──────────────────────┐
│  Chrome Extension  │    │   Web Dashboard      │
│  (Manifest V3)     │    │   (Next.js + TS)     │
│                    │    │                      │
│  content script    │    │  Spotlight (⌘K)     │
│  background SW     │    │  Timeline            │
│  popup             │    │  Memory detail       │
└────────┬───────────┘    │  Collections         │
         │                │  Graph               │
         │ HTTPS          └──────────┬───────────┘
         ▼                           │
┌────────────────────────────────────┴───────────┐
│              API (FastAPI, Python)              │
│                                                 │
│   POST /v1/memories  (capture)                  │
│   GET  /v1/memories  (list, filter)             │
│   POST /v1/search    (semantic + keyword)       │
│   GET  /v1/memories/:id                          │
│   GET  /v1/collections                           │
│   POST /v1/collections/:id/resume               │
│   GET  /v1/graph                                 │
│   DELETE /v1/memories/:id                        │
│   POST /v1/memories/bulk-delete                 │
│   PATCH /v1/settings                             │
└──────┬─────────────────────┬───────────────────┘
       │                     │
       ▼                     ▼
┌─────────────┐      ┌─────────────────┐
│  Postgres   │      │  pgvector       │
│  (users,    │      │  (embeddings    │
│   memories, │      │   + similarity) │
│   settings) │      │                 │
└─────────────┘      └─────────────────┘
       │
       ▼
┌─────────────────┐      ┌──────────────────┐
│  Redis          │      │  LLM providers   │
│  (rate limit,   │      │  - Gemini 2.0    │
│   queue,        │      │  - OpenAI        │
│   capture cache)│      │  Embedding API   │
└─────────────────┘      └──────────────────┘
```

## Why this stack

- **FastAPI** — async, fast, great typing. We need throughput (every page visit is a write).
- **Postgres + pgvector** — single source of truth. No Pinecone for MVP; pgvector is enough up to ~1M memories per user.
- **Redis** — capture queue + rate limiting + session resume cache.
- **Gemini 2.0 Flash** for summarization + classification (cheap, fast, good).
- **OpenAI `text-embedding-3-small`** for embeddings (1536-dim, cheap, strong).
- **Next.js 15** for dashboard — App Router, RSC where possible, client components for spotlight.
- **Manifest V3** for extension — required for new Chrome extensions in 2025+.

## Capture pipeline (the hot path)

```
1. Page loads in Chrome.
   Content script fires on document_idle.
2. Content script extracts:
   - title, URL, meta description
   - first 4000 chars of visible text
   - favicon URL
   - canonical URL (if present)
3. Background SW receives capture via chrome.runtime.sendMessage.
4. SW checks:
   - not in incognito? (Chrome API: chrome.extension.inIncognitoContext)
   - not on blocklist? (banking, email web clients, health portals)
   - capture paused? (from settings)
   - already seen this URL in last 60s? (dedup)
5. SW POSTs to API:  POST /v1/memories
   Payload: { url, title, text_excerpt, timestamp }
6. API:
   - authenticate (JWT from extension)
   - enqueue job in Redis (capture-queue)
   - return 202 { memory_id, status: "processing" }
7. Background worker consumes job:
   - generate embedding (OpenAI)
   - generate summary (Gemini, 2 sentences)
   - classify into category (Gemini, one of 12)
   - extract keywords (Gemini, 5 tags)
   - store in Postgres + pgvector
8. Memory is now queryable.

Target: end-to-end p95 < 3 seconds.
```

## Search pipeline (the user path)

```
1. User types in spotlight: "react auth repo last week"
2. Dashboard POSTs to /v1/search:
   { query, filters: { since: 7d } }
3. API:
   a. Embed query via OpenAI (one call)
   b. pgvector cosine similarity over user's memories,
      filtered by since-date
      → top 50 candidates in ~80ms
   c. Hybrid re-rank: combine vector score with BM25 keyword score
      from a Postgres tsvector column
      → top 10 in ~50ms more
   d. Optional: LLM re-rank top 10 with a "is this relevant to: <query>?" prompt
      → adds ~400ms, but lifts quality on ambiguous queries
4. API returns:
   { matches: [...], related: [...], session_resume_url?: "..." }
5. Dashboard renders spotlight results in < 50ms.

Target: end-to-end p95 < 400ms (no LLM re-rank).
         < 800ms (with LLM re-rank).
```

## Folder structure

```
recallos/
├── apps/
│   ├── web/                        # Next.js dashboard
│   │   ├── app/
│   │   │   ├── (marketing)/        # landing, /pricing, /about
│   │   │   ├── (app)/
│   │   │   │   ├── timeline/       # default dashboard
│   │   │   │   ├── memories/
│   │   │   │   ├── collections/
│   │   │   │   ├── graph/
│   │   │   │   └── settings/
│   │   │   ├── api/                # edge functions (auth callback)
│   │   │   ├── layout.tsx
│   │   │   └── globals.css
│   │   ├── components/
│   │   │   ├── spotlight/          # ⌘K
│   │   │   ├── memory-card/
│   │   │   ├── timeline/
│   │   │   ├── graph/              # force-graph viz
│   │   │   └── ui/                 # primitives (button, input, tag)
│   │   ├── lib/
│   │   │   ├── api.ts              # typed API client
│   │   │   ├── auth.ts             # NextAuth + Google
│   │   │   └── types.ts
│   │   └── public/
│   │
│   └── extension/                  # Chrome extension (Manifest V3)
│       ├── src/
│       │   ├── content/
│       │   │   └── extractor.ts    # pulls text from page
│       │   ├── background/
│       │   │   ├── service-worker.ts
│       │   │   └── capture.ts
│       │   ├── popup/
│       │   │   ├── popup.html
│       │   │   └── popup.tsx
│       │   └── lib/
│       │       ├── api.ts          # shared types w/ web
│       │       ├── blocklist.ts
│       │       └── dedup.ts
│       ├── manifest.json
│       └── icons/
│
├── services/
│   └── api/                        # FastAPI backend
│       ├── app/
│       │   ├── main.py
│       │   ├── deps.py             # auth, db
│       │   ├── routers/
│       │   │   ├── memories.py
│       │   │   ├── search.py
│       │   │   ├── collections.py
│       │   │   ├── graph.py
│       │   │   └── settings.py
│       │   ├── services/
│       │   │   ├── embeddings.py   # OpenAI wrapper
│       │   │   ├── summarize.py    # Gemini wrapper
│       │   │   ├── classify.py
│       │   │   ├── cluster.py      # Smart Collections logic
│       │   │   └── hybrid_search.py
│       │   ├── models/             # SQLAlchemy
│       │   └── workers/
│       │       └── capture_worker.py
│       ├── alembic/                # migrations
│       ├── tests/
│       ├── pyproject.toml
│       └── Dockerfile
│
├── packages/
│   └── types/                      # shared TS types (memory, user, etc.)
│       └── src/index.ts
│
├── docs/                           # the docs you're reading
├── infra/
│   ├── docker-compose.yml          # postgres, redis, api
│   └── fly.toml
│
├── .github/workflows/
├── package.json                    # pnpm workspace root
└── README.md
```

## Environments

- **Local.** `docker-compose up` (postgres, redis). FastAPI on :8000. Next.js on :3000.
- **Staging.** fly.io + Neon Postgres + Upstash Redis.
- **Prod.** same, with separate DB + a CDN in front of Next.js.

## Cost model (per 1000 active users / month)

| Item                            | Volume                | Unit cost  | Monthly  |
|---------------------------------|----------------------|-----------|----------|
| OpenAI embeddings (1536-dim)    | ~5M mem × 1 emb      | $0.02/M   | $100     |
| Gemini 2.0 Flash (summary+tags) | ~5M mem × 1 call     | $0.075/M  | $375     |
| Postgres (Neon, 100GB+pgvector) | 100GB                | $200      | $200     |
| Redis (Upstash)                 | 10GB                 | $30       | $30      |
| Hosting (fly.io)                | 4 machines           | $60       | $60      |
| Total per 1k active users       |                      |           | ~$765    |

That works out to **~$0.77/user/month** at the 1k MAU scale.
At 10k MAU it's roughly $4-5k/month — sustainable if free→paid conversion is ~5%.
