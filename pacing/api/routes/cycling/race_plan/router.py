"""
Race Plan CRUD routes:
  GET    /v1/cycling/race_plan        → list current user's plans
  POST   /v1/cycling/race_plan        → create a plan
  GET    /v1/cycling/race_plan/{id}   → get a plan (owner or public)
  PUT    /v1/cycling/race_plan/{id}   → update a plan (owner only)
  DELETE /v1/cycling/race_plan/{id}   → delete a plan (owner only)
"""
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from pacing.api.auth.deps import CurrentUser, get_current_user, get_optional_user
from pacing.api.database import get_db
from pacing.api.models.race_plan import RacePlan

router = APIRouter(prefix="/v1/cycling/race_plan", tags=["race-plan"])


# ── DTOs ──────────────────────────────────────────────────────────────────────

class RacePlanCreate(BaseModel):
    name: str
    description: Optional[str] = None
    is_public: bool = False
    payload: Any  # the serialized CoursePayload JSON


class RacePlanUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_public: Optional[bool] = None
    payload: Optional[Any] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_plan_or_404(plan_id: str, db: Session) -> RacePlan:
    plan = db.query(RacePlan).filter(RacePlan.id == plan_id).first()
    if not plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Race plan not found",
        )
    return plan


def _assert_owner(plan: RacePlan, user: CurrentUser) -> None:
    if plan.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to modify this race plan",
        )


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=dict)
def list_race_plans(
    q: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return paginated race plans owned by the current user, optionally filtered by name."""
    from sqlalchemy import func
    query = db.query(RacePlan).filter(RacePlan.user_id == current_user.id)
    if q:
        query = query.filter(func.lower(RacePlan.name).contains(q.lower()))
    total = query.count()
    page = max(1, page)
    per_page = max(1, min(per_page, 100))
    items = (
        query.order_by(RacePlan.updated_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    return {
        "items": [p.to_dict() for p in items],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED)
def create_race_plan(
    body: RacePlanCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    plan = RacePlan(
        user_id=current_user.id,
        name=body.name,
        description=body.description,
        is_public=body.is_public,
        payload=body.payload,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan.to_dict()


@router.get("/{plan_id}", response_model=dict)
def get_race_plan(
    plan_id: str,
    current_user: Optional[CurrentUser] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    plan = _get_plan_or_404(plan_id, db)
    if not plan.is_public:
        if not current_user or current_user.id != plan.user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This race plan is private",
            )
    return plan.to_dict()


@router.put("/{plan_id}", response_model=dict)
def update_race_plan(
    plan_id: str,
    body: RacePlanUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    plan = _get_plan_or_404(plan_id, db)
    _assert_owner(plan, current_user)
    if body.name is not None:
        plan.name = body.name
    if body.description is not None:
        plan.description = body.description
    if body.is_public is not None:
        plan.is_public = body.is_public
    if body.payload is not None:
        plan.payload = body.payload
    db.commit()
    db.refresh(plan)
    return plan.to_dict()


@router.delete("/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_race_plan(
    plan_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    plan = _get_plan_or_404(plan_id, db)
    _assert_owner(plan, current_user)
    db.delete(plan)
    db.commit()
