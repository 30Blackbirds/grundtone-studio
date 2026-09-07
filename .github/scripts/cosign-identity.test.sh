#!/usr/bin/env bash
# Koerbart vaern for cosign-identity.sh.
#
# Daekker BEGGE bundle-former, fordi en detektor der kun er proevet paa den
# ene ser korrekt ud og fejler paa den anden: min foerste udgave klarede
# 3.x og fejlede paa 2.x — altsaa netop det format vi producerer efter
# splitten (#247).
#
# Certifikatet genereres paa stedet med en kendt URI-SAN, saa der ikke
# committes binaere blobs og saa testen maaler UDTRAEKKET frem for en
# hardkodet forventning.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SUT="$HERE/cosign-identity.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"

SAN_URI="https://github.com/KlangHaus/grundtone-studio/.github/workflows/build.yml@refs/heads/main"
fails=0

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -keyout "$TMP/k.pem" -out "$TMP/c.pem" -days 1 -subj "/CN=test" \
  -addext "subjectAltName=URI:$SAN_URI" >/dev/null 2>&1
DER_B64="$(openssl x509 -in "$TMP/c.pem" -outform DER | base64 | tr -d '\n')"

stub_cosign() { # $1 = bundle-JSON
  cat > "$TMP/bin/cosign" <<EOF
#!/bin/sh
cat <<'JSON'
$1
JSON
EOF
  chmod +x "$TMP/bin/cosign"
}

check() {
  local navn="$1" bundle="$2" forventet_exit="$3" forventet="$4"
  stub_cosign "$bundle"
  local ud rc
  ud="$(PATH="$TMP/bin:$PATH" "$SUT" ghcr.io/kh/s@sha256:abc 2>&1)"; rc=$?
  if [ "$rc" != "$forventet_exit" ]; then
    echo "✗ $navn: exit $rc, forventede $forventet_exit"; echo "    ud: $ud"; fails=$((fails+1)); return
  fi
  if ! printf '%s' "$ud" | grep -qF "$forventet"; then
    echo "✗ $navn: output bar ikke '$forventet'"; echo "    ud: $ud"; fails=$((fails+1)); return
  fi
  echo "✓ $navn"
}

# GAMMEL form (cosign 2.x): .Cert er et OBJEKT med .Raw
check "2.x-bundle (.Cert.Raw)" \
      "{\"Base64Signature\":\"x\",\"Cert\":{\"Raw\":\"$DER_B64\"},\"Chain\":[],\"Payload\":\"e30=\"}" \
      0 "$SAN_URI"

# NY form (cosign 3.x): .verificationMaterial.certificate.rawBytes
check "3.x-bundle (verificationMaterial)" \
      "{\"mediaType\":\"x\",\"dsseEnvelope\":{},\"verificationMaterial\":{\"certificate\":{\"rawBytes\":\"$DER_B64\"}}}" \
      0 "$SAN_URI"

# En tredje form maa fejle HOEJLYDT, ikke give tom identitet.
check "ukendt bundle-form -> maa IKKE bestaa tavst" \
      '{"noget":"helt andet"}' \
      1 "::error::"

if [ "$fails" -ne 0 ]; then echo "$fails test(s) fejlede"; exit 1; fi
echo "alle tests bestod"
