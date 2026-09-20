# Grundtone Studio — Claude Code conventions

Project-level instructions for any Claude session working in this repo. Personal preferences live in
your global memory; everything here is repo-wide.

## What this repo is

Private monorepo for **Grundtone Studio**, a SaaS that lets organizations configure design tokens
via a web UI and distributes them to customer apps via runtime CDN + SDK. Architecture in
`klanghaus/docs/grundtone-studio/`.

- `apps/studio/` — Nuxt 3 SaaS app (Better Auth, Drizzle, Postgres, S3-compatible storage)
- `packages/saas-client/` — runtime SDK published as CDN bundle + privat npm

Stack is TypeScript end-to-end. No Python, no Go.

## Grundtone-first — non-negotiable

This project consumes `@grundtone/vue` + `@grundtone/nuxt` as the design system.
Eat-your-own-dog-food is the whole point.

**Rules:**

- Use grundtone components (`<GTButton>`, `<GTInput>`, `<GTAlert>`, `<GTCard>`, `<GTSelect>`,
  `<GTTabs>`, `<GTTabPanel>`, `<GTBadge>`, `<GTSkipLink>`, etc.) for all interactive UI. Reach for
  native elements only when no grundtone component exists.
- Use grundtone utility classes (`flex`, `gap-*`, `p-*`, `text-tertiary`, `bg-surface-raised`,
  `border`, `rounded-lg`, etc.) for layout/spacing.
- **No inline `style="..."`** — promote to a class in `apps/studio/assets/css/app.css` if grundtone
  doesn't cover it.
- **No new ad-hoc CSS classes** unless the design system genuinely can't express it. When you do add
  one, document why in a comment.
- **No custom color values in components.** Themes flow through CSS variables from grundtone tokens.
  If you need a new color slot, add it to the token schema in `apps/studio/server/lib/tokens.ts`,
  not as a hardcoded hex.

If a grundtone component is missing a feature you need, the right fix is usually **upstream** in
`KlangHaus/grundtone`, not a workaround here. See the "design system must be self-contained"
principle.

## Conventional commits — enforced

`commit-msg` hook runs commitlint. Format:

```
<type>(<scope>): <subject>
```

Valid scopes (`commitlint.config.js`):
`auth, db, dashboard, api, ui, deps, config, ci, docs, deploy`

If your work doesn't fit a scope, talk it out before adding a new one.

**Never** add `Co-Authored-By` to commit messages. **Never** use `--no-verify` to skip hooks.

## Pre-commit and pre-push

`.husky/pre-commit` runs:

1. `lint-staged` — prettier + eslint + stylelint on changed files
2. `turbo run typecheck` — full workspace (cached, fast after first run)

`.husky/pre-push` runs:

1. `turbo run test` — full test suite (cached)

If a hook fails, **fix the underlying issue**. Don't bypass.

## Definition of Done

A change isn't done until you have **explicitly evaluated** whether it needs new tests. This is part
of every commit, every PR, every TODO closure — not optional.

For each change, answer in plain words (in the commit body or PR description):

1. **What's the behaviour under test?** (e.g. "publish reserves version before S3 upload", "rate
   limit returns 429 after N requests")
2. **What tests cover it?** Existing or newly added — list the file(s).
3. **If no tests:** why not? "Trivial wiring", "framework-only", "covered by an existing integration
   test" are valid answers. "I didn't write any" is not.

The code-reviewer agent blocks PRs that skip this evaluation. If a TODO is about behaviour (not pure
refactor), it cannot be marked completed without a test that exercises it.

## Test conventions

- Vitest in both `apps/studio/` and `packages/saas-client/`
- File naming: `*.test.ts` co-located with the file under test (`server/lib/foo.ts` →
  `server/lib/foo.test.ts`)
- Server tests run in node environment; SDK tests use `happy-dom`
- Focus tests on: token schema, css renderer, api-key crypto, publish pipeline, SDK behaviour. UI
  components and trivial getters are lower priority — but evaluate them per the DoD above.

