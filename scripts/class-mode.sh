#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

case "${1:-}" in
  start)
    sudo python3 network/laptop/classroom.py check
    python3 scripts/start.py
    sudo python3 network/laptop/classroom.py start
    ;;
  stop)
    sudo python3 network/laptop/classroom.py stop
    podman compose down
    ;;
  check)
    sudo python3 network/laptop/classroom.py check
    ;;
  *)
    echo "Usage: bash scripts/class-mode.sh start|stop|check" >&2
    exit 2
    ;;
esac
