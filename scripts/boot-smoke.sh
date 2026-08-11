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
#   exit    = 0 kun hvis healthz svarer OG /login giver 200
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

# Sidste linje på stdout, og den eneste: ID'et på det image containeren
# faktisk kørte. Kalderen sammenligner det med det, den byggede.
docker inspect -f '{{.Image}}' "$APP"
