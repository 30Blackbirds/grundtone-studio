#!/usr/bin/env python3
"""Structural guard: no mutable image tag is published before the digest is
signed and verified (riff ap1qcpe7zg3j8ex5ton6d4i1, [sikkerhed]'s cure A).

Reads the `build` job of build.yml as YAML — not as text — because the rule is
about step ORDER and step CONDITIONS, and a text search cannot tell a comment
that explains the rule from a step that breaks it.

Usage: assert-tags-after-verify.py [path/to/build.yml]
"""
import re
import sys

import yaml

PR_ONLY = re.compile(r"github\.event_name\s*==\s*'pull_request'")
NON_PR = re.compile(r"github\.event_name\s*!=\s*'pull_request'")
RUNS_ON_FAILURE = re.compile(r"\b(always|failure|cancelled)\(\)")
PUBLISHES = re.compile(r"docker\s+push|imagetools\s+create|crane\s+(tag|copy|cp)|oras\s+(tag|push|copy)|skopeo\s+copy")


def main(path):
    with open(path) as f:
        doc = yaml.safe_load(f)
    job = doc["jobs"]["build"]
    steps = job["steps"]
    errors = []

    def name(i):
        s = steps[i]
        return s.get("name") or s.get("uses") or f"step {i}"

    cond = lambda s: str(s.get("if", ""))
    run = lambda s: s.get("run") or ""
    uses = lambda s: s.get("uses") or ""

    pushers = [i for i, s in enumerate(steps)
               if uses(s).startswith("docker/build-push-action") and not PR_ONLY.search(cond(s))]
    signs = [i for i, s in enumerate(steps) if s.get("id") == "sign"]
    verifies = [i for i, s in enumerate(steps) if str(s.get("name", "")).startswith("Verify the signature")]
    taggers = [i for i, s in enumerate(steps) if re.search(r"imagetools\s+create", run(s))]

    # Denominators first: a guard that finds nothing to check must not pass.
    for label, found in (("non-PR build-push-action step", pushers), ("sign step (id: sign)", signs),
                         ("verify step (name: Verify the signature…)", verifies),
                         ("step running `imagetools create`", taggers)):
        if len(found) != 1:
            errors.append(f"expected exactly 1 {label}, found {len(found)}")

    if job.get("continue-on-error"):
        errors.append("job `build` has continue-on-error — a failed sign would still let tags move")

    for i in pushers:
        w = steps[i].get("with") or {}
        if w.get("tags"):
            errors.append(f"'{name(i)}' publishes tags — push by digest only; tags belong after verify")
        if str(w.get("push", "")).lower() == "true":
            errors.append(f"'{name(i)}' uses push: true — push by digest via `outputs` instead")
        if "push-by-digest=true" not in str(w.get("outputs", "")):
            errors.append(f"'{name(i)}' does not push by digest (outputs lacks push-by-digest=true)")

    if len(pushers) == len(signs) == len(verifies) == len(taggers) == 1:
        p, s, v, t = pushers[0], signs[0], verifies[0], taggers[0]
        if not (p < s < v < t):
            errors.append(f"order must be push({p}) < sign({s}) < verify({v}) < tag({t})")

    for i in signs + verifies + taggers:
        st = steps[i]
        if RUNS_ON_FAILURE.search(cond(st)):
            errors.append(f"'{name(i)}' runs on failure/cancel ({cond(st)}) — a failed step before it would still move tags")
        if st.get("continue-on-error"):
            errors.append(f"'{name(i)}' has continue-on-error — its failure would not stop the tags")

    for i in taggers:
        st = steps[i]
        if PR_ONLY.search(cond(st)) or not NON_PR.search(cond(st)):
            errors.append(f"'{name(i)}' must run only on non-PR events, has if: {cond(st)!r}")
        if "--prefer-index=false" not in run(st):
            errors.append(f"'{name(i)}' lacks --prefer-index=false — the tag would point at a new, unsigned index")

    for i, s in enumerate(steps):
        if i not in taggers and PUBLISHES.search(run(s)):
            errors.append(f"'{name(i)}' publishes to a registry outside the tag step")

    if errors:
        for e in errors:
            print(f"::error::{e}")
        return 1
    print(f"✓ tags after sign + verify in {path}: push({p}) < sign({s}) < verify({v}) < tag({t})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else ".github/workflows/build.yml"))
