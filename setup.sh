#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
command -v docker >/dev/null || { echo 'Install Docker Engine / Docker Desktop and try again.'; exit 1; }
docker compose version >/dev/null
docker info >/dev/null
interactive=()
if [[ -t 0 ]]; then interactive=(-it); fi
docker run --rm "${interactive[@]}" --user "$(id -u):$(id -g)" -v "$PWD:/project" -w /project node:22-bookworm-slim node scripts/setup.mjs "$@"
docker compose up -d --build --wait --wait-timeout 180
docker compose logs --no-log-prefix bootstrap
echo 'ErvisioDrive is running. Configuration: .env. Stop with: docker compose stop'
