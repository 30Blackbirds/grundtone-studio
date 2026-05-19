# Email DNS records — `grundtone.com`

Three records gate whether transactional mail (verification, magic link, invitations) lands in
customer inboxes vs. spam:

- **SPF** — declares which servers are allowed to send from `grundtone.com`.
- **DKIM** — cryptographically signs outgoing mail so receivers can verify it really came from us.
- **DMARC** — tells receivers what to do when SPF/DKIM disagree (quarantine, reject, or report).

Without all three, providers like Gmail and Microsoft route our verification mail to spam — which
silently breaks signup.

## Records to add at the registrar

These are configured at the DNS provider for `grundtone.com` (Cloudflare, Simply, GoDaddy, etc.).
The exact DKIM value comes from Postmark — see `postmark-setup.md` first.

### 1. SPF — `TXT` record at the root

```
@   TXT   "v=spf1 include:spf.mtasv.net ~all"
```

- `include:spf.mtasv.net` is Postmark's SPF host.
- `~all` is soft-fail: receivers should treat unknown senders with suspicion but not outright
  reject. Promote to `-all` (hard fail) once we're confident no rogue senders exist (a few weeks
  after launch).
- **Only one SPF record per domain.** If a record already exists (e.g. from a prior provider), merge
  the `include:` directives into a single record rather than adding a second one.

### 2. DKIM — `TXT` record at the subdomain Postmark dictates

Postmark generates a unique selector for our sender signature. The full record looks like:

```
20240515pm._domainkey   TXT   "k=rsa;p=MIGfMA0GCSqGSIb3DQEBAQUA…"
```

- The selector (`20240515pm`) and key value are shown in the Postmark dashboard under **Servers →
  Settings → Sender Signatures → DKIM**.
- Copy the value verbatim, including the `k=rsa;p=` prefix.
- Some registrars wrap long values automatically — that's fine, the receiver reassembles them.

### 3. Return-Path / CNAME — bounce handling

Postmark needs a custom Return-Path so bounces flow back to them (and into our webhook, see
`postmark-setup.md`):

```
pm-bounces   CNAME   pm.mtasv.net
```

- The hostname is shown in Postmark dashboard alongside the DKIM record.
- Without this, bounces still work but Postmark can't attribute them, which hurts our deliverability
  score.

### 4. DMARC — `TXT` record at the `_dmarc` subdomain

```
_dmarc   TXT   "v=DMARC1; p=none; rua=mailto:postmaster@grundtone.com; fo=1"
```

- `p=none` for the first 30 days: collect reports without disrupting mail flow. Then graduate to
  `p=quarantine` (send failing mail to spam) and finally `p=reject` (drop it) after a clean
  reporting window.
- `rua=` is where aggregate reports go. Set up a forwarding alias to whoever watches deliverability.
- `fo=1` requests failure reports for any auth fail (more verbose than the default `fo=0`).

## Verification

After adding all four records, propagation can take 5–30 minutes. Verify via:

```bash
dig +short TXT grundtone.com
dig +short TXT 20240515pm._domainkey.grundtone.com
dig +short CNAME pm-bounces.grundtone.com
dig +short TXT _dmarc.grundtone.com
```

Each should return the configured value. Postmark's dashboard also lights up green for each record
once it sees correct DNS — that's the canonical "we're good" signal.

## When something goes wrong

- **Verification email landing in spam**: SPF or DKIM not propagated yet, or `From` address doesn't
  match the verified sender signature in Postmark. Check Gmail's "Show original" headers —
  `SPF: PASS, DKIM: PASS` is the target.
- **Bounces don't appear in our webhook**: Return-Path CNAME missing or webhook URL not set in
  Postmark. See `postmark-setup.md`.
- **DMARC reports flooding the inbox**: switch `rua=` to a Postmark aggregation service or set up
  filtering rules — they arrive daily and fill inboxes quickly.

## Related

- `postmark-setup.md` — how to provision the Postmark server, get the DKIM key, and configure the
  bounce webhook.
- Privacy policy + sub-processors list (`/sub-processors`) — Postmark is documented there as our
  transactional email processor.
