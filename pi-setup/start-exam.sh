#!/usr/bin/env bash
# start-exam.sh — bring up the CheckHen closed-internet exam environment
#
# Run from the repo root: sudo ./pi-setup/start-exam.sh
# Requires: install.sh has been run once on this Pi.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "[start-exam] Starting hostapd AP..."
sudo systemctl start hostapd-exam

echo "[start-exam] Starting NAT + FORWARD rules..."
sudo systemctl start exam-nat

echo "[start-exam] Starting dnsmasq DNS filter container..."
cd "$REPO_ROOT"
docker compose --profile exam up -d dns

echo "[start-exam] Done. Students can connect to the exam WiFi."
echo "  To verify DNS filtering: nslookup example.com <Pi wlan0 IP>"
echo "  To stop: sudo ./pi-setup/stop-exam.sh"
