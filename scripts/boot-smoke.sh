#!/usr/bin/env bash
#
# Boot-smoke: imaget SKAL komme op, svare healthz og servere en rigtig side.
#
# Historik (v0.2.11-incidenten, 2026-08-03): crashloopet — Nitro tabte
# transitive OTel-deps fra runtime-node_modules — bootede fint lokalt. Kun det
# prunede image fejlede. Kun ved at KØRE selve imaget fanges den klasse.
#
# 🔴 Hvorfor scriptet PRINTER det image-ID det kørte (sidste linje på stdout):
# runde 6 af samme incident testede stiltiende forrige runs registry-image, og
# tre runder "fejlede" på et gammelt artefakt mens de reelle builds aldrig blev
# målt. At binde buildet til daemonen er ikke nok — kalderen skal kunne binde
# SMOKEN til buildet. Forskellen på "et image blev bygget og en smoke bestod"
# og "smoken bestod på DET image" ([infra], 2026-08-11).
#
# Kontrakt:
#   stdout  = NØJAGTIG det image-ID der blev kørt, intet andet
#   stderr  = al diagnostik
#   exit    = 0 only if healthz answers, /login returns 200, the SDK
#             contract files are served (see the /client block below), and
#             every /client URL shown on /docs/install answers 200
#
# Brug:  scripts/boot-smoke.sh <image-ref>
#        BOOT_SMOKE_PORT=3987 scripts/boot-smoke.sh <image-ref>
set -euo pipefail

IMAGE="${1:?brug: boot-smoke.sh <image-ref>}"
# Porten er parametrisérbar, fordi en optaget 3000 ellers giver den værste
# fejl der findes: `docker run` fejler, men curl mod 127.0.0.1:3000 rammer
# HVAD DER ELLERS LYTTER og svarer 200. Målt 2026-08-11 — en fremmed container
# gav et grønt boot-smoke-resultat for et image der aldrig startede.
PORT="${BOOT_SMOKE_PORT:-3000}"
NET="smokenet-$$"
DB="smokedb-$$"
APP="bootsmoke-$$"

log() { echo "$@" >&2; }
cleanup() {
  docker rm -f "$APP" "$DB" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

log "smoker $IMAGE (port $PORT)"
docker network create "$NET" >/dev/null

# Rigtig Postgres frem for en dummy: entrypointet kører migrationer FØR
# serveren starter, så en dummy-DB gav migrate-crash før noget andet blev
# målt. Sidecar'en gør smoken trofast og validerer migrationskæden mod en
# tom database på samme tid.
docker run -d --name "$DB" --network "$NET" \
  -e POSTGRES_PASSWORD=smoke postgres:16-alpine >/dev/null
for i in $(seq 1 15); do
  docker exec "$DB" pg_isready -U postgres >/dev/null 2>&1 && break
  [ "$i" = 15 ] && { log "✗ postgres-sidecar kom aldrig op"; exit 1; }
  sleep 2
done

# Dummy-env: appen booter uden rigtige backends og renderer SSR-skaller.
# OTel-endpointet sættes TIL, så telemetri-stien øves frem for at springes over
# — det var præcis den sti, v0.2.11 knækkede på.
docker run -d --name "$APP" --network "$NET" -p "$PORT:3000" \
  -e DATABASE_URL="postgres://postgres:smoke@$DB:5432/postgres" \
  -e NUXT_PUBLIC_AUTH_URL="http://127.0.0.1:9" \
  -e OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:4318" \
  "$IMAGE" >/dev/null

# Assertér at containeren FAKTISK kører, før vi curler. Uden den læses et svar
# fra en anden lytter på porten som vores eget.
[ "$(docker inspect -f '{{.State.Running}}' "$APP")" = 'true' ] \
  || { log "✗ containeren startede ikke"; docker logs "$APP" 2>&1 | tail -30 >&2; exit 1; }

for i in $(seq 1 18); do
  if curl -sf "http://127.0.0.1:$PORT/api/healthz" >/dev/null; then
    log "✓ image boots (healthz)"
    break
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$APP")" != 'true' ]; then
    log "✗ container died during boot"; docker logs "$APP" 2>&1 | tail -50 >&2; exit 1
  fi
  [ "$i" = 18 ] && { log "✗ boot-smoke timed out"; docker logs "$APP" 2>&1 | tail -50 >&2; exit 1; }
  sleep 5
done

code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/login")
[ "$code" = '200' ] \
  || { log "✗ /login returned $code in boot-smoke"; docker logs "$APP" 2>&1 | tail -50 >&2; exit 1; }
log "✓ /login 200 in boot-smoke"

# The SDK is served from this image (KH-988): the Bunny pull zone uses studio as
# its origin, so a bundle missing here is a bundle missing on the CDN. A status
# code alone is not enough, because a catch-all can also answer 200. Each file
# must carry its own content type.
#
# Two sources since KH-991, and each gets the check that means something for it:
#   v<major>.*  the LATEST build, from the dist. It must be byte-identical to the
#               committed files of the CURRENT contract version — if it is not,
#               the SDK changed without bumping SDK_CONTRACT_VERSION.
#   v<x.y.z>.*  EVERY committed version, from apps/studio/sdk-contract/. Each must
#               be served with its exact committed bytes, and each bundle must
#               hash to its committed SRI. This is what keeps an SRI pin on an
#               OLDER version working after a bump.
# (Before KH-991 this block compared the served v<contract>.sri with the
# committed one. The image now serves that file FROM the committed directory, so
# that comparison would be circular — it could no longer fail.)
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CONTRACT_FILE="$ROOT/apps/studio/utils/sdk-contract.ts"
CONTRACT_DIR="$ROOT/apps/studio/sdk-contract"
contract=$(sed -n "s/^export const SDK_CONTRACT_VERSION = '\([0-9][0-9.]*\)'$/\1/p" "$CONTRACT_FILE")
[ -n "$contract" ] && [ "$(printf '%s\n' "$contract" | wc -l | tr -d ' ')" = 1 ] \
  || { log "✗ could not read exactly one SDK_CONTRACT_VERSION from $CONTRACT_FILE (got '$contract')"; exit 1; }
