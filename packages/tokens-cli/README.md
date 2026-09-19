# @grundtone-studio/tokens-cli

Headless CLI for managing a Grundtone Studio project's design tokens — built for automated workers
(e.g. the design worker) that change tokens on projects without the web UI.

## Auth

Uses a **per-project secret key** (`sk_...`, editor scope on that one project). An org admin creates
one in Studio:

```
POST /api/projects/{projectId}/api-keys  { "keyType": "secret" }
```

The plaintext is shown once. The key's editor grant is a PDP `machine:{keyId}` tuple (single source
of truth — revoking the key deletes the tuple).

## Config

Resolved in order: flags → env → `~/.grundtone/config.json`.

```jsonc
// ~/.grundtone/config.json
{
  "apiBase": "https://studio.grundtone.com",
  "keys": {
    "<projectId>": "sk_live_…", // per-project
    "default": "sk_live_…", // optional fallback
  },
}
```

Or `GRUNDTONE_API_BASE` + `GRUNDTONE_TOKEN_KEY`, or `--api-base` / `--key`.

## Commands

```sh
grundtone-tokens get <projectId>                        # print draft + active tokens
grundtone-tokens set <projectId> --set colors.primary=#0059b3
grundtone-tokens set <projectId> --file tokens.json     # replace from a file
grundtone-tokens publish <projectId>                    # publish the current draft
grundtone-tokens export <projectId> --format dtcg --source active --out tokens/
```

`set` without `--file` starts from the current draft, so `--set` tweaks one slot without resending
the whole object. Tokens are validated server-side against the Studio token schema (400 with the
field error on invalid input).

`export` writes DTCG 2025.10 files: `<slug>.tokens.json`, plus `<slug>.dark.tokens.json` and
`<slug>.resolver.json` when the project has dark colors. `--source` has no default, so you always
say whether you want the draft or the published set. The server does the conversion (the same files
as the Export tab in Studio) and the command prints what was left out or converted. See
[`packages/dtcg`](../dtcg/README.md) for the mapping.

## Build / run

```sh
pnpm --filter @grundtone-studio/tokens-cli build   # → dist/cli.js (the bin)
pnpm --filter @grundtone-studio/tokens-cli dev -- get <projectId>   # tsx, no build
```
