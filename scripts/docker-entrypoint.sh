#!/bin/sh
# docker-entrypoint.sh — runs once per container start.
#
# 1. Apply pending Prisma migrations (idempotent — `migrate deploy` is a no-op
#    when the DB is already at the latest migration).
# 2. exec the CMD so PID 1 is the Node process (signals reach the app).

set -e

echo "[entrypoint] applying Prisma migrations..."
npx --no-install prisma migrate deploy

echo "[entrypoint] starting: $*"
exec "$@"
