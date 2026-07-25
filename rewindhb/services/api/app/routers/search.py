"""Search router — semantic + keyword hybrid search."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta
from typing import Annotated, Optional
from fastapi import APIRouter, Depends, status
from dateutil.relativedelta import relativedelta
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, text

from app.deps import get_db, get_current_user
from app.models import User
from app.models import Memory
from app.services.embeddings import embed_query
from app.services.hybrid_search import hybrid_fuse

router = APIRouter()


# ============================================================
# TIME-PARSE — "last week", "yesterday", etc.
# ============================================================
TIME_PATTERNS = [
    (r"\blast\s+(\d+)\s+hours?\b", lambda m: datetime.utcnow() - relativedelta(hours=int(m.group(1)))),
    (r"\blast\s+(\d+)\s+days?\b", lambda m: datetime.utcnow() - relativedelta(days=int(m.group(1)))),
    (r"\blast\s+week\b", lambda _: datetime.utcnow() - relativedelta(days=7)),
    (r"\blast\s+month\b", lambda _: datetime.utcnow() - relativedelta(days=30)),
    (r"\byesterday\b", lambda _: datetime.utcnow() - relativedelta(days=1)),
    (r"\btoday\b", lambda _: datetime.utcnow() - relativedelta(hours=12)),
    (r"\bthis\s+week\b", lambda _: datetime.utcnow() - relativedelta(days=7)),
]

CATEGORY_PATTERNS = {
    r"\brepos?(itory|itories)?\b": "repo",
    r"\barticles?\b|blog": "article",
    r"\bvideos?|youtube\b": "video",
    r"\bdocs?|documentation\b": "doc",
    r"\brecipes?\b": "recipe",
    r"\bpapers?|research\b": "paper",
    r"\bsocial|tweets?|linkedin": "social",
    r"\bshop|shopping|amazon": "shopping",
    r"\bemails?|gmail": "email",
}


def parse_query_intent(q: str) -> dict:
    """Detect time and category intent from natural-language query."""
    q_lower = q.lower()
    result = {"since": None, "categories": [], "query_clean": q}

    # Time
    for pattern, fn in TIME_PATTERNS:
        m = re.search(pattern, q_lower)
        if m:
            result["since"] = fn(m)
            break

    # Categories (can match multiple)
    for pattern, cat in CATEGORY_PATTERNS.items():
        if re.search(pattern, q_lower):
            result["categories"].append(cat)

    return result


# ============================================================
# SCHEMAS
# ============================================================
class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    limit: int = Field(default=10, le=50)
    since: Optional[datetime] = None
    until: Optional[datetime] = None
    categories: Optional[list[str]] = None
    use_llm_rerank: bool = False


class SearchMatch(BaseModel):
    memory_id: uuid.UUID
    url: str
    title: str
    summary: Optional[str]
    category: Optional[str]
    tags: list[str]
    visited_at: datetime
    score: float
    matched_field: str


class RelatedMemory(BaseModel):
    memory_id: uuid.UUID
    title: str
    score: float


class SessionResume(BaseModel):
    topic: str
    urls: list[str]
    count: int


class SearchResponse(BaseModel):
    query_id: uuid.UUID
    matches: list[SearchMatch]
    related: list[RelatedMemory]
    session_resume: Optional[SessionResume] = None


# ============================================================
# ENDPOINT
# ============================================================
@router.post("", response_model=SearchResponse)
async def search(
    body: SearchRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SearchResponse:
    """Semantic + keyword hybrid search."""

    # Parse intent from query
    intent = parse_query_intent(body.query)
    since = body.since or intent["since"]
    until = body.until
    categories = body.categories or intent["categories"]

    # 1. Embed the query
    query_embedding = await embed_query(body.query)

    # 2. Get vector and keyword candidates (top 50)
    from sqlalchemy import or_
    q_pattern = f"%{body.query.strip()}%"

    stmt = (
        select(
            Memory.id,
            Memory.url,
            Memory.title,
            Memory.summary,
            Memory.category,
            Memory.tags,
            Memory.visited_at,
            (1 - Memory.embedding.cosine_distance(query_embedding)).label("vec_score"),
        )
        .where(
            and_(
                Memory.user_id == user.id,
                Memory.deleted_at.is_(None),
            )
        )
        .order_by(Memory.visited_at.desc())
        .limit(50)
    )
    if since:
        stmt = stmt.where(Memory.visited_at >= since)
    if until:
        stmt = stmt.where(Memory.visited_at <= until)
    if categories:
        stmt = stmt.where(Memory.category.in_(categories))

    candidates = (await db.execute(stmt)).fetchall()

    # 3. BM25 & ILIKE keyword scores for candidates
    ids = [c.id for c in candidates]
    kw_scores = {}
    q_lower = body.query.lower().strip()

    for c in candidates:
        score = 0.0
        c_title = (c.title or "").lower()
        c_url = (c.url or "").lower()
        c_summary = (c.summary or "").lower()
        if q_lower in c_title:
            score += 2.0
        if q_lower in c_url:
            score += 1.5
        if q_lower in c_summary:
            score += 1.0
        kw_scores[c.id] = score

    # 4. Hybrid fusion
    matches = hybrid_fuse(
        candidates=candidates,
        kw_scores=kw_scores,
        top_k=body.limit,
    )

    # 5. Related (3-NN per top match)
    related = await _get_related(db, user.id, [m["memory_id"] for m in matches[:5]])

    # 6. Session detection
    session_resume = _detect_session(matches)

    return SearchResponse(
        query_id=uuid.uuid4(),
        matches=[SearchMatch(**m) for m in matches],
        related=[RelatedMemory(**r) for r in related],
        session_resume=SessionResume(**session_resume) if session_resume else None,
    )


async def _get_related(db: AsyncSession, user_id: uuid.UUID, source_ids: list[uuid.UUID]) -> list[dict]:
    """For each source memory, find 3 nearest neighbors above threshold 0.7."""
    if not source_ids:
        return []

    # Get centroids of source memories
    centroid_stmt = select(Memory.embedding).where(Memory.id.in_(source_ids))
    centroids = (await db.execute(centroid_stmt)).scalars().all()

    # For each centroid, find neighbors
    related = []
    seen = set(source_ids)
    for centroid in centroids:
        if centroid is None:
            continue
        nn_stmt = (
            select(Memory.id, Memory.title, Memory.embedding.cosine_distance(centroid).label("dist"))
            .where(
                and_(
                    Memory.user_id == user_id,
                    Memory.processing_status == "ready",
                    Memory.deleted_at.is_(None),
                    Memory.id.notin_(seen),
                    Memory.embedding.cosine_distance(centroid) < 0.3,  # > 0.7 similarity
                )
            )
            .order_by("dist")
            .limit(3)
        )
        rows = (await db.execute(nn_stmt)).fetchall()
        for r in rows:
            if r.id not in seen:
                related.append({"memory_id": r.id, "title": r.title, "score": float(1 - r.dist)})
                seen.add(r.id)

    # Sort by score desc, top 5
    related.sort(key=lambda x: x["score"], reverse=True)
    return related[:5]


def _detect_session(matches: list[dict]) -> Optional[dict]:
    """If top matches cluster in a tight time window, suggest a session resume."""
    if len(matches) < 3:
        return None

    top = matches[:6]
    times = [m["visited_at"] for m in top]
    span_minutes = (max(times) - min(times)).total_seconds() / 60

    if span_minutes > 30:
        return None

    # All within 30 min — likely a session
    return {
        "topic": "session",  # LLM could fill this in
        "urls": [m["url"] for m in top],
        "count": len(top),
    }
