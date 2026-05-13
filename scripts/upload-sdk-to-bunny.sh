#!/usr/bin/env bash
# Uploads packages/saas-client/dist/ to Bunny.net Storage at:
#   /client/v{semver}.js         (immutable, long cache)
#   /client/v{semver}.mjs
#   /client/v{semver}.js.map
#   /client/v{semver}.mjs.map
#   /client/v{major}.js          (latest stable alias for the major line)
#   /client/v{major}.mjs
#
# Required env:
#   BUNNY_STORAGE_ZONE  — Bunny Storage zone name (e.g. grundtone-cdn)
#   BUNNY_API_KEY       — Storage zone password from Bunny dashboard
#   PUBLISHED_PACKAGES  — JSON from changesets/action: [{name, version}, ...]
#
# Called from sdk-release.yml after `pnpm release:sdk` succeeds.

set -euo pipefail

if [[ -z "${BUNNY_STORAGE_ZONE:-}" || -z "${BUNNY_API_KEY:-}" ]]; then
  echo "✗ BUNNY_STORAGE_ZONE and BUNNY_API_KEY must be set" >&2
  exit 1
fi

VERSION=$(printf '%s' "${PUBLISHED_PACKAGES:-[]}" | \
  jq -r '.[] | select(.name == "@grundtone/saas-client") | .version' | head -n1)

if [[ -z "$VERSION" ]]; then
  echo "ℹ no @grundtone/saas-client release in this run — skipping CDN upload"
  exit 0
fi

MAJOR="${VERSION%%.*}"
DIST="packages/saas-client/dist"
BASE_URL="https://storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}/client"

upload() {
  local src=$1
  local dest=$2
  echo "→ $dest"
  curl --fail --silent --show-error \
    -X PUT \
    -H "AccessKey: ${BUNNY_API_KEY}" \
    -H "Content-Type: application/octet-stream" \
    --data-binary "@${src}" \
    "${BASE_URL}/${dest}"
}

upload "${DIST}/index.umd.js"      "v${VERSION}.js"
upload "${DIST}/index.mjs"         "v${VERSION}.mjs"
upload "${DIST}/index.umd.js.map"  "v${VERSION}.js.map"
upload "${DIST}/index.mjs.map"     "v${VERSION}.mjs.map"
upload "${DIST}/index.umd.js.sri"  "v${VERSION}.js.sri"
upload "${DIST}/index.mjs.sri"     "v${VERSION}.mjs.sri"

upload "${DIST}/index.umd.js"      "v${MAJOR}.js"
upload "${DIST}/index.mjs"         "v${MAJOR}.mjs"
upload "${DIST}/index.umd.js.sri"  "v${MAJOR}.js.sri"
upload "${DIST}/index.mjs.sri"     "v${MAJOR}.mjs.sri"

# Purge the major-alias from Bunny's pull-cache so the new bytes are served
# immediately. The versioned paths don't need purging — they're new keys.
echo "→ purge v${MAJOR} aliases"
curl --fail --silent --show-error \
  -X POST \
  -H "AccessKey: ${BUNNY_API_KEY}" \
  "https://api.bunny.net/pullzone/purge?url=https://cdn.grundtone.io/client/v${MAJOR}.js" \
  || true
curl --fail --silent --show-error \
  -X POST \
  -H "AccessKey: ${BUNNY_API_KEY}" \
  "https://api.bunny.net/pullzone/purge?url=https://cdn.grundtone.io/client/v${MAJOR}.mjs" \
  || true

echo "✓ uploaded @grundtone/saas-client@${VERSION} to Bunny.net"
