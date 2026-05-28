-- User-level settings table.
-- Each authenticated user gets one row; settings are stored as JSONB so new
-- fields can be added without schema migrations.  Non-auth users fall back to
-- localStorage (handled client-side).
--
-- Access is enforced by the FastAPI backend (JWT auth + ownership check in the
-- route handler) — no RLS required.  The table is auto-created by SQLAlchemy's
-- create_all on startup; this file is a reference for manual provisioning.

create table if not exists public.user_settings (
  user_id     varchar(36) primary key,
  settings    jsonb       not null default '{}',
  updated_at  timestamptz not null default now()
);
