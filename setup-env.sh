#!/usr/bin/env bash
# setup-env.sh — interactive setup script for CyclingPacingCalculator
# Writes the root .env and frontend/.env files.
#
# Usage:
#   ./setup-env.sh           # prompts before overwriting existing files
#   ./setup-env.sh --force   # overwrites without asking

set -euo pipefail

FORCE=false
for arg in "$@"; do
  [[ "$arg" == "--force" ]] && FORCE=true
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Helpers ───────────────────────────────────────────────────────────────────

# ask VAR_NAME "Prompt text" "default"
ask() {
  local -n _ref="$1"
  local prompt="$2"
  local default="${3:-}"
  local display=""
  [[ -n "$default" ]] && display=" [$default]"
  read -rp "$prompt$display: " input
  _ref="${input:-$default}"
}

# ask_secret VAR_NAME "Prompt text" "default"
ask_secret() {
  local -n _ref="$1"
  local prompt="$2"
  local default="${3:-}"
  local display=""
  [[ -n "$default" ]] && display=" [****]"
  read -rsp "$prompt$display: " input
  echo ""
  _ref="${input:-$default}"
}

write_env() {
  local path="$1"
  shift
  local -a lines=("$@")

  if [[ -f "$path" && "$FORCE" != "true" ]]; then
    read -rp "$path already exists. Overwrite? (y/N): " ans
    if [[ ! "$ans" =~ ^[Yy]$ ]]; then
      echo "  Skipped $path"
      return
    fi
  fi

  printf '%s\n' "${lines[@]}" > "$path"
  echo "  Wrote $path"
}

# ── Banner ────────────────────────────────────────────────────────────────────

echo ""
echo "================================================"
echo "  CyclingPacingCalculator — Environment Setup  "
echo "================================================"
echo ""
echo "Press Enter to accept the [default] value."
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
#  SECTION 1: Backend / Docker  (.env at project root)
# ═══════════════════════════════════════════════════════════════════════════════

echo "── Backend / Docker (.env) ──────────────────────"
echo ""

echo "Database"
ask     IS_LOCAL       "  Run against local Postgres container? (true/false)" "true"
ask     DATABASE_URL   "  DATABASE_URL (direct override, leave blank to use IS_LOCAL logic)" ""
ask     DATABASE_URL_LOCAL   "  DATABASE_URL_LOCAL" "postgresql://pacing:pacing@localhost:5432/pacing"
ask     DATABASE_URL_SUPABASE "  DATABASE_URL_SUPABASE (Supabase connection string, optional)" ""
echo ""

echo "Supabase / Auth"
ask        SUPABASE_URL      "  SUPABASE_URL (e.g. https://<ref>.supabase.co)" ""
ask_secret SUPABASE_JWT_SECRET "  SUPABASE_JWT_SECRET" "change-me-in-production"
ask        SUPABASE_ANON_KEY "  SUPABASE_ANON_KEY (optional)" ""
echo ""

echo "Frontend / CORS"
ask FRONTEND_URL "  FRONTEND_URL (CORS allowed origin)" "http://localhost:8000"
echo ""

echo "Google (OAuth + Places)"
ask        GOOGLE_CLIENT_ID     "  GOOGLE_CLIENT_ID" ""
ask_secret GOOGLE_CLIENT_SECRET "  GOOGLE_CLIENT_SECRET" ""
ask_secret GOOGLE_PLACES_API_KEY "  GOOGLE_PLACES_API_KEY (optional)" ""
echo ""

echo "RideWithGPS (optional)"
ask_secret RIDEWITHGPS_API_KEY       "  RIDEWITHGPS_API_KEY" ""
ask        RIDEWITHGPS_CLIENT_ID     "  RIDEWITHGPS_CLIENT_ID" ""
ask_secret RIDEWITHGPS_CLIENT_SECRET "  RIDEWITHGPS_CLIENT_SECRET" ""
echo ""

