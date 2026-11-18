# Contributing

Operational guide for working on Grundtone Studio. Code conventions live in
[`CLAUDE.md`](./CLAUDE.md); this doc covers the workflow around them.

## Branch model

`main` is the only long-lived branch. Work happens on short-lived topic branches (`feat/*`, `fix/*`,
`chore/*`, `docs/*`) that are opened as pull requests against `main`. History on `main` is linear:
pull requests are squash-merged, and the PR title becomes the commit subject.

Maintainers: `main` should have branch protection requiring a pull request, passing status checks
(`verify` and the commitlint `lint` job from `.github/workflows/`), linear history, and no force
pushes or deletions.

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

1. Branch off `main` with `git checkout -b feat/...`
2. Commit early, commit often. Each commit must pass `pre-commit`.
3. Push and open a PR against `main`
4. CI runs: `verify` (lint + typecheck + test + build) and `lint` (commitlint on PR title + commits)
5. Once green, request a review
6. Merge via **Squash and merge**. The PR title becomes the commit subject — make it conventional.

## Tags + releases

A semver tag on `main` (`vX.Y.Z`) builds, signs (cosign) and publishes the release image through
[`build.yml`](./.github/workflows/build.yml). Only maintainers cut `v*` tags.

The SDK (`@grundtone/saas-client`) versions independently, through
[Changesets](./.changeset/README.md). Add a changeset (`pnpm changeset`) for any user-visible SDK
change.

## Dependabot

Weekly grouped npm bumps, monthly Actions + Docker bumps. See
[`.github/dependabot.yml`](./.github/dependabot.yml) for which packages are excluded and bumped
manually.

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
