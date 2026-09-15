#!/usr/bin/env bash
# Runnable guard for assert-tags-after-verify.py (riff ap1qcpe7zg3j8ex5ton6d4i1).
#
# Each mutant below RECREATES the race window in a different way — tags on
# the push, tags before sign, tags that still move after a failed sign, a
# tag that becomes a new unsigned index — and must turn the guard red for
# its OWN reason. A mutant that fails for a different reason proves nothing
# about the rule it names, so every case asserts the expected message.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SUT="$HERE/assert-tags-after-verify.py"
REAL="$HERE/../workflows/build.yml"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# CI may point this at a venv that has PyYAML (see ci.yml).
PY="${PYTHON:-python3}"

fails=0

check() {
  local label="$1" file="$2" want_rc="$3" want_out="$4" out rc
  out="$("$PY" "$SUT" "$file" 2>&1)"; rc=$?
  if [ "$rc" != "$want_rc" ]; then
    echo "✗ $label: exit $rc, expected $want_rc"; echo "    out: $out"; fails=$((fails+1)); return
  fi
  if ! printf '%s' "$out" | grep -qF -- "$want_out"; then
    echo "✗ $label: output lacks '$want_out'"; echo "    out: $out"; fails=$((fails+1)); return
  fi
  echo "✓ $label"
}

# mutate <name> <python snippet operating on `steps`, `job`, `find(pred)`>
mutate() {
  "$PY" - "$REAL" "$TMP/$1.yml" "$2" <<'EOF'
import sys, yaml
src, dst, code = sys.argv[1], sys.argv[2], sys.argv[3]
doc = yaml.safe_load(open(src))
job = doc["jobs"]["build"]; steps = job["steps"]
def find(pred):
    hits = [i for i, s in enumerate(steps) if pred(s)]
    assert len(hits) == 1, f"mutant anchor matched {len(hits)} steps"
    return hits[0]
is_push = lambda s: s.get("id") == "push"
is_sign = lambda s: s.get("id") == "sign"
is_tag = lambda s: s.get("id") == "tags"
exec(code)
yaml.safe_dump(doc, open(dst, "w"), sort_keys=False)
EOF
}

check "real build.yml passes" "$REAL" 0 "✓ tags after sign + verify"

mutate tags_on_push 'steps[find(is_push)]["with"]["tags"] = "${{ steps.meta.outputs.tags }}"'
check "tags back on the push step -> red" "$TMP/tags_on_push.yml" 1 "publishes tags"

mutate push_true 'w = steps[find(is_push)]["with"]; w.pop("outputs"); w["push"] = True'
check "push: true instead of push-by-digest -> red" "$TMP/push_true.yml" 1 "does not push by digest"

mutate tag_before_sign 't = steps.pop(find(is_tag)); steps.insert(find(is_sign), t)'
check "tag step moved before sign -> red" "$TMP/tag_before_sign.yml" 1 "order must be"

mutate tag_always 'steps[find(is_tag)]["if"] = "always()"'
check "tag step runs on failure -> red" "$TMP/tag_always.yml" 1 "runs on failure"

mutate sign_coe 'steps[find(is_sign)]["continue-on-error"] = True'
check "sign step continue-on-error -> red" "$TMP/sign_coe.yml" 1 "has continue-on-error"

mutate job_coe 'job["continue-on-error"] = True'
check "job continue-on-error -> red" "$TMP/job_coe.yml" 1 "job \`build\` has continue-on-error"

mutate no_prefer_index 's = steps[find(is_tag)]; s["run"] = s["run"].replace("--prefer-index=false ", "")'
check "tag without --prefer-index=false -> red" "$TMP/no_prefer_index.yml" 1 "lacks --prefer-index=false"

mutate early_push 'steps.insert(find(is_sign), {"name": "Early tag", "if": "github.event_name != '"'"'pull_request'"'"'", "run": "docker push ghcr.io/x:latest"})'
check "a second publisher before sign -> red" "$TMP/early_push.yml" 1 "publishes to a registry outside the tag step"

mutate no_sign 'steps.pop(find(is_sign))'
check "no sign step (guard armed against nothing) -> red" "$TMP/no_sign.yml" 1 "expected exactly 1 sign step"

mutate tag_on_pr 'steps[find(is_tag)]["if"] = "github.event_name == '"'"'pull_request'"'"'"'
check "tag step on PR events -> red" "$TMP/tag_on_pr.yml" 1 "must run only on non-PR events"

if [ "$fails" -ne 0 ]; then
  echo "$fails test(s) failed"
  exit 1
fi
echo "all tests passed"
