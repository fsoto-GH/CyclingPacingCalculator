-- Add backend geocoding entitlement flag to user feature flags.
-- The API sync endpoint returns this flag so the frontend can decide whether
-- backend geocoding is eligible for the current signed-in user.

alter table if exists public.user_flags
  add column if not exists enable_google_geocoding boolean not null default false;
