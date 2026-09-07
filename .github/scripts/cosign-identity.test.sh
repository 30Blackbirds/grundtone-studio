#!/usr/bin/env bash
# Koerbart vaern for cosign-identity.py.
#
# To spoergsmaal, ikke ét: LAESER den det rigtige felt, og AFVISER den
# skrald? En exit-kode svarer kun paa det foerste. ([sikkerhed], efter at de
# fandt to defekter i deres eget udtraek: fail-open med tavst nul, og en
# PLAUSIBEL FORKERT vaerdi hvor issuer kom ud som en git-SHA.)
#
# 🔴 HVAD DENNE FIL IKKE DAEKKER: Fulcio-KODNINGEN. Fixturerne er syntetiske
# og koder OID-vaerdier som raa DER, fordi det er saadan Fulcio gjorde det da
# vi maalte. Aendrer Fulcio kodningen, bliver disse celler ved med at bestaa
# paa en fiktion. Det hul er IKKE aabent i systemet: Verify-cellen koerer
# cosign-identity.sh mod det AEGTE artefakt hver main-koersel, fail-closed
# gennem set -euo pipefail -> sys.exit(2), saa en kodningsaendring fejler
# haardt dér. ([sikkerheds] votum c695426 — bekymringen var sand om testen
# og falsk om systemet.) Risikoen her er LAESNING, ikke detektion.
#
# Certifikaterne genereres paa stedet. OID-vaerdierne kodes som RAA DER uden
# tag/laengde, fordi det er saadan Fulcio koder dem — en ASN1:UTF8String
# ville give to praefiks-bytes som openssl renderer som prikker, og saa
# maalte testen en anden kodning end produktionen.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SUT="$HERE/cosign-identity.py"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
IDENT="https://github.com/KlangHaus/grundtone-studio/.github/workflows/build.yml@refs/heads/main"
PINNED='^https://github\.com/KlangHaus/grundtone-studio/\.github/workflows/build\.yml@refs/(heads/main|tags/v[0-9]+\.[0-9]+\.[0-9]+)$'
REV=c755c16a2d68250a62a087718bf09c4ac4ac98b3
fails=0

hexof() { printf '%s' "$1" | xxd -p | tr -d '\n' | sed 's/\(..\)/\1:/g;s/:$//'; }

# $1=issuer $2=revision $3=ref $4..=ekstra -addext argumenter
mkcert() {
  local iss="$1" rev="$2" ref="$3"; shift 3
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
    -keyout "$TMP/k.pem" -out "$TMP/c.pem" -days 1 -subj "/CN=t" \
    -addext "subjectAltName=URI:$IDENT" \
    -addext "1.3.6.1.4.1.57264.1.1=DER:$(hexof "$iss")" \
    -addext "1.3.6.1.4.1.57264.1.3=DER:$(hexof "$rev")" \
    -addext "1.3.6.1.4.1.57264.1.6=DER:$(hexof "$ref")" \
    "$@" >/dev/null 2>&1
  openssl x509 -in "$TMP/c.pem" -outform DER | base64 | tr -d '\n'
}

run() { # $1=navn $2=bundle-json $3=forventet_exit $4=forventet_tekst
  printf '%s' "$2" > "$TMP/b.json"
  local ud rc
  ud="$(python3 "$SUT" "$TMP/b.json" --expect-identity "$PINNED" 2>&1)"; rc=$?
  if [ "$rc" != "$3" ]; then echo "✗ $1: exit $rc, forventede $3"; echo "    $ud"; fails=$((fails+1)); return; fi
  if ! printf '%s' "$ud" | grep -qF "$4"; then echo "✗ $1: bar ikke '$4'"; echo "    $ud"; fails=$((fails+1)); return; fi
  echo "✓ $1"
}

OK=$(mkcert "https://token.actions.githubusercontent.com" "$REV" "refs/heads/main")

# ── LAESER den det rigtige felt? ────────────────────────────────────────
run "2.x-bundle (.Cert.Raw)"          "{\"Base64Signature\":\"x\",\"Cert\":{\"Raw\":\"$OK\"}}"                        0 "$REV"
run "3.x-bundle (verificationMaterial)" "{\"dsseEnvelope\":{},\"verificationMaterial\":{\"certificate\":{\"rawBytes\":\"$OK\"}}}" 0 "$REV"

# 🔴 REGRESSIONSTEST for delstrengs-defekten: certifikatet baerer OID 1.10-1.19
# ved siden af 1.1, og "…57264.1.1" er en DELSTRENG af dem alle. Et
# delstrengs-match ville lade den SIDSTE vinde og give en git-SHA som issuer.
DECOY=$(mkcert "https://token.actions.githubusercontent.com" "$REV" "refs/heads/main" \
  -addext "1.3.6.1.4.1.57264.1.10=DER:$(hexof 'FORKERT-1-10')" \
  -addext "1.3.6.1.4.1.57264.1.19=DER:$(hexof 'FORKERT-1-19')")
run "OID 1.10-1.19 som lokkemad -> 1.1 vinder" "{\"Cert\":{\"Raw\":\"$DECOY\"}}" 0 "issuer:         https://token.actions"