echo "Misc"
ask_secret WEATHER_API_KEY           "  WEATHER_API_KEY (optional)" ""
ask        COOKIE_SECURE             "  COOKIE_SECURE (true for HTTPS/production)" "false"
ask        VITE_ENABLE_SERVER_FUNCTIONS "  VITE_ENABLE_SERVER_FUNCTIONS (Docker build-arg)" "true"
echo ""

ROOT_ENV_LINES=(
  "# ── Database ────────────────────────────────────────────────────────────────"
  "IS_LOCAL=${IS_LOCAL}"
  "DATABASE_URL=${DATABASE_URL}"
  "DATABASE_URL_LOCAL=${DATABASE_URL_LOCAL}"
  "DATABASE_URL_SUPABASE=${DATABASE_URL_SUPABASE}"
  ""
  "# ── Auth / Supabase ─────────────────────────────────────────────────────────"
  "SUPABASE_URL=${SUPABASE_URL}"
  "SUPABASE_JWT_SECRET=${SUPABASE_JWT_SECRET}"
  "SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}"
  ""
  "# ── CORS ────────────────────────────────────────────────────────────────────"
  "FRONTEND_URL=${FRONTEND_URL}"
  ""
  "# ── Google ──────────────────────────────────────────────────────────────────"
  "GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}"
  "GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}"
  "GOOGLE_PLACES_API_KEY=${GOOGLE_PLACES_API_KEY}"
  ""
  "# ── RideWithGPS ─────────────────────────────────────────────────────────────"
  "RIDEWITHGPS_API_KEY=${RIDEWITHGPS_API_KEY}"
  "RIDEWITHGPS_CLIENT_ID=${RIDEWITHGPS_CLIENT_ID}"
  "RIDEWITHGPS_CLIENT_SECRET=${RIDEWITHGPS_CLIENT_SECRET}"
  ""
  "# ── Misc ────────────────────────────────────────────────────────────────────"
  "WEATHER_API_KEY=${WEATHER_API_KEY}"
  "COOKIE_SECURE=${COOKIE_SECURE}"
  "VITE_ENABLE_SERVER_FUNCTIONS=${VITE_ENABLE_SERVER_FUNCTIONS}"
)

# ═══════════════════════════════════════════════════════════════════════════════
#  SECTION 2: Frontend  (frontend/.env)
# ═══════════════════════════════════════════════════════════════════════════════

echo "── Frontend (frontend/.env) ─────────────────────"
echo ""

ask        F_VITE_SERVER_FNS "  VITE_ENABLE_SERVER_FUNCTIONS" "$VITE_ENABLE_SERVER_FUNCTIONS"
ask        F_SUPABASE_URL    "  VITE_SUPABASE_URL" "$SUPABASE_URL"
ask_secret F_SUPABASE_ANON  "  VITE_SUPABASE_ANON_KEY" ""
ask        F_GOOGLE_CLIENT   "  VITE_GOOGLE_CLIENT_ID" "$GOOGLE_CLIENT_ID"
echo ""

FRONTEND_ENV_LINES=(
  "# Frontend environment variables — generated by setup-env.sh"
  "# Do NOT commit this file to version control."
  "VITE_ENABLE_SERVER_FUNCTIONS=${F_VITE_SERVER_FNS}"
  "VITE_SUPABASE_URL=${F_SUPABASE_URL}"
  "VITE_SUPABASE_ANON_KEY=${F_SUPABASE_ANON}"
  "VITE_GOOGLE_CLIENT_ID=${F_GOOGLE_CLIENT}"
)

# ── Write files ───────────────────────────────────────────────────────────────

write_env "$SCRIPT_DIR/.env"          "${ROOT_ENV_LINES[@]}"
write_env "$SCRIPT_DIR/frontend/.env" "${FRONTEND_ENV_LINES[@]}"

echo ""
echo "Done. Next steps:"
echo "  Docker:    docker compose up -d --build"
echo "  Dev API:   uvicorn pacing.api.main:app --reload"
echo "  Dev UI:    cd frontend && npm run dev"
echo ""
