# CDN URLs carry the plaintext API key — by design

Customer integrations fetch their published tokens from a URL that contains the raw API key in the
path:

```
https://cdn.grundtone.io/k/pk_live_abc123xyz.../tokens.css
```

This is **deliberate**, not an oversight. Reviewers who reach the `/k/[key]` handler in
`apps/studio/server/routes/k/[key]/[file].get.ts` see a plaintext key in a URL and reasonably ask
whether it should be hashed or signed instead. This page explains the model so we don't keep
relitigating it.

## What kind of key this is

Grundtone keys come in two halves:

- **Publishable keys** (`pk_live_...` / `pk_test_...`) — shipped to the customer's browser. They
  identify the project and gate which CDN URLs are servable. They do not authorize any mutation.
  **This is what appears in the CDN URL.**
- **(Future) secret keys** (`sk_...`) — never shipped to browsers, used for server-to-server calls.
  Not in scope today; reserved for when we expose write APIs.

The CDN URL only ever carries the publishable half. Anyone with the URL can fetch the tokens — which
is exactly what we want, because those tokens are already in every visitor's browser milliseconds
later.

## Why this is safe

Three properties make plaintext-in-URL fine for publishable keys:

1. **The tokens behind the URL are public**: published design tokens are served to anyone who loads
   the customer's site. There is no confidentiality boundary around them. Hashing the URL would
   protect nothing the browser doesn't already expose.

2. **The key is scoped to a project + origins + rate limit**: an attacker who lifts a key from a
   `<script>` tag can fetch the same tokens an honest visitor can. They cannot create projects,
   change settings, read other projects, or mutate anything. If they exceed the per-key rate limit
   (default 1000 req/min, configurable per key), the CDN handler returns 429.

3. **The hash-at-rest invariant still holds**: the `api_key` table stores `SHA-256(plaintext_key)`,
   not the plaintext. The `/k/[key]` handler hashes the URL parameter and looks the row up by that
   hash. A database leak does not yield a list of usable keys; an attacker would need to bruteforce
   the preimage, which is computationally infeasible.

## The reference model — Stripe

This is the same model Stripe ships with `pk_live_...` publishable keys: the key appears in
JavaScript embedded on every customer site, and the guarantee is "this key can call public endpoints
in your account, and that's it." Reading it does not let you charge cards, refund payments, or read
PII.

Grundtone's CDN URLs do less than Stripe's publishable endpoints (just GET cached tokens) so the
surface is even smaller.

## Threats this doesn't protect against

Honest enumeration so reviewers aren't surprised later:

- **Key theft from a customer's site**: anyone scraping the customer's HTML sees the key.
  Mitigation: per-key rate limit, allowed-origins allowlist (see `api_key.allowedOrigins`),
  revocation flow in Studio.
- **High-volume hotlinking**: an attacker uses a customer's key on their own site to serve tokens
  from our bandwidth. Mitigation: allowed-origins enforces an `Origin` header check on the CDN
  handler when the header is present (browsers always send it on cross-origin requests). Server-
  to-server callers that omit the header bypass the check by design — they're outside the threat
  model.
- **Key reuse across customer environments**: a leaked test key works on the customer's test
  project. Mitigation: separate `pk_test_` / `pk_live_` keys, customer is responsible for not
  committing `pk_live_` to a public repo.

## When NOT to use this model

If we ever expose a write endpoint (e.g. "let a customer programmatically update tokens") we need
secret keys (`sk_...`), never in URLs, never embedded in browsers. The publishable-in-URL model is
for read-only, public-data endpoints — full stop.

## Related code

- `apps/studio/server/routes/k/[key]/[file].get.ts` — the handler
- `apps/studio/server/lib/api-keys.ts` — generation + hashing
- `apps/studio/components/ApiKeyManager.vue` — UI + shown-once warning
- `CHANGELOG.md` — entry for the API-key management feature
