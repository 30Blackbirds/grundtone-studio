#!/usr/bin/env python3
"""Udleder signerings-identiteten af et cosign signatur-ARTEFAKT.

Overtaget fra [sikkerhed]s afproevede opskrift (.orchestration/security/
extract-identity.py.txt, commit cd9129b) frem for at bygge forfra. Deres
version blev til efter at de anvendte vores detektor-fejl paa deres eget
udtraek og fandt TO defekter i det:

  1) FAIL-OPEN: .get()-kaeder gav et tavst nul med exit 0 paa gammel form.
     (Deres ord: vores PEM-fejl var den BEDRE fejl — den var synlig.)
  2) En PLAUSIBEL FORKERT vaerdi: OID-matchet var delstreng, saa
     ...57264.1.1 ogsaa ramte .1.10-.1.19, og den sidste vandt. Issuer kom
     ud som en git-SHA. Et forkert svar der ser rigtigt ud er vaerre end et
     tomt.

Derfor: EKSAKT OID-match, FAIL-CLOSED paa alt uventet, og VAERDI-formede
assertions — "afviser den skrald?" og "laeser den det rigtige felt?" er to
forskellige spoergsmaal, og exit-koden alene svarer kun paa det foerste.
"""
import json, base64, subprocess, sys, re, argparse

OID = {"1.3.6.1.4.1.57264.1.1": "issuer",
       "1.3.6.1.4.1.57264.1.3": "kilde-revision",
       "1.3.6.1.4.1.57264.1.6": "ref"}


def fejl(besked):
    print(f"::error::{besked}", file=sys.stderr)
    sys.exit(2)


def cert_der(d):
    """Returnerer (DER, formnavn). Begge bundle-former; ukendt -> fail-closed."""
    if "verificationMaterial" in d:
        vm = d["verificationMaterial"]
        c = vm.get("certificate") or (vm.get("x509CertificateChain", {}).get("certificates") or [{}])[0]
        if c.get("rawBytes"):
            return base64.b64decode(c["rawBytes"]), "ny (3.x)"
    elif "Cert" in d:
        c = d["Cert"]
        if isinstance(c, dict) and c.get("Raw"):
            return base64.b64decode(c["Raw"]), "gammel (2.x)"
        if isinstance(c, str) and "BEGIN CERT" in c:
            return base64.b64decode("".join(l for l in c.splitlines() if "-----" not in l)), "gammel (2.x, PEM)"
    fejl(f"ukendt bundle-form, noegler={sorted(d.keys())}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("bundle")
    p.add_argument("--expect-identity", help="regexp identiteten SKAL matche")
    a = p.parse_args()

    raw = open(a.bundle).read().strip()
    if not raw:
        fejl("tom bundle")
    der, form = cert_der(json.loads(raw.splitlines()[0]))

    ls = subprocess.run(["openssl", "x509", "-inform", "DER", "-noout", "-text"],
                        input=der, capture_output=True).stdout.decode().splitlines()
    ud = {}
    for i, l in enumerate(ls):
        s = l.strip()
        if "Subject Alternative Name" in s:
            ud["identitet"] = ls[i + 1].strip().removeprefix("URI:")
        # EKSAKT match paa OID-linjen — ikke delstreng. Se docstring.
        if s.endswith(":") and s[:-1] in OID:
            ud[OID[s[:-1]]] = ls[i + 1].strip()

    for k in ("identitet", "issuer", "kilde-revision", "ref"):
        if not ud.get(k):
            fejl(f"felt '{k}' mangler i certifikatet (form={form})")

    # VAERDI-formede assertions: at feltet findes er ikke at det er rigtigt.
    if not ud["issuer"].startswith("https://"):
        fejl(f"issuer ligner ikke en URL: {ud['issuer']!r}")
    if not re.fullmatch(r"[0-9a-f]{40}", ud["kilde-revision"]):
        fejl(f"kilde-revision er ikke 40 hex: {ud['kilde-revision']!r}")
    if not ud["ref"].startswith("refs/"):
        fejl(f"ref ligner ikke en git-ref: {ud['ref']!r}")
    if a.expect_identity and not re.fullmatch(a.expect_identity, ud["identitet"]):
        fejl(f"identiteten matcher ikke det pinnede moenster: {ud['identitet']!r}")

    print(f"  bundle-form:    {form}")
    for k in ("identitet", "issuer", "kilde-revision", "ref"):
        print(f"  {k+':':<15} {ud[k]}")


if __name__ == "__main__":
    main()
