#!/usr/bin/env bash
set -euo pipefail

cd /opt/pulse-app

# Keep concurrent runs from changing the same Compose project.
exec 9>/home/sajid/pulse-deploy.lock
flock -x 9

git diff --quiet
git diff --cached --quiet
git fetch origin main
git merge --ff-only origin/main
docker compose config --quiet
docker compose up -d --build

for attempt in {1..20}; do
  if curl -fsS http://127.0.0.1:18080/health >/dev/null &&
     curl -fsS http://127.0.0.1:13000/login >/dev/null &&
     curl -fsS http://127.0.0.1:13001/ >/dev/null; then
    echo "Pulse healthy at $(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 3
done

docker compose ps
docker compose logs --tail=80 api web landing
exit 1
