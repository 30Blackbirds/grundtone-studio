#!/bin/sh
set -e

echo "[entrypoint] running migrations..."
node_modules/.bin/tsx server/db/migrate.ts

echo "[entrypoint] starting server..."
exec node .output/server/index.mjs
