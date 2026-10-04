#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
(cd "$root/packages/slidev-chat" && npm test)
