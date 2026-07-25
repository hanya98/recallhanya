"""Shared FastAPI deps — DB session, auth, lifespan."""
from __future__ import annotations

import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Annotated, AsyncIterator, Optional

from fastapi import Depends, Header, HTTPException, status
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
import structlog

from app.models import User
from sqlalchemy import select

log = structlog.get_logger()


# ============================================================
# Settings
# ============================================================
class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://animeshpathak@/recallos"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str = "dev-secret-do-not-use-in-prod"
    openai_api_key: Optional[str] = None
    gemini_api_key: Optional[str] = None
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
    ]

    model_config = SettingsConfigDict(env_prefix="RECALLOS_", env_file=".env", extra="ignore")


settings = Settings()

# Fix postgres URL — asyncpg uses postgresql+asyncpg:// but needs explicit host
# When empty/default, swap to socket-based auth (peer auth on macOS homebrew)
if settings.database_url == "postgresql+asyncpg://animeshpathak@/recallos":
    # No password needed on local homebrew postgres with peer auth
    os.environ.setdefault("PGHOST", "/tmp")


# ============================================================
# Engine + session factory
# ============================================================
engine = None
SessionLocal: Optional[async_sessionmaker[AsyncSession]] = None


def get_engine():
    global engine
    if engine is None:
        engine = create_async_engine(
            settings.database_url,
            echo=False,
            pool_pre_ping=True,
        )
    return engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    global SessionLocal
    if SessionLocal is None:
        SessionLocal = async_sessionmaker(
            get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
        )
    return SessionLocal


async def get_db() -> AsyncIterator[AsyncSession]:
    sm = get_sessionmaker()
    async with sm() as session:
        try:
            yield session
        finally:
            await session.close()


# ============================================================
# Lifespan — init schema on startup
# ============================================================
@asynccontextmanager
async def lifespan(app):
    # Startup: ensure schema
    from app.services.schema import ensure_schema
    try:
        await ensure_schema(get_engine())
        log.info("schema.ready")
    except Exception as e:
        log.error("schema.failed", error=str(e))
        # Don't crash — let endpoints surface a clearer error if DB is missing
    yield
    # Shutdown
    eng = get_engine()
    await eng.dispose()


# ============================================================
# Auth — minimal dev version
# ============================================================
# In MVP we accept either a Bearer JWT-shaped string OR a `x-user-id` header
# so the extension and web client can both talk to the API without a real
# OAuth flow during the hackathon demo.
async def get_current_user(
    db: Annotated[AsyncSession, Depends(get_db)],
    authorization: Annotated[Optional[str], Header()] = None,
    x_user_id: Annotated[Optional[str], Header()] = None,
):
    from app.models import User
    from sqlalchemy import select

    DEV_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
    if x_user_id:
        try:
            DEV_USER_ID = uuid.UUID(x_user_id)
        except ValueError:
            pass

    user = (await db.execute(select(User).where(User.id == DEV_USER_ID))).scalar_one_or_none()
    if user:
        return user

    user = User(
        id=DEV_USER_ID,
        email="dev@recallos.local",
        display_name="Dev User",
        plan="free",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user

