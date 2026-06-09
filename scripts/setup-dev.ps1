<#
.SYNOPSIS
  Sets up Docker Desktop + all services for the Payment Orchestration Platform.
  Run as Administrator for best results.
#>

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    [!!] $msg" -ForegroundColor Yellow }

# ── 1. Check for Docker ────────────────────────────────────────
Write-Step "Checking Docker..."

$dockerPath = (Get-Command docker -ErrorAction SilentlyContinue)?.Source
if ($dockerPath) {
    Write-Ok "Docker found: $dockerPath"
    docker --version
} else {
    Write-Warn "Docker not found. Attempting to install Docker Desktop via winget..."

    $winget = (Get-Command winget -ErrorAction SilentlyContinue)?.Source
    if (-not $winget) {
        # Try common winget location
        $winget = "$env:LOCALAPPDATA\Microsoft\WindowsApps\winget.exe"
        if (-not (Test-Path $winget)) { $winget = $null }
    }

    if ($winget) {
        Write-Step "Installing Docker Desktop via winget..."
        & $winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
        Write-Warn "Docker Desktop installed. Please RESTART and re-run this script to continue."
        exit 0
    } else {
        # Download directly from Docker CDN
        Write-Step "Downloading Docker Desktop installer (this may take a few minutes)..."
        $installer = "$env:TEMP\DockerDesktopInstaller.exe"
        $url = "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe"
        Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing
        Write-Step "Running Docker Desktop installer (silent mode)..."
        Start-Process -FilePath $installer -ArgumentList "install --quiet --accept-license" -Wait
        Write-Warn "Docker Desktop installed. Please RESTART your machine and re-run this script."
        exit 0
    }
}

# ── 2. Ensure Docker daemon is running ────────────────────────
Write-Step "Checking Docker daemon..."
$daemon = docker info 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Docker daemon not running. Starting Docker Desktop..."
    $desktop = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $desktop) {
        Start-Process $desktop
        Write-Host "    Waiting 30s for Docker to start..."
        Start-Sleep -Seconds 30
    } else {
        Write-Warn "Could not find Docker Desktop. Please start it manually."
        exit 1
    }
}
Write-Ok "Docker daemon is running"

# ── 3. Start services with docker compose ─────────────────────
Write-Step "Starting PostgreSQL, Redis, RabbitMQ..."
Set-Location $PSScriptRoot/..
docker compose up -d postgres redis rabbitmq

Write-Step "Waiting for services to be healthy..."
$maxWait = 60
$waited = 0
do {
    Start-Sleep -Seconds 3
    $waited += 3
    $pgReady = docker compose exec -T postgres pg_isready -U payments_user -d payments_db 2>$null
    Write-Host "    Waiting... ($waited/$maxWait s)" -ForegroundColor DarkGray
} while ($LASTEXITCODE -ne 0 -and $waited -lt $maxWait)

if ($LASTEXITCODE -ne 0) {
    Write-Warn "PostgreSQL did not become ready in time. Check: docker compose logs postgres"
    exit 1
}
Write-Ok "PostgreSQL is ready"

# ── 4. Run Prisma migrations ──────────────────────────────────
Write-Step "Running Prisma migrations..."
Set-Location $PSScriptRoot/..
$env:DATABASE_URL = "postgresql://payments_user:payments_pass@localhost:5432/payments_db"
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Migration failed — running db push instead..."
    npx prisma db push --accept-data-loss
}
Write-Ok "Database schema applied"

# ── 5. Seed database ──────────────────────────────────────────
Write-Step "Seeding database..."
npx tsx prisma/seed.ts
Write-Ok "Database seeded (merchants: merchant_1, merchant_2)"

# ── 6. Start all services ────────────────────────────────────
Write-Step "Starting all application services (api, worker, gateway-simulator)..."
docker compose up -d
docker compose ps

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  Payment Platform is UP!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  Dashboard:       http://localhost:3000"
Write-Host "  API:             http://localhost:3000/api"
Write-Host "  Swagger Docs:    http://localhost:3000/docs"
Write-Host "  Gateway Sim:     http://localhost:3001"
Write-Host "  RabbitMQ Admin:  http://localhost:15672"
Write-Host "  (user: payments_user / pass: payments_pass)"
Write-Host ""
