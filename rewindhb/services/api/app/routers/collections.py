"""Collections router — list, create, resume."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, get_current_user
from app.models import User, Collection, Memory, CollectionMemory

router = APIRouter()


# ============================================================
# Schemas
# ============================================================
class CollectionOut(BaseModel):
    id: uuid.UUID
    slug: str
    title: str
    description: Optional[str]
    color: Optional[str]
    icon: Optional[str]
    source: str
    member_count: int
    last_activity_at: Optional[datetime]


class CollectionListResponse(BaseModel):
    items: list[CollectionOut]


class CollectionCreate(BaseModel):
    title: str
    description: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None


class ResumeResponse(BaseModel):
    session_id: uuid.UUID
    urls: list[str]
    count: int


# ============================================================
# Endpoints
# ============================================================
@router.get("", response_model=CollectionListResponse)
async def list_collections(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    stmt = (
        select(Collection)
        .where(Collection.user_id == user.id)
        .order_by(Collection.last_activity_at.desc().nullslast())
    )
    rows = (await db.execute(stmt)).scalars().all()
    return CollectionListResponse(
        items=[
            CollectionOut(
                id=c.id,
                slug=c.slug,
                title=c.title,
                description=c.description,
                color=c.color,
                icon=c.icon,
                source=c.source,
                member_count=c.member_count,
                last_activity_at=c.last_activity_at,
            )
            for c in rows
        ]
    )


@router.post("", response_model=CollectionOut, status_code=status.HTTP_201_CREATED)
async def create_collection(
    body: CollectionCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    slug = body.title.lower().replace(" ", "-")[:64]
    coll = Collection(
        user_id=user.id,
        slug=slug,
        title=body.title,
        description=body.description,
        color=body.color,
        icon=body.icon,
        source="manual",
    )
    db.add(coll)
    await db.commit()
    await db.refresh(coll)
    return CollectionOut(
        id=coll.id,
        slug=coll.slug,
        title=coll.title,
        description=coll.description,
        color=coll.color,
        icon=coll.icon,
        source=coll.source,
        member_count=coll.member_count,
        last_activity_at=coll.last_activity_at,
    )


@router.post("/{collection_id}/resume", response_model=ResumeResponse)
async def resume_collection(
    collection_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    # Verify collection belongs to user
    coll = (
        await db.execute(
            select(Collection).where(
                and_(
                    Collection.id == collection_id,
                    Collection.user_id == user.id,
                )
            )
        )
    ).scalar_one_or_none()
    if not coll:
        raise HTTPException(status_code=404, detail="collection not found")

    # Get the urls from memory_ids
    stmt = (
        select(Memory.url)
        .join(CollectionMemory, CollectionMemory.memory_id == Memory.id)
        .where(CollectionMemory.collection_id == collection_id)
        .order_by(Memory.visited_at.desc())
        .limit(20)
    )
    rows = (await db.execute(stmt)).scalars().all()
    urls = list(rows)
    return ResumeResponse(
        session_id=collection_id,
        urls=urls,
        count=len(urls),
    )


@router.delete("/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_collection(
    collection_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    coll = (
        await db.execute(
            select(Collection).where(
                and_(
                    Collection.id == collection_id,
                    Collection.user_id == user.id,
                )
            )
        )
    ).scalar_one_or_none()
    if not coll:
        raise HTTPException(status_code=404, detail="collection not found")
    await db.delete(coll)
    await db.commit()
