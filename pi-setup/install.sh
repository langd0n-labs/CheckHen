#!/usr/bin/env bash
# install.sh — one-time setup for CheckHen exam mode on a Raspberry Pi
#
# Run once from the repo root after git clone:
#   sudo ./pi-setup/install.sh
#
# What this does:
#   1. Installs hostapd and Docker (if not already installed)
#   2. Installs systemd unit files from this directory
#   3. Enables the units (but does NOT start them — use start-exam.sh for that)
#
# After this script runs, starting an exam is just:
#   sudo ./pi-setup/start-exam.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_DIR="/etc/systemd/system"
HOSTAPD_CONF_DIR="/etc/hostapd"

# --- Ensure running as root ---
if [[ $EUID -ne 0 ]]; then
  echo "ERROR: Run this script with sudo: sudo ./pi-setup/install.sh"
  exit 1
fi

echo "[install] Installing system packages..."
apt-get update -qq
apt-get install -y hostapd docker.io docker-compose-plugin

# Prevent hostapd from auto-starting on boot (we control it via start-exam.sh)
systemctl stop hostapd 2>/dev/null || true
systemctl disable hostapd 2>/dev/null || true

# --- Install hostapd config ---
echo "[install] Installing hostapd config..."
mkdir -p "$HOSTAPD_CONF_DIR"
cp "$REPO_ROOT/pi-setup/hostapd.conf" "$HOSTAPD_CONF_DIR/hostapd-exam.conf"
echo "  Copied to $HOSTAPD_CONF_DIR/hostapd-exam.conf"
echo "  IMPORTANT: Edit $HOSTAPD_CONF_DIR/hostapd-exam.conf to set your SSID and passphrase."

# --- Install systemd unit files ---
echo "[install] Installing systemd unit files..."
cp "$REPO_ROOT/pi-setup/hostapd-exam.service" "$UNIT_DIR/hostapd-exam.service"
cp "$REPO_ROOT/pi-setup/exam-nat.service" "$UNIT_DIR/exam-nat.service"

systemctl daemon-reload
# Enable so systemctl start works, but no WantedBy so they don't auto-start at boot
systemctl enable hostapd-exam exam-nat
echo "  Units enabled (will NOT auto-start at boot)."

# --- Make exam scripts executable ---
chmod +x "$REPO_ROOT/pi-setup/start-exam.sh"
chmod +x "$REPO_ROOT/pi-setup/stop-exam.sh"

# --- Add current user to docker group (avoids needing sudo for docker) ---
if [[ -n "${SUDO_USER:-}" ]]; then
  usermod -aG docker "$SUDO_USER"
  echo "[install] Added $SUDO_USER to the docker group. Log out and back in for this to take effect."
fi

echo ""
echo "[install] Setup complete."
echo "  Next steps:"
echo "  1. Edit /etc/hostapd/hostapd-exam.conf — change SSID and wpa_passphrase"
echo "  2. Edit $REPO_ROOT/dns/allowlist.conf — update checkhen.local IP to match wlan0"
echo "     (check with: ip addr show wlan0)"
echo "  3. Start an exam: sudo $REPO_ROOT/pi-setup/start-exam.sh"
