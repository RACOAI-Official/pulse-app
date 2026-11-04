#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
run_dir="$root/.pulse-local"
mkdir -p "$run_dir"

if [[ ! -x "$root/apps/api/.venv/bin/uvicorn" || ! -x "$root/apps/api/.venv/bin/celery" ]]; then
  echo "Install API dependencies in apps/api/.venv first." >&2
  exit 1
fi
if [[ ! -d "$root/apps/web/node_modules" ]]; then
  echo "Run npm ci in apps/web first." >&2
  exit 1
fi

start() {
  local name="$1"
  shift
  if [[ -f "$run_dir/$name.pid" ]] && kill -0 "$(cat "$run_dir/$name.pid")" 2>/dev/null; then
    echo "$name already running"
    return
  fi
  PULSE_ROOT="$root" PULSE_RUN_DIR="$run_dir" PULSE_SERVICE="$name" python3 - "$@" <<'PY'
import os
import subprocess
import sys
from pathlib import Path

run_dir = Path(os.environ["PULSE_RUN_DIR"])
with (run_dir / f'{os.environ["PULSE_SERVICE"]}.log').open("ab") as log:
    process = subprocess.Popen(
        sys.argv[1:], cwd=os.environ["PULSE_ROOT"],
        env={**os.environ, "PYTHONPATH": "apps/api"},
        stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
        start_new_session=True,
    )
(run_dir / f'{os.environ["PULSE_SERVICE"]}.pid').write_text(str(process.pid))
PY
  echo "Started $name (log: $run_dir/$name.log)"
}

if ! redis-cli ping >/dev/null 2>&1; then
  start redis redis-server --port 6379 --save '' --appendonly no
else
  echo "Using existing Redis on port 6379"
fi

if curl -fsS http://localhost:8000/health >/dev/null 2>&1; then
  echo "Using existing API on port 8000"
else
  start api "$root/apps/api/.venv/bin/uvicorn" pulse_api.main:app --port 8000
fi
start worker "$root/apps/api/.venv/bin/celery" -A pulse_api.tasks.celery_app worker --pool=solo --concurrency=1 --loglevel=info
start beat "$root/apps/api/.venv/bin/celery" -A pulse_api.tasks.celery_app beat --loglevel=info --schedule "$run_dir/celerybeat-schedule"
if curl -fsS http://localhost:3000/login >/dev/null 2>&1; then
  echo "Using existing web app on port 3000"
else
  start web npm --prefix "$root/apps/web" run dev
fi
echo "Pulse: http://localhost:3000"
