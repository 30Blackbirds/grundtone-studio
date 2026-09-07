#!/usr/bin/env bash
# Udleder den SIGNERENDE identitet af signatur-ARTEFAKTET og skriver den i
# klartekst. Skriver "SAN<TAB>issuer" til stdout.
#
# 🔴 Hvorfor artefaktet og ikke `cosign verify`s payload: cosign 3.0.6's
# verify-payload har "optional":{} — HELT TOM, hvor 2.x bar Subject og
# Issuer. Identiteten HAANDHAEVES fortsat af --certificate-identity-regexp,
# men den kunne ikke laenger AFLAESES af CI-loggen. Sporet flyttede fra
# cosigns annotations-KOPI til den attesterede ORIGINAL ([sikkerhed]).
#
# 🔴 De to bundle-former adskiller sig i MERE end noeglenavnene — ogsaa i
# certifikatets indpakning. MAALT paa tre images:
#   2.x:   .Cert er et OBJEKT med .Raw           (base64-DER)
#   3.0.6: .verificationMaterial.certificate.rawBytes  (base64-DER)
# Min foerste detektor antog at .Cert var en PEM-STRENG. Den klarede begge
# 3.x-images og fejlede paa 2.x-imaget — altsaa netop det format vi
# producerer efter splitten. Derfor daekkes begge former, og en tredje form
# fejler HOEJLYDT frem for at give tom identitet.
#
# 🔴 Brug ALDRIG `cosign triangulate` til formatspoergsmaalet: den BEREGNER
# den konventionelle 2.x-placering og laeser ikke registret, saa den svarer
# ".sig" ogsaa for et image signeret i ny form.
set -euo pipefail

REF="${1:?brug: cosign-identity.sh <image-ref@sha256:...>}"

BUNDLE="$(cosign download signature "$REF" | head -1)"

RAW="$(printf '%s' "$BUNDLE" | jq -r '
  if (.Cert? | type) == "object" and (.Cert.Raw? != null) then .Cert.Raw
  elif .verificationMaterial?.certificate?.rawBytes? != null then .verificationMaterial.certificate.rawBytes
  else empty end')"

if [ -z "$RAW" ]; then
  echo "::error::ukendt bundle-form — hverken .Cert.Raw (2.x) eller .verificationMaterial.certificate.rawBytes (3.x). Noegler: $(printf '%s' "$BUNDLE" | jq -r 'keys | join(",")')" >&2
  exit 1
fi

CERT_TEXT="$(printf '%s' "$RAW" | base64 -d | openssl x509 -inform DER -noout -text)"

# 🔴 `|| true` er ikke slendrian: grep returnerer non-zero naar intet
# matcher, og med `set -e` ville scriptet doe FOER faldet nedenfor naaede
# at fyre — saa en manglende issuer ville give en tavs, uforklaret fejl i
# stedet for "ukendt". Fanget af testen foer det naaede produktion.
SAN="$(printf '%s' "$CERT_TEXT" | tr ',' '\n' | grep -oE 'URI:[^ ]+' | head -1 | sed 's/^URI://' || true)"
ISSUER="$(printf '%s' "$CERT_TEXT" | grep -oE 'https://token\.actions\.githubusercontent\.com[^ ]*' | head -1 || true)"

if [ -z "$SAN" ]; then
  echo "::error::certifikatet bar ingen URI-SAN — identiteten kan ikke udledes" >&2
  exit 1
fi

printf '%s\t%s\n' "$SAN" "${ISSUER:-ukendt}"
