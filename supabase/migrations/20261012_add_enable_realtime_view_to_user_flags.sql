-- Add enable_realtime_view feature flag to user_flags.
-- Controls access to the RealtimeView tab.
-- Defaults to false as the feature is not complete.

alter table if exists public.user_flags
  add column if not exists enable_realtime_view boolean not null default false;

update public.user_flags
  set enable_realtime_view = false
  where enable_realtime_view is null;
