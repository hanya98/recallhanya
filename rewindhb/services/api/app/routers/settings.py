"""Settings router — get + patch user settings."""
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, get_current_user
from app.models import User, UserSettings

router = APIRouter()


class SettingsOut(BaseModel):
    capture_paused: bool
    theme: str
    blocklist_domains: list[str]
    capture_categories: list[str]
    capture_max_per_day: int


class SettingsPatch(BaseModel):
    capture_paused: Optional[bool] = None
    theme: Optional[str] = None
    blocklist_domains: Optional[list[str]] = None
    capture_categories: Optional[list[str]] = None
    capture_max_per_day: Optional[int] = None


def _to_out(s: UserSettings) -> SettingsOut:
    return SettingsOut(
        capture_paused=False,  # user-level, not settings-level
        theme=s.theme,
        blocklist_domains=s.blocklist_domains or [],
        capture_categories=s.capture_categories or [],
        capture_max_per_day=s.capture_max_per_day,
    )


@router.get("", response_model=SettingsOut)
async def get_settings(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SettingsOut:
    s = (
        await db.execute(
            select(UserSettings).where(UserSettings.user_id == user.id)
        )
    ).scalar_one_or_none()
    if not s:
        s = UserSettings(user_id=user.id)
        db.add(s)
        await db.commit()
        await db.refresh(s)
    return _to_out(s)


@router.patch("", response_model=SettingsOut)
async def patch_settings(
    body: SettingsPatch,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SettingsOut:
    s = (
        await db.execute(
            select(UserSettings).where(UserSettings.user_id == user.id)
        )
    ).scalar_one_or_none()
    if not s:
        s = UserSettings(user_id=user.id)
        db.add(s)

    # Apply user-level fields
    if body.capture_paused is not None:
        user.capture_paused = body.capture_paused

    # Apply settings-level fields
    if body.theme is not None:
        s.theme = body.theme
    if body.blocklist_domains is not None:
        s.blocklist_domains = body.blocklist_domains
    if body.capture_categories is not None:
        s.capture_categories = body.capture_categories
    if body.capture_max_per_day is not None:
        s.capture_max_per_day = body.capture_max_per_day
    s.updated_at = datetime.utcnow()
    user.last_seen_at = datetime.utcnow()

    await db.commit()
    await db.refresh(s)
    return _to_out(s)
