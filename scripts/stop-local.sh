#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
run_dir="$root/.pulse-local"

stop_children() {
  local parent="$1" child
  while read -r child; do
    [[ -n "$child" ]] || continue
    stop_children "$child"
    kill -TERM "$child" 2>/dev/null || true
  done < <(pgrep -P "$parent" 2>/dev/null || true)
}

for name in web beat worker api redis; do
  pid_file="$run_dir/$name.pid"
  [[ -f "$pid_file" ]] || continue
  pid="$(cat "$pid_file")"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    stop_children "$pid"
    kill -TERM "$pid" 2>/dev/null || true
    echo "Stopped $name"
  fi
  rm -f "$pid_file"
done
