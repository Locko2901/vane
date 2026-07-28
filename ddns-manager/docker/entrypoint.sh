#!/bin/sh
set -e

export DATABASE_URL="file:${DATA_DIR:-/data}/ddns-manager.db"

echo "[entrypoint] Ensuring database schema…"
npx prisma db push --schema=./prisma/schema.prisma --skip-generate --accept-data-loss

echo "[entrypoint] Starting Vane…"
exec node dist/index.js
