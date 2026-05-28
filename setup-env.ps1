<#
.SYNOPSIS
    Interactive setup script — writes the root .env and frontend/.env files.
    Run once before `docker compose up` or `npm run dev`.

.USAGE
    .\setup-env.ps1

    Add -Force to overwrite existing .env files without being prompted.
#>
param(
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Helpers ───────────────────────────────────────────────────────────────────

function Ask {
    param(
        [string]$Prompt,
        [string]$Default = "",
        [switch]$Secret
    )
    $display = if ($Default -ne "") { " [$Default]" } else { "" }
    if ($Secret) {
        $raw = Read-Host -Prompt "$Prompt$display" -AsSecureString
        $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($raw))
        if ($plain -eq "") { return $Default }
        return $plain
    } else {
        $raw = Read-Host -Prompt "$Prompt$display"
        if ($raw -eq "") { return $Default }
        return $raw
    }
}

function Write-Env {
    param([string]$Path, [System.Collections.Specialized.OrderedDictionary]$Vars)

    if ((Test-Path $Path) -and -not $Force) {
        $ans = Read-Host "$Path already exists. Overwrite? (y/N)"
        if ($ans -notmatch '^[Yy]') {
            Write-Host "  Skipped $Path" -ForegroundColor Yellow
            return
        }
    }

    $lines = @()
    foreach ($entry in $Vars.GetEnumerator()) {
        if ($entry.Key.StartsWith("#")) {
            $lines += ""
            $lines += $entry.Key   # comment line
        } else {
            $lines += "$($entry.Key)=$($entry.Value)"
        }
    }
    $lines | Set-Content -Path $Path -Encoding UTF8
    Write-Host "  Wrote $Path" -ForegroundColor Green
}

# ── Banner ────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  CyclingPacingCalculator — Environment Setup  " -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press Enter to accept the [default] value." -ForegroundColor DarkGray
Write-Host "Secrets are masked as you type." -ForegroundColor DarkGray
Write-Host ""

# ═══════════════════════════════════════════════════════════════════════════════
#  SECTION 1: Backend / Docker  (.env at project root)
# ═══════════════════════════════════════════════════════════════════════════════

Write-Host "── Backend / Docker (.env) ──────────────────────" -ForegroundColor Cyan
Write-Host ""

# Database
Write-Host "Database" -ForegroundColor Yellow
$isLocal      = Ask "  Run against local Postgres container? (true/false)" "true"
$dbUrl        = Ask "  DATABASE_URL (direct override, leave blank to use IS_LOCAL logic)" ""
$dbUrlLocal   = Ask "  DATABASE_URL_LOCAL" "postgresql://pacing:pacing@localhost:5432/pacing"
$dbUrlSupa    = Ask "  DATABASE_URL_SUPABASE (Supabase connection string, optional)" ""

Write-Host ""

# Supabase / Auth
Write-Host "Supabase / Auth" -ForegroundColor Yellow
$supabaseUrl   = Ask "  SUPABASE_URL (e.g. https://<ref>.supabase.co)" ""
$supabaseJwt   = Ask "  SUPABASE_JWT_SECRET" "change-me-in-production" -Secret
$supabaseAnonKey = Ask "  SUPABASE_ANON_KEY (service-role or anon key used by backend, optional)" ""

Write-Host ""

# Frontend / CORS
Write-Host "Frontend / CORS" -ForegroundColor Yellow
$frontendUrl  = Ask "  FRONTEND_URL (CORS allowed origin)" "http://localhost:8000"

Write-Host ""

# Google
Write-Host "Google (OAuth + Places)" -ForegroundColor Yellow
$googleClientId     = Ask "  GOOGLE_CLIENT_ID" ""
$googleClientSecret = Ask "  GOOGLE_CLIENT_SECRET" "" -Secret
$googlePlacesKey    = Ask "  GOOGLE_PLACES_API_KEY (optional)" "" -Secret

Write-Host ""

# RideWithGPS
Write-Host "RideWithGPS (optional)" -ForegroundColor Yellow
$rwgpsApiKey        = Ask "  RIDEWITHGPS_API_KEY" "" -Secret
$rwgpsClientId      = Ask "  RIDEWITHGPS_CLIENT_ID" ""
$rwgpsClientSecret  = Ask "  RIDEWITHGPS_CLIENT_SECRET" "" -Secret

