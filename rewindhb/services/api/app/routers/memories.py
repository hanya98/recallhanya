"""Memories router — capture, list, get, delete."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, get_current_user
from app.models import User
from app.models import Memory
from app.services.embeddings import enqueue_embedding_job
from sqlalchemy import select, and_

router = APIRouter()


# ============================================================
# SCHEMAS
# ============================================================
class CaptureRequest(BaseModel):
    url: str
    title: str
    excerpt: str = Field(default="", max_length=100000)
    favicon_url: Optional[str] = None
    visited_at: datetime
    content_type: Optional[str] = None
    word_count: Optional[int] = None
    language: Optional[str] = None
    dedup_key: str


class CaptureResponse(BaseModel):
    memory_id: uuid.UUID
    status: str  # "processing" | "duplicate"


class MemoryOut(BaseModel):
    id: uuid.UUID
    url: str
    domain: str
    title: str
    summary: Optional[str]
    category: Optional[str]
    tags: list[str]
    visited_at: datetime
    favicon_url: Optional[str]

    class Config:
        from_attributes = True


class MemoryListResponse(BaseModel):
    items: list[MemoryOut]
    next_cursor: Optional[str]


# ============================================================
# ENDPOINTS
# ============================================================
import structlog
log = structlog.get_logger()

@router.post("", status_code=status.HTTP_202_ACCEPTED, response_model=CaptureResponse)
async def capture_memory(
    body: CaptureRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CaptureResponse:
    """Capture a new memory snapshot. Idempotent on (user_id, dedup_key)."""
    log.info("Incoming capture request", url=body.url, title=body.title, user_id=str(user.id), excerpt_len=len(body.excerpt))

    # Dedup check (URL or dedup_key)
    from sqlalchemy import or_
    stmt = select(Memory).where(
        and_(Memory.user_id == user.id, or_(Memory.dedup_key == body.dedup_key, Memory.url == body.url))
    )
    existing = (await db.execute(stmt)).scalars().first()
    if existing:
        log.info("Duplicate capture detected — updating last visited", url=body.url, memory_id=str(existing.id))
        existing.visited_at = datetime.now(timezone.utc)
        existing.title = body.title
        if body.excerpt:
            existing.excerpt_clean = body.excerpt[:4000]
        await db.commit()
        await db.refresh(existing)
        if existing.embedding is None:
            await enqueue_embedding_job(existing.id)
        return CaptureResponse(memory_id=existing.id, status="updated")

    # Extract domain from URL
    from urllib.parse import urlparse
    domain = urlparse(body.url).netloc

    memory = Memory(
        user_id=user.id,
        url=body.url,
        domain=domain,
        title=body.title,
        excerpt_clean=body.excerpt[:4000],
        favicon_url=body.favicon_url,
        content_type=body.content_type,
        word_count=body.word_count,
        language=body.language,
        visited_at=body.visited_at,
        dedup_key=body.dedup_key,
        processing_status="ready",
    )
    db.add(memory)
    await db.commit()
    await db.refresh(memory)

    # Enqueue async processing (embed + summarize + classify)
    await enqueue_embedding_job(memory.id)
    log.info("Memory capture success", memory_id=str(memory.id), url=body.url)

    return CaptureResponse(memory_id=memory.id, status="processing")


@router.get("", response_model=MemoryListResponse)
async def list_memories(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    cursor: Optional[uuid.UUID] = None,
    limit: int = Query(default=20, le=100),
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    category: Optional[list[str]] = Query(default=None),
    domain: Optional[list[str]] = Query(default=None),
    tag: Optional[list[str]] = Query(default=None),
    q: Optional[str] = None,
) -> MemoryListResponse:
    """List the user's memories, paginated, filterable."""

    stmt = select(Memory).where(
        and_(
            Memory.user_id == user.id,
            Memory.processing_status == "ready",
            Memory.deleted_at.is_(None),
        )
    )

    if cursor:
        stmt = stmt.where(Memory.id < cursor)
    if since:
        stmt = stmt.where(Memory.visited_at >= since)
    if until:
        stmt = stmt.where(Memory.visited_at <= until)
    if category:
        stmt = stmt.where(Memory.category.in_(category))
    if domain:
        stmt = stmt.where(Memory.domain.in_(domain))
    if tag:
        stmt = stmt.where(Memory.tags.op("&&")(tag))

    stmt = stmt.order_by(Memory.visited_at.desc()).limit(limit + 1)

    rows = (await db.execute(stmt)).scalars().all()
    has_more = len(rows) > limit
    items = rows[:limit]

    return MemoryListResponse(
        items=[MemoryOut.model_validate(m) for m in items],
        next_cursor=str(items[-1].id) if has_more and items else None,
    )


@router.get("/{memory_id}", response_model=MemoryOut)
async def get_memory(
    memory_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MemoryOut:
    stmt = select(Memory).where(
        and_(
            Memory.id == memory_id,
            Memory.user_id == user.id,
            Memory.deleted_at.is_(None),
        )
    )
    memory = (await db.execute(stmt)).scalar_one_or_none()
    if not memory:
        raise HTTPException(status_code=404, detail="Memory not found")
    return MemoryOut.model_validate(memory)


@router.delete("/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_memory(
    memory_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    stmt = select(Memory).where(
        and_(
            Memory.id == memory_id,
            Memory.user_id == user.id,
            Memory.deleted_at.is_(None),
        )
    )
    memory = (await db.execute(stmt)).scalar_one_or_none()
    if not memory:
        raise HTTPException(status_code=404, detail="Memory not found")
    memory.deleted_at = datetime.utcnow()
    await db.commit()
