#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

image=localhost/checkhen-laptop-network:latest
state_dir="$PWD/.build-cache/laptop-state"

build_network() {
  sudo podman build -f network/laptop/Containerfile -t "$image" .
}

check_certificate() {
  local host
  host=$(sed -n 's/^AP_HOSTNAME=//p' .env | tail -n 1)
  [[ "$host" =~ ^[a-z0-9.-]+$ ]] || { echo "Set a valid AP_HOSTNAME in .env" >&2; exit 1; }
  local cert_dir="$PWD/.build-cache/letsencrypt/config/live/$host"
  test -f "$cert_dir/fullchain.pem" && test -f "$cert_dir/privkey.pem" || {
    echo "Issue the certificate for $host before starting class mode" >&2
    exit 1
  }
}

network_run() {
  local env_file status=0
  env_file=$(mktemp /tmp/checkhen-network-env.XXXXXX)
  awk -F= '$1 ~ /^(AP_INTERFACE|UPLINK_INTERFACE|AP_SUBNET|AP_ADDRESS|AP_IPV6_PREFIX|AP_IPV6_ADDRESS|AP_HOSTNAME|AP_SSID|AP_PASSPHRASE|AP_COUNTRY_CODE|AP_HW_MODE|AP_CHANNEL|PREAUTH_DOMAINS|PREAUTH_DISCOVERY|PORTAL_CONTROL_SECRET|APP_BIND_ADDRESS|NEXTAUTH_URL)$/ {print}' .env > "$env_file"
  sudo podman run --rm --privileged --network host --env-file "$env_file" \
    -e DBUS_SYSTEM_BUS_ADDRESS=unix:path=/run/dbus/system_bus_socket \
    -v "$state_dir:/run/checkhen:z" \
    -v "$PWD/.build-cache/letsencrypt/config:/certs:ro,z" \
    -v /run/dbus/system_bus_socket:/run/dbus/system_bus_socket \
    -v /sys:/sys:ro "$image" "$@" || status=$?
  rm -f "$env_file"
  return "$status"
}

case "${1:-}" in
  start)
    test -f .env || { echo "Configure the ignored .env first" >&2; exit 1; }
    mkdir -p "$state_dir"
    check_certificate
    build_network
    network_run python3 /opt/checkhen/network/laptop/classroom.py check
    if ! sudo podman compose --profile laptop up --build -d; then
      sudo podman compose --profile laptop down || true
      if test -f "$state_dir/state.json"; then
        network_run python3 /opt/checkhen/network/laptop/classroom.py stop
      fi
      exit 1
    fi
    sudo podman compose --profile laptop ps
    ;;
  stop)
    sudo podman compose --profile laptop down
    if test -f "$state_dir/state.json"; then
      network_run python3 /opt/checkhen/network/laptop/classroom.py stop
    fi
    ;;
  check)
    test -f .env || { echo "Configure the ignored .env first" >&2; exit 1; }
    mkdir -p "$state_dir"
    check_certificate
    build_network
    network_run python3 /opt/checkhen/network/laptop/classroom.py check
    ;;
  namespace-test)
    test -f .env || { echo "Configure the ignored .env first" >&2; exit 1; }
    mkdir -p "$state_dir"
    check_certificate
    build_network
    network_run python3 /opt/checkhen/network/laptop/test_namespace.py
    ;;
  domains)
    network_run python3 /opt/checkhen/network/laptop/show-domains.py
    ;;
  *)
    echo "Usage: bash scripts/class-mode.sh start|stop|check|namespace-test|domains" >&2
    exit 2
    ;;
esac
