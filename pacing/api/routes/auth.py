"""
Auth sync endpoint.

Called by the frontend immediately after a successful Google sign-in so that
an application-level user record is upserted in our local database.  This is
the single integration point between Supabase Auth (the identity provider) and
our application data store.

Flow:
  1. User signs in via Google OAuth → Supabase issues a JWT.
  2. Frontend calls  POST /v1/auth/sync  with  Authorization: Bearer <jwt>.
  3. Backend verifies the JWT, extracts user identity, upserts ``users`` row.
  4. Response includes ``is_new_user`` so the frontend can show a welcome flow.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from pacing.api.auth.deps import CurrentUser, get_current_user
from pacing.api.database import get_db
from pacing.api.models.user import User

router = APIRouter(prefix="/v1/auth", tags=["auth"])


class SyncResponse(BaseModel):
    is_new_user: bool
    user: dict


@router.post("/sync", response_model=SyncResponse)
def sync_user(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SyncResponse:
    """
    Upsert the authenticated user in the local ``users`` table.

    - **New user**: inserts a fresh row and returns ``is_new_user=true``.
    - **Returning user**: updates ``email``, ``name``, ``avatar_url``, and
      ``last_login_at``, then returns ``is_new_user=false``.
    """
    now = datetime.now(timezone.utc)
    existing = db.query(User).filter(User.id == current_user.id).first()

    if existing is None:
        user = User(
            id=current_user.id,
            email=current_user.email,
            name=current_user.name,
            avatar_url=current_user.avatar_url,
            created_at=now,
            last_login_at=now,
        )
        db.add(user)
        is_new = True
    else:
        existing.email = current_user.email
        existing.name = current_user.name
        existing.avatar_url = current_user.avatar_url
        existing.last_login_at = now
        user = existing
        is_new = False

    db.commit()
    db.refresh(user)

    return SyncResponse(is_new_user=is_new, user=user.to_dict())
