#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

image=localhost/checkhen-tools:latest
if ! podman image exists "$image"; then
  podman build -f network/tools/Containerfile -t "$image" .
fi

run_tool() {
  podman run --rm -it --network host --security-opt label=disable \
    -v "$PWD:/work" -w /work "$@"
}

case "${1:-}" in
  credentials)
    ~/bin/agent-credential run --project fishjump -- \
      podman run --rm --network host --security-opt label=disable \
      -v "$PWD:/work" -w /work \
      -e CHECKHEN_GOOGLE_CLIENT_ID -e CHECKHEN_GOOGLE_CLIENT_SECRET \
      "$image" python3 scripts/configure-credentials.py
    ;;
  certificate)
    ~/bin/agent-credential run --project fishjump -- \
      podman run --rm --network host --security-opt label=disable \
      -v "$PWD:/work" -w /work -e BUZZ_CLOUDFLARE_DNS_TOKEN \
      "$image" python3 scripts/issue-cert.py
    ;;
  admin) run_tool "$image" python3 scripts/configure-admin.py ;;
  ap) run_tool "$image" python3 scripts/configure-ap.py ;;
  preauth) shift; run_tool "$image" python3 scripts/configure-preauth.py "$@" ;;
  *)
    echo "Usage: bash scripts/container-tools.sh credentials|certificate|admin|ap|preauth [discover|lock ...]" >&2
    exit 2
    ;;
esac
