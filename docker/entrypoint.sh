#!/bin/sh
set -e

echo "[entrypoint] running migrations..."
# `node --import tsx`, not node_modules/.bin/tsx: the image is built with
# `pnpm deploy --ignore-scripts`, which does not link the deployed package's
# bins (measured 2026-10-25: 8 root bins, no tsx). This resolves the tsx
# package itself, so it needs no bin link.
node --import tsx server/db/migrate.ts

echo "[entrypoint] starting server..."
exec node .output/server/index.mjs
