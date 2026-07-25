<div align="center">

<img src="design/logo.svg" width="80" alt="RecallOS"/>

# RecallOS

**Google Search for your own browsing memory.**

An AI second brain that quietly remembers everything you browse — and lets you retrieve it with words, not filenames.

[Install extension](#) · [Dashboard](#) · [Docs](#) · [Demo](#)

</div>

---

## The problem

You find useful things every day. A GitHub repo. A recipe. A research paper. An internship email.

A week later you remember *what* you saw but not *where*.

Browser history is chronological. Bookmarks don't scale. Search is keyword-based — not memory-based.

The browser is a **memory leak.**

## What RecallOS does

RecallOS captures every page you visit as a tiny AI memory snapshot — title, URL, summary, tags, and a semantic embedding — and lets you retrieve it instantly with natural language.

```
You type:  "react auth repo last week"

RecallOS returns:
  → GitHub: nextauthjs/next-auth
    "Auth library for Next.js with 200+ OAuth providers. MIT license."
  → Related: a blog post, a YouTube tutorial, a StackOverflow answer
  → "Resume session" — reopens the 6 tabs you had open Tuesday night
```

## How it works

```
Chrome extension  ──captures──▶  API  ──embeds + summarizes──▶  Postgres + pgvector
        ▲                                                              │
        │                                                              ▼
   (passive)                                                     web dashboard
                                                                    (search, browse)
```

The extension runs in the background. You don't save anything. You don't write anything. RecallOS just remembers.

## MVP scope (24-hour hackathon)

- Chrome extension (Manifest V3) that captures every page
- AI summary + tags + category per page
- Semantic + keyword hybrid search
- Memory timeline
- Smart Collections (auto-clustered topics)
- Context Resume (reopen tabs by topic)
- Spotlight command bar (Cmd+K)
- Privacy controls (pause, delete)

## Architecture (TL;DR)

| Layer        | Tech                                    |
|--------------|-----------------------------------------|
| Extension    | Chrome MV3, vanilla TS                  |
| Dashboard    | Next.js 15, Tailwind, Framer Motion     |
| API          | FastAPI (Python 3.12)                   |
| Database     | Postgres 16 + pgvector                  |
| Cache/queue  | Redis                                   |
| Embeddings   | OpenAI `text-embedding-3-small`         |
| LLM          | Gemini 2.0 Flash (summary, tags, classify) |

Full architecture, schema, API spec, and search pipeline are in [`/docs`](./docs).

## Repo layout

```
recallos/
├── apps/
│   ├── web/              Next.js dashboard
│   └── extension/        Chrome extension (MV3)
├── services/
│   └── api/              FastAPI backend
├── packages/
│   └── types/            Shared TS types
├── docs/                 The docs you're reading
├── design/               Brand assets, logo
└── infra/                Docker, deploy
```

## Quickstart (local dev)

```bash
# 1. Boot the API
cd services/api
docker-compose up -d                # postgres + redis
uv sync                             # install deps
uv run alembic upgrade head         # migrate
uv run uvicorn app.main:app --reload --port 8000

# 2. Boot the dashboard
cd ../../apps/web
pnpm install
pnpm dev                            # http://localhost:3000

# 3. Load the extension unpacked
#    chrome://extensions → Developer mode → Load unpacked
#    pick apps/extension/dist (or src for dev)
```

## Roadmap

**Now → 24h:** Ship the MVP above.

**Next 4 weeks:**
- Memory Graph visualization
- Cross-device sync
- Email digest ("yesterday you saw 47 things")
- Better Smart Collections (LLM-generated descriptions)

**6+ months:**
- OS-wide memory layer (desktop agent)
- Mobile share-sheet capture
- Gmail / Drive / Notion / VS Code connectors
- Proactive recommendations ("you read about LangGraph last week, here's a new paper")

See [`docs/14-roadmap.md`](./docs/14-roadmap.md) for the full roadmap.

## Privacy

- We never store raw HTML. Only title, URL, AI summary, tags, and a semantic embedding.
- Memories are private to your account. Never shared, never used for training.
- You can pause capture from the extension popup at any time.
- You can delete any memory in one click. Hard delete after 30 days.

## Team & contact

Built at [hackathon name]. With ❤️ for anyone who's ever lost a tab.

- Twitter: [@recallos](https://twitter.com)
- Email: hello@recallos.com
- Issues: this repo

## License

MIT.
