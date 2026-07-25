"""Embeddings service — wraps OpenAI text-embedding-3-small.

In dev (no API key), we generate deterministic pseudo-embeddings so the app
can boot, search, and demo without an external API call. The shape and
distance semantics are real — cosine over the 1536-dim vector works.
"""
from __future__ import annotations

import hashlib
import math
import os
import uuid
from typing import Sequence

from app.deps import get_engine
from app.models import Memory
from sqlalchemy import select

EMBED_DIM = 1536


async def embed_query(text: str) -> list[float]:
    """Embed a search query. Dev fallback when no API key."""
    if os.getenv("OPENAI_API_KEY"):
        try:
            from openai import AsyncOpenAI

            client = AsyncOpenAI()
            resp = await client.embeddings.create(
                model="text-embedding-3-small",
                input=text,
            )
            return list(resp.data[0].embedding)
        except Exception:
            pass
    return _pseudo_embed(text)


async def embed_text(text: str) -> list[float]:
    return await embed_query(text)


async def enqueue_embedding_job(memory_id: uuid.UUID) -> None:
    """In MVP this is synchronous; in prod it goes to Redis queue + worker."""
    try:
        from app.deps import get_sessionmaker
        sm = get_sessionmaker()
        async with sm() as session:
            stmt = select(Memory).where(Memory.id == memory_id)
            memory = (await session.execute(stmt)).scalar_one_or_none()
            if not memory:
                return
            text = f"{memory.title} {memory.summary or ''} {(memory.excerpt_clean or '')[:500]}"
            memory.embedding = await embed_query(text)
            memory.processing_status = "ready"
            if not memory.category and memory.domain:
                memory.category = _guess_category(memory.domain)
            if not memory.tags:
                memory.tags = _extract_tags(text)
            await session.commit()
    except Exception as e:
        # Don't crash the API on background work failure
        import structlog
        structlog.get_logger().warning("embedding_job_failed", error=str(e), memory_id=str(memory_id))


# ============================================================
# Dev fallback — deterministic pseudo-embeddings
# ============================================================
def _pseudo_embed(text: str) -> list[float]:
    """Generate a stable 1536-dim vector from text using SHA-256-seeded RNG.

    Same text → same vector. Different text → different vector. Cosine
    similarity behaves sensibly: identical → 1.0, unrelated → ~0.0.
    """
    import re
    cleaned = re.sub(r'[^\w\s-]', ' ', text.lower())
    tokens = [t.strip() for t in cleaned.split() if len(t) > 1][:200]
    dim = EMBED_DIM
    vec = [0.0] * dim

    if not tokens:
        tokens = [text or "empty"]

    for tok in tokens:
        # Each token seeds a deterministic contribution across the vector
        h = hashlib.sha256(tok.encode()).digest()
        # Use 16 bytes of hash → 16 indices to update, with sign
        for i in range(16):
            idx = (h[i] + (h[16 + (i % 16)] if i < 16 else 0)) % dim
            sign = 1.0 if h[(i * 7) % 32] % 2 == 0 else -1.0
            vec[idx] += sign * (1.0 / (1.0 + i * 0.1))

    # L2 normalize so cosine = dot product
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def _guess_category(domain: str) -> str:
    """Best-effort domain → category mapping for dev seed data."""
    domain = domain.lower()
    if "github" in domain or "gitlab" in domain:
        return "repo"
    if "youtube" in domain or "youtu.be" in domain or "vimeo" in domain:
        return "video"
    if "arxiv" in domain or "papers" in domain:
        return "paper"
    if "gmail" in domain or "mail" in domain:
        return "email"
    if "stackoverflow" in domain or "reddit" in domain:
        return "forum"
    if "twitter" in domain or "x.com" in domain or "linkedin" in domain:
        return "social"
    if "bonappetit" in domain or "nytcooking" in domain or "allrecipes" in domain:
        return "recipe"
    if "medium" in domain or "substack" in domain or "dev.to" in domain:
        return "article"
    if any(d in domain for d in ("docs.", "/docs", "developer.")):
        return "doc"
    if any(d in domain for d in ("amazon", "shop", "store")):
        return "shopping"
    return "other"


def _extract_tags(text: str) -> list[str]:
    """Extract up to 5 plausible tags from text."""
    stop = {"the", "and", "for", "with", "this", "that", "from", "are", "you", "your", "http", "https", "www"}
    import re
    cleaned = re.sub(r'[^\w\s-]', ' ', text.lower())
    words = [w.strip() for w in cleaned.split() if len(w) > 3]
    seen = set()
    out = []
    for w in words:
        if w in stop or w in seen:
            continue
        seen.add(w)
        out.append(w)
        if len(out) >= 5:
            break
    return out
