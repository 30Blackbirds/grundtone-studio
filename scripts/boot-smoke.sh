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
#   exit    = 0 only if healthz answers, /login returns 200, and the SDK
#             contract files are served (see the /client block below)
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
# The versioned URL is cached as immutable and pinned by customers with SRI, so
# its bytes may never change without a contract bump. Each versioned bundle must
# hash to the SRI the image serves next to it, AND that SRI must equal the one
# committed for the contract. A drift means the SDK changed under a published
# version.
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CONTRACT_FILE="$ROOT/apps/studio/utils/sdk-contract.ts"
contract=$(sed -n "s/^export const SDK_CONTRACT_VERSION = '\([0-9][0-9.]*\)'$/\1/p" "$CONTRACT_FILE")
[ -n "$contract" ] && [ "$(printf '%s\n' "$contract" | wc -l | tr -d ' ')" = 1 ] \
  || { log "✗ could not read exactly one SDK_CONTRACT_VERSION from $CONTRACT_FILE (got '$contract')"; exit 1; }
major=${contract%%.*}
log "SDK contract v$contract (major v$major)"

sdk_get() { curl -s -o "$2" -w '%{http_code} %{content_type}' "http://127.0.0.1:$PORT$1"; }
SDK_TMP=$(mktemp -d)
for spec in "v$major.js application/javascript" \
            "v$contract.js application/javascript" "v$contract.js.sri text/plain" \
            "v$contract.mjs application/javascript" "v$contract.mjs.sri text/plain"; do
  file=${spec%% *}; want=${spec#* }
  got=$(sdk_get "/client/$file" "$SDK_TMP/$file")
  case "$got" in
    "200 $want"*) log "✓ /client/$file $got in boot-smoke" ;;
    *) log "✗ /client/$file returned '$got', want '200 $want'"; docker logs "$APP" 2>&1 | tail -50 >&2; exit 1 ;;
  esac
done
for ext in js mjs; do
  file="v$contract.$ext"
  sri=$(tr -d '\n' < "$SDK_TMP/$file.sri")
  calc="sha384-$(openssl dgst -sha384 -binary "$SDK_TMP/$file" | openssl base64 -A)"
  [ "$sri" = "$calc" ] \
    || { log "✗ /client/$file hashes to $calc, but /client/$file.sri says '$sri'"; exit 1; }
  committed_file="$ROOT/apps/studio/sdk-contract/$file.sri"
  committed=$(tr -d '\n' < "$committed_file" 2>/dev/null || true)
  [ "$sri" = "$committed" ] \
    || { log "✗ /client/$file serves $sri, but $committed_file commits '$committed' — the SDK bytes changed without bumping SDK_CONTRACT_VERSION"; exit 1; }
  log "✓ /client/$file matches its served and committed SRI"
done
# Negative control: an unknown version must not be served.
code=$(sdk_get /client/v9.js /dev/null)
[ "${code%% *}" = '404' ] \
  || { log "✗ /client/v9.js returned '$code', want 404 — a catch-all answers for the SDK paths"; exit 1; }
log "✓ /client/v9.js 404 in boot-smoke"
rm -rf "$SDK_TMP"

# Sidste linje på stdout, og den eneste: ID'et på det image containeren
# faktisk kørte. Kalderen sammenligner det med det, den byggede.
docker inspect -f '{{.Image}}' "$APP"
