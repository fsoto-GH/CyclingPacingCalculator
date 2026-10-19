from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from pacing.api.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UserFlags(Base):
    """
    Per-user feature flags.  The user_id is the Supabase auth user UUID —
    stored as a plain string with no FK since the users table lives in
    Supabase's auth schema, not in our application schema.

    Rows are created on demand by the auth sync endpoint.  Google feature
    flags default to enabled; enable_realtime_view defaults to false.
    """

    __tablename__ = "user_flags"

    user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    enable_google_places: Mapped[bool] = mapped_column(Boolean, default=True)
    enable_google_maps: Mapped[bool] = mapped_column(Boolean, default=True)
    enable_google_geocoding: Mapped[bool] = mapped_column(Boolean, default=True)
    enable_realtime_view: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )
