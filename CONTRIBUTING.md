# Contributing

Operational guide for working on Grundtone Studio. Code conventions live in
[`CLAUDE.md`](./CLAUDE.md); this doc covers the workflow around them.

## Branch model

| Branch                       | Purpose                                                       | Direct push?            |
| ---------------------------- | ------------------------------------------------------------- | ----------------------- |
| `main`                       | Production-ready. Each merge is tagged + deploy-eligible.     | No — PR + 1 review      |
| `develop`                    | Integration branch. Auto-deploys to staging once provisioned. | No — PR with passing CI |
| `feat/*`, `fix/*`, `chore/*` | Topic branches off `develop`. Short-lived.                    | Yes                     |

History on `main` is **linear** (squash-merge only). `develop` accepts squash and rebase merges;
never a regular merge commit.

## Required GitHub branch protection

Configure both branches identically in GitHub UI → Settings → Branches:

**`main`:**

- ✅ Require a pull request before merging
- ✅ Require approvals: 1
- ✅ Dismiss stale approvals on new commits
- ✅ Require status checks to pass: `verify`, `lint` (commitlint workflow)
- ✅ Require branches to be up to date
- ✅ Require linear history
- ✅ Restrict pushes (admins included)
- ❌ Allow force pushes
- ❌ Allow deletions

**`develop`:**

- ✅ Require a pull request before merging
- ✅ Require status checks: `verify`, `lint`
- ✅ Require branches to be up to date
- ❌ Approvals not strictly required while solo
- ❌ Allow force pushes
- ❌ Allow deletions

Allow squash-merge and rebase-merge in repo settings; disable regular merge.

## Commit conventions

Conventional commits, enforced by commitlint locally (pre-commit hook) and on the server
(`commitlint.yml` workflow). See [`commitlint.config.js`](./commitlint.config.js) for the exact
enum.

```
<type>(<scope>): <subject>

<body>
```

- **Types:** feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
- **Scopes:** auth, db, dashboard, api, ui, deps, config, ci, docs, deploy
- **Subject:** imperative, lowercase, no trailing period, ≤ 100 chars
- **Body lines:** ≤ 100 chars
- **No `Co-Authored-By` lines**
- **No `--no-verify`** to bypass hooks — fix the underlying issue

## Pre-commit + pre-push

`pnpm install` from the root sets up husky automatically.

- `pre-commit`: `lint-staged` (prettier + eslint + stylelint on changed files) +
  `turbo run typecheck` (cached)
- `commit-msg`: `commitlint`
- `pre-push`: `turbo run test` (cached)

If a hook fails, fix the issue. The hooks mirror CI exactly so if it passes locally, it'll pass on
the server.

## Pull request flow

1. Branch off `develop` with `git checkout -b feat/...`
2. Commit early, commit often. Each commit must pass `pre-commit`.
3. Push and open a PR against `develop`
4. CI runs: `verify` (lint + typecheck + test + build) and `lint` (commitlint on PR title + commits)
5. Once green, request review (or self-merge if solo)
6. Merge via **Squash and merge**. The PR title becomes the commit subject — make it conventional.

## Tags + releases

A semver tag on `main` (`vX.Y.Z`) builds, signs and publishes the release image through
**`build.yml`**. It no longer deploys anything: the `deploy-production` job, which copied the
compose file and the Caddyfile to the production VM over SSH and restarted it, was removed (ClickUp
1amk32fn4rv).

Production is deployed like the other stacks: Infra rolls out a cosign-verified image, authorised by
Allan's phrase. Only Allan cuts `v*` tags.

The SDK (`@grundtone/saas-client`) versions independently — see the Changesets-based flow in
`klanghaus/docs/grundtone-studio/roadmap.md`.

## Secrets

Three GitHub Environments map to deploy targets:

| Environment  | Used by                                       | Protection rules                       |
| ------------ | --------------------------------------------- | -------------------------------------- |
| `staging`    | `build.yml` / `deploy-staging`                | **None** — auto on every green develop |
| `production` | nothing since `deploy-production` was removed | **None**                               |
| `release`    | `sdk-release.yml`                             | **None**                               |

Measured against `GET /repos/KlangHaus/grundtone-studio/environments` on 2026-08-11: every
environment reports an empty `protection_rules`. The environments are a **secret-scoping and audit
boundary**, not an approval gate. Do not read "deploys go through an Environment" as "someone
approves the deploy".

Each environment owns its own secrets (`STAGING_SSH_KEY`, `PROD_SSH_KEY`, `BUNNY_API_KEY`, etc.).
Never put deploy-target secrets in repository-wide secrets — environments are the audit boundary.

## Dependabot

Weekly grouped npm bumps, monthly Actions + Docker bumps. Grundtone packages are explicitly excluded
— bump them manually so they stay in step with the upstream design system.

Review and merge Dependabot PRs the same way as human PRs (CI must pass).

## Local mirror of CI

The hooks already cover the most common drift, but if you want to be sure:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm stylelint
pnpm typecheck
pnpm test
pnpm build
```

This sequence is exactly what CI runs.
