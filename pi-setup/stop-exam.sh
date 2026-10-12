#!/usr/bin/env bash
# stop-exam.sh — tear down the CheckHen exam environment
#
# Run from the repo root: sudo ./pi-setup/stop-exam.sh
# Safe to run multiple times (systemd stop is idempotent).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "[stop-exam] Stopping dnsmasq DNS filter container..."
cd "$REPO_ROOT"
docker compose --profile exam stop dns

echo "[stop-exam] Removing NAT + FORWARD rules..."
sudo systemctl stop exam-nat

echo "[stop-exam] Stopping hostapd AP..."
sudo systemctl stop hostapd-exam

echo "[stop-exam] Done. Pi is back to normal operation."
