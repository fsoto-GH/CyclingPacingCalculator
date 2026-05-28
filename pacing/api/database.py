"""
SQLAlchemy engine and session factory.
Supports both PostgreSQL (production) and SQLite (dev fallback).
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from typing import Generator

from pacing.api.config import settings

# SQLite needs check_same_thread=False; PostgreSQL ignores it.
connect_args = (
    {"check_same_thread": False}
    if settings.active_database_url.startswith("sqlite")
    else {}
)

engine = create_engine(
    settings.active_database_url,
    connect_args=connect_args,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db() -> Generator:
    """FastAPI dependency that provides a database session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
