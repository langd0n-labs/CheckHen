#!/usr/bin/env bash
# Rebuild disposable local databases and run the three Postgres integration scripts.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
admin_url=${CHECKHEN_TEST_PG_ADMIN_URL:?Set a local PostgreSQL admin URL ending in /postgres}
mapfile -t urls < <(python3 - "$admin_url" <<'PY'
from urllib.parse import urlparse
import sys
url = sys.argv[1]
parsed = urlparse(url)
if parsed.scheme not in ('postgres', 'postgresql') or parsed.hostname not in ('localhost', '127.0.0.1') or parsed.path != '/postgres' or parsed.query:
    raise SystemExit('Use a local PostgreSQL admin URL ending in /postgres, without a query string')
base = url.rsplit('/', 1)[0]
print(base + '/checkhen_test')
print(base + '/checkhen_legacy_test')
PY
)
[[ ${#urls[@]} -eq 2 ]] || { echo 'Invalid local PostgreSQL admin URL' >&2; exit 2; }
test_url=${urls[0]}
legacy_url=${urls[1]}
for tool in psql corepack node; do
  command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 2; }
done

app="$root/checkhen"
schema="$app/prisma/schema.prisma"
prisma="$app/node_modules/.bin/prisma"
tsx="$app/node_modules/.bin/tsx"
(cd "$app" && corepack yarn install --immutable)
for name in checkhen_test checkhen_legacy_test; do
  psql "$admin_url" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $name WITH (FORCE)"
  psql "$admin_url" -v ON_ERROR_STOP=1 -c "CREATE DATABASE $name"
done
DATABASE_URL=$test_url "$prisma" generate --schema "$schema"
DATABASE_URL=$test_url "$prisma" migrate deploy --schema "$schema"
(cd "$app" && DATABASE_URL=$test_url "$tsx" scripts/test-event-store.ts)

old=$(mktemp -d /tmp/checkhen-legacy-migrations.XXXXXX)
trap 'rm -rf -- "$old"; if [[ -n "${socket_pid:-}" ]]; then kill "$socket_pid" 2>/dev/null || true; wait "$socket_pid" 2>/dev/null || true; fi' EXIT
cp "$schema" "$old/schema.prisma"
mkdir "$old/migrations"
cp "$app/prisma/migrations/migration_lock.toml" "$old/migrations/"
for migration in "$app"/prisma/migrations/*/; do
  name=${migration%/}; name=${name##*/}
  [[ "$name" < 20261003000000_courses_and_events ]] && cp -R "$migration" "$old/migrations/"
done
DATABASE_URL=$legacy_url "$prisma" migrate deploy --schema "$old/schema.prisma"
psql "$legacy_url" -v ON_ERROR_STOP=1 -f "$app/scripts/legacy-fixture.sql"
DATABASE_URL=$legacy_url "$prisma" migrate deploy --schema "$schema"
(cd "$app" && DATABASE_URL=$legacy_url "$tsx" scripts/test-legacy-import.ts)

(cd "$root/socket-server" && corepack yarn install --immutable && corepack yarn prisma-gen && corepack yarn build)
AUTH_SECRET=checkhen-disposable-test-secret DATABASE_URL=$test_url PORT=6061 \
  node "$root/socket-server/dist/index.js" >"$old/socket.log" 2>&1 &
socket_pid=$!
for _ in $(seq 1 30); do
  if (echo >/dev/tcp/127.0.0.1/6061) 2>/dev/null; then break; fi
  sleep 1
done
(cd "$app" && DATABASE_URL=$test_url TEST_AUTH_SECRET=checkhen-disposable-test-secret \
  TEST_SOCKET_URL=http://127.0.0.1:6061 "$tsx" scripts/test-socket-isolation.ts)
echo 'PASS: event store, legacy import, and socket isolation'