# ── AFVISER den skrald? ─────────────────────────────────────────────────
BAD_ISS=$(mkcert "ikke-en-url" "$REV" "refs/heads/main")
run "issuer er ikke en URL"    "{\"Cert\":{\"Raw\":\"$BAD_ISS\"}}" 2 "ligner ikke en URL"
BAD_REV=$(mkcert "https://token.actions.githubusercontent.com" "deadbeef" "refs/heads/main")
run "revision er ikke 40 hex"  "{\"Cert\":{\"Raw\":\"$BAD_REV\"}}" 2 "ikke 40 hex"
BAD_REF=$(mkcert "https://token.actions.githubusercontent.com" "$REV" "hovedgren")
run "ref er ikke en git-ref"   "{\"Cert\":{\"Raw\":\"$BAD_REF\"}}" 2 "ligner ikke en git-ref"
run "ukendt bundle-form"       '{"noget":"andet"}'                 2 "ukendt bundle-form"

# 🔴 MANGLENDE felter. [review]s fund: de oevrige fejl-testcases kortslutter
# i TIDLIGERE grene og naar aldrig frem til udtraekket, saa en regression
# dér ville ikke blive fanget. Certifikatet skal derfor vaere velformet paa
# alt ANDET end det felt vi fjerner.
NO_SAN=$(openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -keyout "$TMP/k.pem" -out "$TMP/c.pem" -days 1 -subj "/CN=t" \
  -addext "1.3.6.1.4.1.57264.1.1=DER:$(hexof 'https://token.actions.githubusercontent.com')" \
  -addext "1.3.6.1.4.1.57264.1.3=DER:$(hexof "$REV")" \
  -addext "1.3.6.1.4.1.57264.1.6=DER:$(hexof 'refs/heads/main')" >/dev/null 2>&1; \
  openssl x509 -in "$TMP/c.pem" -outform DER | base64 | tr -d '\n')
run "cert UDEN URI-SAN"        "{\"Cert\":{\"Raw\":\"$NO_SAN\"}}"        2 "felt 'identitet' mangler"

NO_ISS=$(openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -keyout "$TMP/k.pem" -out "$TMP/c.pem" -days 1 -subj "/CN=t" \
  -addext "subjectAltName=URI:$IDENT" \
  -addext "1.3.6.1.4.1.57264.1.3=DER:$(hexof "$REV")" \
  -addext "1.3.6.1.4.1.57264.1.6=DER:$(hexof 'refs/heads/main')" >/dev/null 2>&1; \
  openssl x509 -in "$TMP/c.pem" -outform DER | base64 | tr -d '\n')
run "cert UDEN issuer-OID"     "{\"Cert\":{\"Raw\":\"$NO_ISS\"}}"        2 "felt 'issuer' mangler"

# 🔴 x509CertificateChain-grenen (v0.3+). ANTAGELSEN er at certificates[0]
# er LEAF'en; kun FEJL-retningen er maalt. Et intermediate baerer hverken
# URI-SAN eller Fulcio-OID'er, saa staar det paa plads [0], SKAL vi fejle
# lukket frem for at rapportere en tom identitet. ([sikkerhed]s fund i den
# opskrift de selv gav os.)
BARE=$(openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -keyout "$TMP/k.pem" -out "$TMP/c.pem" -days 1 -subj "/CN=sigstore-intermediate" >/dev/null 2>&1; \
  openssl x509 -in "$TMP/c.pem" -outform DER | base64 | tr -d '\n')
run "kaede-gren: parser-logikken laeser certificates[0]" \
    "{\"verificationMaterial\":{\"x509CertificateChain\":{\"certificates\":[{\"rawBytes\":\"$OK\"}]}}}" \
    0 "$REV"
run "kaede-gren: fejl-retning ved intermediate paa [0]" \
    "{\"verificationMaterial\":{\"x509CertificateChain\":{\"certificates\":[{\"rawBytes\":\"$BARE\"}]}}}" \
    2 "felt 'identitet' mangler"

# 🔴 FLERE SIGNATURER paa ét digest (gensigneret image). `cosign verify`
# bestaar hvis BARE ÉN matcher, saa laeste vi kun den foerste, kunne vi
# rapportere en ANDEN identitet end den gaten accepterede. Vi kraever derfor
# at hver enkelt holder. Latent i dag — begge vores images har 1 linje.
FREMMED=$(IDENT="https://github.com/KlangHaus/grundtone-studio/.github/workflows/release.yml@refs/heads/main" \
  mkcert "https://token.actions.githubusercontent.com" "$REV" "refs/heads/main")
run "to signaturer, begge gyldige" \
    "$(printf '{"Cert":{"Raw":"%s"}}\n{"Cert":{"Raw":"%s"}}' "$OK" "$OK")" \
    0 "2 signaturer paa dette digest"
run "to signaturer, nr. 2 er FREMMED -> afvises" \
    "$(printf '{"Cert":{"Raw":"%s"}}\n{"Cert":{"Raw":"%s"}}' "$OK" "$FREMMED")" \
    2 "signatur 2: identiteten matcher ikke"
run "tom bundle"               ''                                  2 "tom bundle"

# identitet der ikke matcher det pinnede moenster
BAD_ID=$(IDENT="https://github.com/KlangHaus/grundtone-studio/.github/workflows/release.yml@refs/heads/main" \
  mkcert "https://token.actions.githubusercontent.com" "$REV" "refs/heads/main")
printf '{"Cert":{"Raw":"%s"}}' "$BAD_ID" > "$TMP/b.json"
if python3 "$SUT" "$TMP/b.json" --expect-identity "$PINNED" >/dev/null 2>&1; then
  echo "✗ forkert identitet blev accepteret"; fails=$((fails+1))
else echo "✓ identitet uden for det pinnede moenster afvist"; fi

if [ "$fails" -ne 0 ]; then echo "$fails test(s) fejlede"; exit 1; fi
echo "alle tests bestod"
