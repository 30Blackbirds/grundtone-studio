# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub's private vulnerability reporting:
[open a private report](https://github.com/30Blackbirds/grundtone-studio/security/advisories/new).

Please include, as far as you can:

- which part of Studio is affected (for example the API, the CDN routes or the Docker image) and the
  version or commit,
- what an attacker can do with it: the impact, not only the mechanism,
- the smallest reproduction you have.

## What you can expect

- An acknowledgement within **5 working days**.
- An assessment (whether we can reproduce it and what we think the impact is) within **10 working
  days**.
- A fix on `main`, released as a new image tag, and a GitHub Security Advisory when the issue
  affects released versions.

We are a small team. If you have not heard from us within the times above, please send a reminder
rather than assuming the report was received.

## Supported versions

Security fixes go to the **latest release** and to `main`. Older releases are not patched; upgrading
is the route to a fix.

## Scope

In scope: the code in this repository and its build and release tooling.

Out of scope: third-party services you connect Studio to (your authentication service, permissions
service, SMTP provider, object storage), and your own deployment configuration.

## Hardening notes for self-hosters

- Never set `STUDIO_DEV_AUTH_BYPASS`. It is a local development shortcut, and a production build
  refuses to start when it is present.
- Keep `.env.production` out of version control and readable only by the deploy user.