Two failures that both happened here on 2026-09-20, written down because each one _looked_ like the
opposite of what it was:

- **A zero is not a finding until you have controlled the instrument.** Chasing whether toasts
  render, three separate actions produced 0 toasts, and all three were the measurement: an endpoint
  the local auth stub answers with 501, a clipboard call that rejects when the browser pane is not
  focused, and an action whose code does not toast at all. Each on its own read as "the product is
  still broken". Fire the signal you expect _before_ you trust its absence.
- **A cell that reads the source text is not a cell that reads the event.** The guard asserting that
  a Nitro plugin calls the bypass bind-assertion stayed green through a mutation that removed the
  event entirely — first when the export form changed so Nitro no longer loaded the file, then when
  the call survived only as a comment. Both were found by mutating, not by reading. If a cell greps,
  say in the cell what it therefore cannot see.

## Architecture invariants

- **All API endpoints validate via zod.** No raw `readBody()`.
- **All project endpoints go through `requireProjectAccess(event, projectId, min='viewer')`** in
  `server/lib/project-access.ts`. The third argument is the minimum project role required: `viewer`
  for reads, `editor` for tokens/publish/activate, `admin` for keys + members.
- **Org roles** are Sentry-style 5-tier: `billing → member → admin → manager → owner`. Skaberen af
  en org får `owner`. Org-level helpers (`canManageOrgMembers`, `canManageBilling`,
  `canCreateProjects`) live in `useOrgRoles` (client) and `orgRoleHelpers` (server).
- **Effective project role** = `max(org-role-mapped, direct-project-role)`. Org `owner`/`manager` →
  project `admin`; org `admin`/`member` → project `viewer`; org `billing` → `null`. Direct project
  members get exactly the role they were invited for. `getProjectRole` is the only place this
  mapping is allowed to live.
- **API keys: hash SHA-256 at rest, plaintext shown once.** Don't change the storage format.
- **Storage paths:** `p/{projectId}/v{n}/tokens.{json,css}` are immutable;
  `p/{projectId}/current.{json,css}` is overwritten each publish.
- **CDN endpoint path:** `/k/{plaintext_key}/{file}` — plaintext key lives in URL by design (full
  rationale in `docs/api/cdn-keys.md`; same model as Stripe `pk_live_` keys).

## i18n

- Default locale: Danish. English is second.
- Strings live in `apps/studio/i18n/locales/{da,en}.json`.
- All user-facing strings go through `t()` — no English text directly in templates outside locale
  files.
- Don't reach into the `t()` shape from server code; if a server-rendered string needs i18n, plumb
  the locale through the request.

## Code style

- No comments that just describe what code does. Only comment **why** when the reason isn't obvious
  from reading.
- No backwards-compatibility shims for code that was never released.
- Don't add error handling for "can't happen" paths. Only validate at trust boundaries (user input,
  external APIs).
- Default exports only when the framework requires them (Nuxt pages, Nitro handlers, Vue
  components). Otherwise named exports.

## Refactor over duplicate

When a feature replaces or supersedes existing code, **refactor or delete the old code in the same
PR**. Don't leave parallel implementations, unused helpers, or stale UI gates behind. Specifically:

- A new permission check superseding `isAdmin`/`requireAdmin` means every existing call site moves
  to the new helper. The old helper either gets deleted or becomes a thin alias with a deprecation
  comment that points to its retirement task.
- A schema change that re-models an existing relationship updates the migration AND the seed AND the
  tests AND the docs — not just the new tables.
- A new component that fits an old component's spot replaces it. The old file gets deleted unless
  it's still consumed elsewhere.
- "Leaving the old code around just in case" is not a justification. Git keeps it around.

## When in doubt

- Read `klanghaus/docs/grundtone-studio/roadmap.md` for what's planned.
- Read `klanghaus/docs/grundtone-studio/architecture.md` for how it all hangs together.
- The codebase is the source of truth. If a doc and the code disagree, the code wins and the doc
  gets updated.
