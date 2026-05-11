#!/usr/bin/env sh
# Wrapper for `nuxt typecheck` that filters upstream noise.
#
# @grundtone/vue@2.23.3 ships .vue source files alongside dist and has a few
# internal type issues vue-tsc surfaces (tracked separately upstream). We
# filter those lines and exit non-zero only when an error in our own code is
# reported.

set -u

OUTPUT=$(nuxt typecheck 2>&1) || TYPECHECK_EXIT=$?
TYPECHECK_EXIT=${TYPECHECK_EXIT:-0}

# Drop @grundtone/vue source lines from the report
FILTERED=$(printf '%s\n' "$OUTPUT" | grep -v 'node_modules/.pnpm/@grundtone+vue' || true)

# Count remaining `error TS` lines (those that survived the filter)
OWN_ERRORS=$(printf '%s\n' "$FILTERED" | grep -cE 'error TS[0-9]+' || true)

printf '%s\n' "$FILTERED"

if [ "$OWN_ERRORS" -gt 0 ]; then
  echo ""
  echo "✖ $OWN_ERRORS typecheck error(s) in our code."
  exit 1
fi

echo "✓ typecheck passed (upstream @grundtone/vue noise filtered)"
