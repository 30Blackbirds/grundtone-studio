# Postmark server setup — one-time provisioning

Postmark is our transactional email processor (magic links, org/project invitations, email
verification). This runbook walks through the one-time provisioning so a fresh environment can send
mail end-to-end.

Prerequisite: DNS records from `dns-setup.md` ready to apply, or already applied to `grundtone.com`.
Postmark's sender signature can't go live until DKIM resolves.

## 1. Create the Postmark account

- Sign up at https://postmarkapp.com — pick the EU region during account creation. KlangHaus is
  EU-based and sub-processors live there per our DPA; the choice is irreversible after account
  creation.
- Verify the billing email and add the company contact.
- Switch the account to **Production** mode once domain verification passes (step 4). Sandbox mode
  is locked to verified-recipient-only.

## 2. Create the server

A "Server" in Postmark is a logical bucket per environment. Recommended layout:

| Environment | Server name       | Purpose                                    |
| ----------- | ----------------- | ------------------------------------------ |
| Production  | `grundtone-prod`  | Real customer mail                         |
| Staging     | `grundtone-stage` | Pre-prod smoke tests                       |
| Local dev   | (no server)       | nodemailer logs to console; see `email.ts` |

For each server, **generate a Server API Token** (Settings → API Tokens). This is the value bound to
`POSTMARK_SERVER_TOKEN` in our environment.

## 3. Configure the sender signature

Sender Signatures → Add Domain → `grundtone.com`.

Postmark generates two pieces of DNS:

- A DKIM key (selector + TXT record) — apply per `dns-setup.md` step 2
- A Return-Path CNAME — apply per `dns-setup.md` step 3

Wait for both to show **Verified** in the Postmark dashboard. Without verification, Postmark rejects
sends with a 422.

Set the **default From address** for the domain — e.g. `Grundtone Studio <no-reply@grundtone.com>`.
This is what `EMAIL_FROM` needs to match in our env.

## 4. Configure the bounce/complaint webhook

Server Settings → Webhooks → Add Webhook.

- **URL**: `https://studio.grundtone.com/api/email/webhook`
- **Auth**: Basic Auth with the values from `POSTMARK_WEBHOOK_USER` and `POSTMARK_WEBHOOK_PASS` in
  the production env. (See the webhook handler comments for why Basic Auth over HMAC — it's what
  Postmark natively supports for the receiver-side challenge.)
- **Events**: Delivery, Bounce, Spam Complaint, Open (optional), Click (optional). Subscription
  Change is auto-on.

The webhook records into the `email_event` table — see the handler in
`server/api/email/webhook.post.ts`.

## 5. Environment variables

Add to the production `.env` (or whatever secret store the deploy uses):

```
EMAIL_FROM=Grundtone Studio <no-reply@grundtone.com>
SMTP_HOST=smtp.postmarkapp.com
SMTP_PORT=587
SMTP_USER=<server token from step 2>
SMTP_PASSWORD=<server token from step 2 — Postmark uses the token as both user and pass>
SMTP_SECURE=false
POSTMARK_WEBHOOK_USER=<your choice; record in 1Password>
POSTMARK_WEBHOOK_PASS=<your choice; record in 1Password>
```

Notes:

- Postmark accepts the Server Token as both the SMTP user and the SMTP password — that's their auth
  model, not an oversight. Our current `email.ts` uses nodemailer's SMTP transport so this is the
  path of least change. If we move to the HTTP API later, swap to `POSTMARK_SERVER_TOKEN` + their
  REST endpoint.
- `SMTP_SECURE=false` because Postmark uses STARTTLS on port 587. Set `true` only if switching to
  port 465 (SMTPS).

## 6. Token rotation

Rotate Server Tokens at least every 12 months, or immediately if a token is suspected leaked (logs
scrape, accidental commit, ex-contractor):

1. Generate a second token in the Postmark dashboard (Postmark allows multiple active tokens per
   server).
2. Roll the new value into the production `.env` and deploy.
3. After the deploy is green and mail is flowing, revoke the old token in the Postmark dashboard.

Never run with zero tokens for the cutover window.

## 7. Smoke test

After steps 1–5, run a smoke from production:

```bash
# inside the running container or via psql
psql $DATABASE_URL -c "SELECT 1"  # sanity
# Trigger a verification email by signing up via the production site
# with a real inbox you control.
```

Expect:

- Mail arrives within 30s
- Gmail "Show original" → `SPF: PASS, DKIM: PASS, DMARC: PASS`
- `email_event` table gets a `delivery` row within a minute

If any of these fail, walk back through `dns-setup.md`.

## When something goes wrong

- **Sends fail with 422 "Sender signature not confirmed"** — DNS not propagated yet, or the DKIM key
  was copied incorrectly. Re-paste from Postmark verbatim.
- **Sends fail with 401** — Server Token revoked or wrong env value. Generate a fresh one.
- **Webhook stops firing** — Postmark disables webhooks that return non-200 for 24h. Check Sentry
  for the handler's error history, fix the underlying issue, and re-enable in the dashboard.

## Related

- `dns-setup.md` — the DNS records this account needs to be effective.
- `server/api/email/webhook.post.ts` — the receiver of the Postmark webhook events configured above.
- Privacy policy + sub-processors list (`/sub-processors`) — Postmark is documented there as our
  transactional email processor.
