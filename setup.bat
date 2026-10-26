@echo off
setlocal
cd /d "%~dp0"
where docker >nul 2>nul
if errorlevel 1 (
  echo Install Docker Desktop with Linux containers and try again.
  exit /b 1
)
docker compose version >nul 2>nul
if errorlevel 1 exit /b 1
docker info >nul 2>nul
if errorlevel 1 (
  echo Start Docker Desktop and try again.
  exit /b 1
)
docker run --rm -it -v "%cd%:/project" -w /project node:22-bookworm-slim node scripts/setup.mjs %*
if errorlevel 1 exit /b 1
docker compose up -d --build --wait --wait-timeout 180
if errorlevel 1 exit /b 1
docker compose logs --no-log-prefix bootstrap
echo ErvisioDrive is running. Configuration: .env. Stop with: docker compose stop
endlocal