major=${contract%%.*}
log "SDK contract v$contract (major v$major)"

sdk_get() { curl -s -o "$2" -w '%{http_code} %{content_type}' "http://127.0.0.1:$PORT$1"; }
content_type() {
  case "$1" in
    *.map) echo application/json ;;
    *.sri) echo text/plain ;;
    *) echo application/javascript ;;
  esac
}
sdk_fetch() {
  local file=$1 want got
  want=$(content_type "$file")
  got=$(sdk_get "/client/$file" "$SDK_TMP/$file")
  case "$got" in
    "200 $want"*) ;;
    *) log "✗ /client/$file returned '$got', want '200 $want'"; docker logs "$APP" 2>&1 | tail -50 >&2; exit 1 ;;
  esac
}
SDK_TMP=$(mktemp -d)

# 1. Latest build == committed current version.
for ext in js mjs; do
  sdk_fetch "v$major.$ext"
  cmp -s "$SDK_TMP/v$major.$ext" "$CONTRACT_DIR/v$contract.$ext" \
    || { log "✗ /client/v$major.$ext differs from the committed v$contract.$ext — the SDK bytes changed without bumping SDK_CONTRACT_VERSION"; exit 1; }
  log "✓ /client/v$major.$ext is byte-identical to the committed v$contract.$ext"
done

# 2. Every committed version, served byte for byte and self-consistent.
versions=$(find "$CONTRACT_DIR" -maxdepth 1 -name 'v*.js' -exec basename {} .js \; | sort)
[ -n "$versions" ] || { log "✗ no committed contract versions under $CONTRACT_DIR"; exit 1; }
nversions=0
for v in $versions; do
  for ext in js mjs js.map mjs.map js.sri mjs.sri; do
    sdk_fetch "$v.$ext"
    cmp -s "$SDK_TMP/$v.$ext" "$CONTRACT_DIR/$v.$ext" \
      || { log "✗ /client/$v.$ext is not the committed $v.$ext"; exit 1; }
  done
  for ext in js mjs; do
    sri=$(tr -d '\n' < "$SDK_TMP/$v.$ext.sri")
    calc="sha384-$(openssl dgst -sha384 -binary "$SDK_TMP/$v.$ext" | openssl base64 -A)"
    [ "$sri" = "$calc" ] \
      || { log "✗ /client/$v.$ext hashes to $calc, but /client/$v.$ext.sri says '$sri'"; exit 1; }
  done
  nversions=$((nversions + 1))
  log "✓ /client/$v.* — 6 files served with their committed bytes, both bundles match their SRI"
done
# The denominator: a green that does not say how many versions it walked cannot
# be told apart from one that walked none.
log "✓ $nversions committed contract version(s) served: $(echo "$versions" | tr '\n' ' ')"

# 3. Negative controls: an unknown major and an uncommitted version must 404,
# or a catch-all is answering for the SDK paths.
for file in v9.js "v$major.99.99.js"; do
  code=$(sdk_get "/client/$file" /dev/null)
  [ "${code%% *}" = '404' ] \
    || { log "✗ /client/$file returned '$code', want 404 — a catch-all answers for the SDK paths"; exit 1; }
  log "✓ /client/$file 404 in boot-smoke"
done

# 4. The integration guide must point at URLs that exist (KH-857 d). Before
# this, /docs/install linked /client/v1.js and /client/v1.0.0.js for weeks
# while both were 404: the guide and the artefact never met. The page is
# rendered by THIS image, and the image is the CDN's origin, so every
# /client/... path in the server-rendered HTML must answer 200 here. The host
# in the page (cdnBase) is stripped: what is measured is the path contract.
# The page must also name the latest AND the pinned URL, so a guide that stops
# rendering them cannot pass by having nothing to check.
code=$(curl -s -o "$SDK_TMP/install.html" -w '%{http_code}' "http://127.0.0.1:$PORT/docs/install")
[ "$code" = '200' ] || { log "✗ /docs/install returned $code in boot-smoke"; exit 1; }
doc_paths=$(grep -oE '/client/v[0-9][0-9A-Za-z.]*' "$SDK_TMP/install.html" | sort -u)
for want in "/client/v$major.js" "/client/v$contract.js" "/client/v$contract.js.sri"; do
  printf '%s\n' "$doc_paths" | grep -qxF "$want" \
    || { log "✗ /docs/install does not show $want (shows: $(echo "$doc_paths" | tr '\n' ' '))"; exit 1; }
done
ndoc=0
for path in $doc_paths; do
  code=$(sdk_get "$path" /dev/null)
  [ "${code%% *}" = '200' ] \
    || { log "✗ /docs/install shows $path, but the image answers '$code'"; exit 1; }
  ndoc=$((ndoc + 1))
done
log "✓ /docs/install: all $ndoc /client/ URL(s) it shows answer 200: $(echo "$doc_paths" | tr '\n' ' ')"
rm -rf "$SDK_TMP"

# Sidste linje på stdout, og den eneste: ID'et på det image containeren
# faktisk kørte. Kalderen sammenligner det med det, den byggede.
docker inspect -f '{{.Image}}' "$APP"
