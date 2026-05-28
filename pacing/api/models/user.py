from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from pacing.api.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    """
    Application-level user record.

    ``id`` mirrors the Supabase auth user UUID (the ``sub`` claim in the JWT).
    There is intentionally no FK into Supabase's ``auth.users`` table so this
    model works with both Supabase-hosted and local-Postgres setups.

    Rows are created/updated by the ``POST /v1/auth/sync`` endpoint the first
    time (and on every subsequent sign-in) a user authenticates.
    """

    __tablename__ = "users"

    # Supabase auth UUID — used as the PK and matches user_flags.user_id
    id: Mapped[str] = mapped_column(String(36), primary_key=True)

    email: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)

    # The raw Google "sub" value, captured from user_metadata for traceability.
    google_sub: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True, index=True
    )

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Immutable — set once when the row is first created.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    # Updated on every sync call (i.e. every sign-in).
    last_login_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "email": self.email,
            "name": self.name,
            "avatar_url": self.avatar_url,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat(),
            "last_login_at": self.last_login_at.isoformat(),
        }
