#!/usr/bin/env bash
# Koerbart vaern for cosign-sig-ref.sh.
#
# 🔴 Hvorfor det ligger i repoet og ikke i en commit-besked: de her tre
# tilstande var testet én gang, lokalt, mod stubs jeg ikke committede. En
# engangsmaaling er en PAASTAND — [review] kunne ikke genskabe den, og
# ingen ville opdage hvis scriptet holdt op med at virke. En CI-koert test
# er et BEVIS. ([projektleder]s prioritering, 2026-09-07.)
#
# Tilstandene er ikke opfundne: cosign 2.x lagde signaturen paa
# sha256-<digest>.sig, 3.0.6 paa sha256-<digest> uden suffiks (maalt paa
# run 34131844473), og en hardkodet antagelse om det ene format gjorde main
# roed to gange. Den tredje tilstand — ingen af delene — er den der ikke
# maa bestaa tavst.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SUT="$HERE/cosign-sig-ref.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"

fails=0

# Stub-docker: kun ÉT tag "findes", angivet som $1. Matcher paa at
# argumentlisten SLUTTER paa referencen — ellers ville sha256-abc ogsaa
# matche sha256-abc.sig, og testen ville ikke skelne de to formater.
stub_docker() {
  cat > "$TMP/bin/docker" <<EOF
#!/bin/sh
case "\$*" in
  *"$1") exit 0 ;;
esac
exit 1
EOF
  chmod +x "$TMP/bin/docker"
}

check() {
  local navn="$1" findes="$2" forventet_exit="$3" forventet_ud="$4"
  stub_docker "$findes"
  local ud rc
  ud="$(PATH="$TMP/bin:$PATH" "$SUT" ghcr.io/kh/studio sha256:abc 2>&1)"; rc=$?
  if [ "$rc" != "$forventet_exit" ]; then
    echo "✗ $navn: exit $rc, forventede $forventet_exit"; echo "    ud: $ud"; fails=$((fails+1)); return
  fi
  if ! printf '%s' "$ud" | grep -qF "$forventet_ud"; then
    echo "✗ $navn: output indeholdt ikke '$forventet_ud'"; echo "    ud: $ud"; fails=$((fails+1)); return
  fi
  echo "✓ $navn"
}

check "3.x-format (uden .sig) findes" \
      "sha256-abc"     0 "ghcr.io/kh/studio:sha256-abc"
check "2.x-format (.sig) findes" \
      "sha256-abc.sig" 0 "ghcr.io/kh/studio:sha256-abc.sig"
check "intet artefakt findes -> maa IKKE bestaa tavst" \
      "FINDES-IKKE"    1 "::error::"

# Argument-validering: uden argumenter skal scriptet fejle, ikke gaette.
if PATH="$TMP/bin:$PATH" "$SUT" >/dev/null 2>&1; then
  echo "✗ uden argumenter: exit 0, forventede fejl"; fails=$((fails+1))
else
  echo "✓ uden argumenter fejler"
fi

if [ "$fails" -ne 0 ]; then
  echo "$fails test(s) fejlede"
  exit 1
fi
echo "alle tests bestod"