Write-Host ""

# Misc
Write-Host "Misc" -ForegroundColor Yellow
$weatherApiKey  = Ask "  WEATHER_API_KEY (optional)" "" -Secret
$cookieSecure   = Ask "  COOKIE_SECURE (true for HTTPS/production, false for local)" "false"
$viteServerFns  = Ask "  VITE_ENABLE_SERVER_FUNCTIONS (Docker build-arg)" "true"

Write-Host ""

# Build root .env ordered dict
$rootEnv = [ordered]@{
    "# ── Database ────────────────────────────────────────────────────────────────" = ""
    "IS_LOCAL"                 = $isLocal
    "DATABASE_URL"             = $dbUrl
    "DATABASE_URL_LOCAL"       = $dbUrlLocal
    "DATABASE_URL_SUPABASE"    = $dbUrlSupa
    "# ── Auth / Supabase ─────────────────────────────────────────────────────────" = ""
    "SUPABASE_URL"             = $supabaseUrl
    "SUPABASE_JWT_SECRET"      = $supabaseJwt
    "SUPABASE_ANON_KEY"        = $supabaseAnonKey
    "# ── CORS ────────────────────────────────────────────────────────────────────" = ""
    "FRONTEND_URL"             = $frontendUrl
    "# ── Google ──────────────────────────────────────────────────────────────────" = ""
    "GOOGLE_CLIENT_ID"         = $googleClientId
    "GOOGLE_CLIENT_SECRET"     = $googleClientSecret
    "GOOGLE_PLACES_API_KEY"    = $googlePlacesKey
    "# ── RideWithGPS ─────────────────────────────────────────────────────────────" = ""
    "RIDEWITHGPS_API_KEY"      = $rwgpsApiKey
    "RIDEWITHGPS_CLIENT_ID"    = $rwgpsClientId
    "RIDEWITHGPS_CLIENT_SECRET" = $rwgpsClientSecret
    "# ── Misc ────────────────────────────────────────────────────────────────────" = ""
    "WEATHER_API_KEY"          = $weatherApiKey
    "COOKIE_SECURE"            = $cookieSecure
    "VITE_ENABLE_SERVER_FUNCTIONS" = $viteServerFns
}

# ═══════════════════════════════════════════════════════════════════════════════
#  SECTION 2: Frontend  (frontend/.env)
# ═══════════════════════════════════════════════════════════════════════════════

Write-Host "── Frontend (frontend/.env) ─────────────────────" -ForegroundColor Cyan
Write-Host ""

$fViteServerFns = Ask "  VITE_ENABLE_SERVER_FUNCTIONS" $viteServerFns
$fSupabaseUrl   = Ask "  VITE_SUPABASE_URL" $supabaseUrl
$fSupabaseAnon  = Ask "  VITE_SUPABASE_ANON_KEY" "" -Secret
$fGoogleClient  = Ask "  VITE_GOOGLE_CLIENT_ID" $googleClientId

Write-Host ""

$frontendEnv = [ordered]@{
    "# Frontend environment variables — generated by setup-env.ps1" = ""
    "# Do NOT commit this file to version control." = ""
    "VITE_ENABLE_SERVER_FUNCTIONS" = $fViteServerFns
    "VITE_SUPABASE_URL"           = $fSupabaseUrl
    "VITE_SUPABASE_ANON_KEY"      = $fSupabaseAnon
    "VITE_GOOGLE_CLIENT_ID"       = $fGoogleClient
}

# ── Write files ───────────────────────────────────────────────────────────────

$scriptDir = $PSScriptRoot
Write-Env -Path (Join-Path $scriptDir ".env")           -Vars $rootEnv
Write-Env -Path (Join-Path $scriptDir "frontend\.env")  -Vars $frontendEnv

Write-Host ""
Write-Host "Done. Next steps:" -ForegroundColor Cyan
Write-Host "  Docker:    docker compose up -d --build" -ForegroundColor White
Write-Host "  Dev API:   uvicorn pacing.api.main:app --reload" -ForegroundColor White
Write-Host "  Dev UI:    cd frontend ; npm run dev" -ForegroundColor White
Write-Host ""
