#!/usr/bin/env bash
# Finder cosigns signatur-artefakt for et image-digest og skriver referencen
# til stdout. Fejler hoejlydt hvis intet findes.
#
# 🔴 Hvorfor et script og ikke to kopier i build.yml: konstruktionen stod
# inline to steder, jeg rettede kun den ene, og main blev roed to gange paa
# samme fejl (#246). To kopier af samme logik i YAML kan ikke holdes i sync
# af kommentarer — kun af en faelles kilde.
#
# Tagget skifter format med cosign-versionen. MAALT paa run 34131844473:
#   cosign 2.x  -> sha256-<digest>.sig
#   cosign 3.0.6 -> sha256-<digest>   (uden suffiks)
# Vi hardkoder derfor ingen af delene, men proever begge.
set -euo pipefail

NAME="${1:?brug: cosign-sig-ref.sh <registry/navn> <sha256:digest>}"
DIGEST="${2:?brug: cosign-sig-ref.sh <registry/navn> <sha256:digest>}"

SIGBASE="${NAME}:$(printf '%s' "$DIGEST" | tr ':' '-')"

for CAND in "$SIGBASE" "$SIGBASE.sig"; do
  if docker buildx imagetools inspect "$CAND" > /dev/null 2>&1; then
    printf '%s\n' "$CAND"
    exit 0
  fi
done

echo "::error::fandt intet signatur-artefakt paa hverken $SIGBASE eller $SIGBASE.sig — cellen kan ikke maale noget, og et tavst spring ville se ud som success" >&2
exit 1
