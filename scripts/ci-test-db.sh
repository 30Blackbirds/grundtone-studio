#!/usr/bin/env bash
#
# The per-build test database for Jenkins' `Test` check (see the Jenkinsfile).
#
#   scripts/ci-test-db.sh create <file>  -> creates the database and writes its
#                                           DATABASE_URL to <file> (mode 0600)
#   scripts/ci-test-db.sh drop           -> drops it again (idempotent)
#
# 🔴 The DSN carries ci_build's password and must never reach the log.
# - It travels in a FILE, never on stdout. Capturing `$(pnpm … create)` took
#   ALL of pnpm's stdout: one extra line ("WARN Unsupported engine") became part
#   of DATABASE_URL, migrate threw "Invalid URL" and printed the input, password
#   included ([sikkerhed], #347).
# - Everything the pnpm call prints goes to stderr, so a stray line stays
#   visible but can never be mistaken for the DSN.
# - The file's content is checked for the shape of a postgres URL to a studio_
#   database. On a mismatch this script says so and prints its LENGTH, never
#   the content.
#
# Contract: stdout = nothing; stderr = diagnostics; exit 0 only if <file> holds
# exactly one postgres URL to a studio_ database.
set -euo pipefail

ci_db() {
  pnpm --silent --filter @grundtone-studio/studio exec tsx server/db/ci-db.ts "$@" >&2
}

case "${1:-}" in
  create)
    out="${2:?usage: scripts/ci-test-db.sh create <file>}"
    umask 077
    ci_db create --out "$out"
    dsn="$(cat "$out")"
    # One line, postgres scheme, no whitespace, and the path is a studio_ name.
    if [[ "$dsn" != *$'\n'* && "$dsn" =~ ^postgres(ql)?://[^[:space:]]+/studio_[a-z0-9_]+$ ]]; then
      echo "ci-test-db: DATABASE_URL written to $out (${#dsn} bytes, not shown)" >&2
    else
      echo "ci-test-db: $out does not hold a postgres URL to a studio_ database" >&2
      echo "ci-test-db: ${#dsn} bytes, content not shown because it may hold a password" >&2
      exit 1
    fi
    ;;
  drop)
    ci_db drop
    ;;
  *)
    echo 'usage: scripts/ci-test-db.sh create <file> | drop' >&2
    exit 2
    ;;
esac
