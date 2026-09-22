-- Enable all Google feature flags by default for newly created users.

alter table if exists public.user_flags
  alter column enable_google_places set default true;

alter table if exists public.user_flags
  alter column enable_google_maps set default true;

alter table if exists public.user_flags
  alter column enable_google_geocoding set default true;