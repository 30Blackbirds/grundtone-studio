#!/usr/bin/env bash
# Henter signatur-artefaktet og udleder signerings-identiteten af CERTIFIKATET.
#
# Udtraekket ligger i cosign-identity.py — overtaget fra [sikkerhed]s
# afproevede opskrift frem for bygget forfra. Se dens docstring for hvorfor
# den er fail-closed, hvorfor OID-matchet er EKSAKT, og hvorfor der er
# vaerdi-formede assertions og ikke kun exit-koder.
#
# brug: cosign-identity.sh <image-ref@sha256:...> [pinnet-identitets-regexp]
set -euo pipefail

REF="${1:?brug: cosign-identity.sh <image-ref@sha256:...> [pinnet-regexp]}"
PINNED_RE="${2:-}"

HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT

cosign download signature "$REF" | head -1 > "$TMP"

if [ -n "$PINNED_RE" ]; then
  python3 "$HERE/cosign-identity.py" "$TMP" --expect-identity "$PINNED_RE"
else
  python3 "$HERE/cosign-identity.py" "$TMP"
fi
