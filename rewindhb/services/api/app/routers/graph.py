"""Graph router — returns nodes + edges for the Memory Graph view."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, get_current_user
from app.models import User, Memory, MemoryRelation

router = APIRouter()


class GraphNode(BaseModel):
    id: uuid.UUID
    title: str
    domain: Optional[str]
    category: Optional[str]
    tags: list[str]
    size: int


class GraphEdge(BaseModel):
    source: uuid.UUID
    target: uuid.UUID
    weight: float
    type: str


class GraphResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


@router.get("", response_model=GraphResponse)
async def get_graph(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    collection_id: Optional[uuid.UUID] = None,
    since: Optional[datetime] = None,
    limit: int = Query(default=500, le=2000),
):
    """Return nodes + edges for the Memory Graph."""
    # Nodes — all memories for the user
    stmt = (
        select(Memory)
        .where(
            and_(
                Memory.user_id == user.id,
                Memory.processing_status == "ready",
                Memory.deleted_at.is_(None),
            )
        )
        .order_by(Memory.visited_at.desc())
        .limit(limit)
    )
    if since:
        stmt = stmt.where(Memory.visited_at >= since)

    memories = (await db.execute(stmt)).scalars().all()
    memory_ids = [m.id for m in memories]

    nodes = [
        GraphNode(
            id=m.id,
            title=m.title,
            domain=m.domain,
            category=m.category,
            tags=m.tags or [],
            size=max(1, (m.word_count or 200) // 200),
        )
        for m in memories
    ]

    # Edges — relations between these memories
    edges: list[GraphEdge] = []
    if memory_ids:
        edge_stmt = select(MemoryRelation).where(
            MemoryRelation.source_id.in_(memory_ids),
            MemoryRelation.target_id.in_(memory_ids),
        )
        rows = (await db.execute(edge_stmt)).scalars().all()
        edges = [
            GraphEdge(
                source=r.source_id,
                target=r.target_id,
                weight=r.weight,
                type=r.relation_type,
            )
            for r in rows
        ]

    return GraphResponse(nodes=nodes, edges=edges)
