"""Auth router — minimal Google OAuth + dev JWT for the MVP."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, get_current_user
from app.models import User

router = APIRouter()


class GoogleAuthRequest(BaseModel):
    id_token: str


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str | None
    avatar_url: str | None
    plan: str
    capture_paused: bool


class AuthResponse(BaseModel):
    jwt: str
    user: UserOut


@router.post("/google", response_model=AuthResponse)
async def google_auth(
    body: GoogleAuthRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthResponse:
    """Exchange a Google ID token for a RecallOS JWT.

    MVP: we trust the client-supplied `id_token` (which in dev is a user UUID
    string). In prod this becomes a real Google token verification.
    """
    token = body.id_token.strip()
    try:
        uid = uuid.UUID(token)
    except ValueError:
        # In prod: verify_google_token(token). For MVP: reject non-UUID inputs.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid id_token (MVP expects a UUID)",
        )

    user = (await db.execute(select(User).where(User.id == uid))).scalar_one_or_none()
    if not user:
        # Auto-provision on first sign-in
        user = User(
            id=uid,
            email=f"user-{uid.hex[:8]}@recallos.local",
            display_name="Dev User",
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

    user.last_seen_at = datetime.utcnow()
    await db.commit()

    return AuthResponse(
        jwt=str(user.id),  # MVP: the user id IS the token
        user=UserOut(
            id=user.id,
            email=user.email,
            display_name=user.display_name,
            avatar_url=user.avatar_url,
            plan=user.plan,
            capture_paused=user.capture_paused,
        ),
    )


@router.get("/me", response_model=UserOut)
async def me(user: Annotated[User, Depends(get_current_user)]) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        plan=user.plan,
        capture_paused=user.capture_paused,
    )
