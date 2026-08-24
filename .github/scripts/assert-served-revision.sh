#!/usr/bin/env bash
# Dommeren til healthz.revision.
#
# 🔴 HVORFOR DEN FINDES: healthz RAPPORTEREDE kun. Deploy-smoken kørte
# `curl -sf "$BASE/api/healthz" > /dev/null` — den smed svaret væk og
# verificerede kun, at endpointet SVAREDE. Et image, der regredierede til
# `revision:"unknown"`, ville have bestået. Handlerens egen kommentar sagde det:
# **"Feltet er det ene ben; dommeren mangler."**
#
# 🔴 HVAD DEN BEVISER, OG HVAD DEN IKKE GØR. Den beviser, at containeren, der
# SVARER på den offentlige vhost, er den, dette run byggede — altså at deployet
# faktisk rullede, og at et gammelt image ikke stadig kører bag en Caddy, der
# meldte succes.
#
# Den beviser IKKE, at stemplingen ved build var korrekt: build-arg'en,
# OCI-labelen og dette sammenligningsgrundlag stammer alle fra `github.sha`.
# **Stemples den forkert ved build, er alle tre enige om samme løgn.** Det ben
# kræver en uafhængig kilde (tag → commit via GitHub-API'et) og er ikke bygget
# her. Skrevet ned, så gaten ikke læses som mere end den er.
#
# Usage: assert-served-revision.sh <base-url> <expected-sha>
set -euo pipefail

BASE="${1:?base-url mangler}"
EXPECTED="${2:?expected-sha mangler}"

BODY=$(curl -sf --max-time 20 "$BASE/api/healthz")
REVISION=$(printf '%s' "$BODY" | jq -r '.revision // empty')

# Formen FØRST: den afviser 'dev', 'unknown' og tom uden at skulle kende den
# forventede sha. En tom værdi maa ikke kunne sammenlignes lig med noget.
if ! printf '%s' "$REVISION" | grep -qE '^[0-9a-f]{40}$'; then
  echo "::error::healthz.revision er '${REVISION:-<tom>}' — ikke en 40-tegns sha."
  echo "  Placeholdere ('dev', 'unknown') betyder, at REVISION-build-arg'en ikke naaede imaget."
  echo "  Svar: $BODY"
  exit 1
fi

if [ "$REVISION" != "$EXPECTED" ]; then
  echo "::error::Den SERVEREDE revision er ikke dette runs build."
  echo "  serveret:  $REVISION"
  echo "  forventet: $EXPECTED"
  echo "  Et gammelt image svarer stadig — deployet meldte succes uden at rulle."
  exit 1
fi

echo "✓ $BASE serverer revision $REVISION (= dette runs build)"
