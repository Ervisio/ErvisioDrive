@echo off
setlocal
cd /d "%~dp0"
where docker >nul 2>nul
if errorlevel 1 (
  echo Installa Docker Desktop con backend Linux e riprova.
  exit /b 1
)
docker compose version >nul 2>nul
if errorlevel 1 exit /b 1
docker info >nul 2>nul
if errorlevel 1 (
  echo Avvia Docker Desktop e riprova.
  exit /b 1
)
docker run --rm -it -v "%cd%:/project" -w /project node:22-bookworm-slim node scripts/setup.mjs %*
if errorlevel 1 exit /b 1
docker compose up -d --build --wait --wait-timeout 180
if errorlevel 1 exit /b 1
docker compose logs --no-log-prefix bootstrap
echo ErvisioDrive avviato. Configurazione in .env. Per fermarlo: docker compose stop
endlocal
