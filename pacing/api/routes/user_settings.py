"""
User Settings routes:
  GET  /v1/user_settings  → fetch current user's settings (or {} if none)
  PUT  /v1/user_settings  → upsert current user's settings
"""
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from pacing.api.auth.deps import CurrentUser, get_current_user
from pacing.api.database import get_db
from pacing.api.models.user_settings import UserSettings

router = APIRouter(prefix="/v1/user_settings", tags=["user-settings"])


class UserSettingsBody(BaseModel):
    settings: Any


@router.get("", response_model=dict)
def get_user_settings(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.query(UserSettings).filter(UserSettings.user_id == current_user.id).first()
    return {"settings": row.settings if row else {}}


@router.put("", response_model=dict)
def upsert_user_settings(
    body: UserSettingsBody,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.query(UserSettings).filter(UserSettings.user_id == current_user.id).first()
    if row:
        row.settings = body.settings
    else:
        row = UserSettings(user_id=current_user.id, settings=body.settings)
        db.add(row)
    db.commit()
    db.refresh(row)
    return {"settings": row.settings}
