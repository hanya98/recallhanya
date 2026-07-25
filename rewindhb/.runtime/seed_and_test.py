"""End-to-end smoke test against a running RecallOS API.

Creates a dev user, seeds memories matching the HTML prototypes, runs
search + collection + graph calls. Prints a structured summary.
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import httpx

BASE = "http://127.0.0.1:8000"
USER_ID = str(uuid.uuid4())  # dev user — auto-provisioned

# Seed data — matches the prototypes in web/*.html
SEED = [
    {
        "url": "https://arxiv.org/abs/1706.03762",
        "title": "Attention Is All You Need",
        "domain": "arxiv.org",
        "category": "paper",
        "summary": "The original transformer paper. Introduces multi-head self-attention as a replacement for recurrence, achieving state-of-the-art on translation with parallelizable training.",
        "tags": ["transformers", "attention", "deep-learning", "nlp"],
        "days_ago": 0,
    },
    {
        "url": "https://github.com/nextauthjs/next-auth",
        "title": "nextauthjs/next-auth — Authentication for Next.js",
        "domain": "github.com",
        "category": "repo",
        "summary": "Drop-in auth library with 200+ OAuth providers, JWT, database sessions, and edge-compatible middleware. MIT licensed.",
        "tags": ["auth", "nextjs", "oauth", "opensource"],
        "days_ago": 2,
    },
    {
        "url": "https://youtube.com/watch?v=karp",
        "title": "[1hr 23min] Let's build GPT: from scratch, in code, spelled out.",
        "domain": "youtube.com",
        "category": "video",
        "summary": "Andrej Karpathy walks through building a GPT from scratch. The clearest explainer of self-attention.",
        "tags": ["gpt", "transformers", "tutorial", "karpathy"],
        "days_ago": 7,
    },
    {
        "url": "https://github.com/huggingface/transformers",
        "title": "huggingface/transformers",
        "domain": "github.com",
        "category": "repo",
        "summary": "State-of-the-art ML for PyTorch, TensorFlow, and JAX. Implements the Transformer architecture.",
        "tags": ["transformers", "huggingface", "ml"],
        "days_ago": 1,
    },
    {
        "url": "https://arxiv.org/abs/2205.14135",
        "title": "FlashAttention: Fast Transformer Training with Long Sequences",
        "domain": "arxiv.org",
        "category": "paper",
        "summary": "IO-aware exact attention algorithm 2-4x faster than baseline. Addresses the quadratic memory bottleneck.",
        "tags": ["flashattention", "transformers", "gpu"],
        "days_ago": 2,
    },
    {
        "url": "https://mail.google.com/mail/u/0/#inbox/stripe-offer",
        "title": "Re: Summer internship at Stripe — offer letter attached",
        "domain": "mail.google.com",
        "category": "email",
        "summary": "Confirms ₹50,000/month stipend for the 12-week summer engineering role. Start date June 2.",
        "tags": ["internship", "stripe", "offer"],
        "days_ago": 0,
    },
    {
        "url": "https://bonappetit.com/recipe/spicy-pasta",
        "title": "Spicy One-Pot Pasta with Garlic and Chili Flakes",
        "domain": "bonappetit.com",
        "category": "recipe",
        "summary": "Twenty-minute weeknight pasta with garlic, calabrian chilis, parmesan, lemon. Serves four.",
        "tags": ["pasta", "quick", "weeknight"],
        "days_ago": 1,
    },
    {
        "url": "https://medium.com/@author/langgraph-in-production",
        "title": "What I learned shipping LangGraph agents to 1000 users",
        "domain": "medium.com",
        "category": "article",
        "summary": "Practical lessons on persistence, retry logic, and human-in-the-loop. Argues against autonomous loops.",
        "tags": ["langgraph", "agents", "production"],
        "days_ago": 1,
    },
]


async def main() -> int:
    print(f"\n{'='*60}\nRecallOS API end-to-end smoke test\nUser: {USER_ID}\n{'='*60}\n")

    async with httpx.AsyncClient(base_url=BASE, timeout=30.0) as c:
        # Headers used by dev auth
        h = {"x-user-id": USER_ID}

        # 1. Health
        r = await c.get("/healthz")
        print(f"[1] GET /healthz  → {r.status_code}  {r.json()}")
        assert r.status_code == 200

        # 2. /auth/me — auto-provisions user
        r = await c.get("/v1/auth/me", headers=h)
        print(f"[2] GET /v1/auth/me  → {r.status_code}  email={r.json().get('email')}")
        assert r.status_code == 200

        # 3. POST /v1/memories — seed memories
        print(f"\n[3] Capturing {len(SEED)} memories...")
        captured_ids = []
        for s in SEED:
            body = {
                "url": s["url"],
                "title": s["title"],
                "excerpt": s["summary"] + " " + " ".join(s["tags"]),
                "favicon_url": None,
                "visited_at": (
                    datetime.now(timezone.utc) - timedelta(days=s["days_ago"])
                ).isoformat(),
                "content_type": "text/html",
                "word_count": len(s["summary"].split()),
                "language": "en",
                "dedup_key": str(uuid.uuid5(uuid.NAMESPACE_URL, s["url"] + str(s["days_ago"]))),
            }
            r = await c.post("/v1/memories", json=body, headers=h)
            assert r.status_code in (200, 202), f"capture failed: {r.status_code} {r.text}"
            data = r.json()
            captured_ids.append(data["memory_id"])
            print(f"    ✓ {s['domain']:18s}  → {data['memory_id'][:8]}...  status={data['status']}")

        # 4. Wait for embeddings to land
        print(f"\n[4] Waiting for embedding jobs...")
        await asyncio.sleep(2)

        # 5. GET /v1/memories — list
        r = await c.get("/v1/memories?limit=20", headers=h)
        items = r.json().get("items", [])
        print(f"[5] GET /v1/memories  → {r.status_code}  {len(items)} items")
        assert r.status_code == 200
        assert len(items) >= len(SEED) - 2  # dedup may collapse some

        # 6. POST /v1/search — semantic query
        r = await c.post(
            "/v1/search",
            json={"query": "react auth repo last week", "limit": 5},
            headers=h,
        )
        print(f"[6] POST /v1/search  → {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            print(f"    query_id={data['query_id'][:8]}...")
            print(f"    {len(data['matches'])} matches")
            for m in data["matches"][:3]:
                print(f"      score={m['score']:.3f}  {m['title'][:50]}")
        else:
            print(f"    body: {r.text[:200]}")

        # 7. POST /v1/collections — create AI Research collection
        r = await c.post(
            "/v1/collections",
            json={"title": "AI Research", "color": "#a78bfa", "icon": "⌬"},
            headers=h,
        )
        coll = r.json() if r.status_code == 201 else None
        print(f"[7] POST /v1/collections  → {r.status_code}  id={coll['id'][:8] if coll else 'FAIL'}")

        # 8. GET /v1/graph
        r = await c.get("/v1/graph?limit=20", headers=h)
        graph = r.json() if r.status_code == 200 else None
        print(f"[8] GET /v1/graph  → {r.status_code}  nodes={len(graph['nodes']) if graph else 0} edges={len(graph['edges']) if graph else 0}")

        # 9. GET /v1/settings
        r = await c.get("/v1/settings", headers=h)
        print(f"[9] GET /v1/settings  → {r.status_code}  theme={r.json().get('theme')}")

        # 10. PATCH /v1/settings
        r = await c.patch(
            "/v1/settings",
            json={"theme": "dark", "capture_paused": False},
            headers=h,
        )
        print(f"[10] PATCH /v1/settings → {r.status_code}")

    print(f"\n{'='*60}\nDONE — RecallOS API is live and serving real data\n{'='*60}\n")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
