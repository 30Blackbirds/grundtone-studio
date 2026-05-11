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

## Test conventions

- Vitest in both `apps/studio/` and `packages/saas-client/`
- File naming: `*.test.ts` co-located with the file under test (`server/lib/foo.ts` →
  `server/lib/foo.test.ts`)
- Server tests run in node environment; SDK tests use `happy-dom`
- Focus tests on: token schema, css renderer, api-key crypto, publish pipeline, SDK behaviour. UI
  components and trivial getters are lower priority.

## Architecture invariants

- **All API endpoints validate via zod.** No raw `readBody()`.
- **All project endpoints go through `requireProjectAccess()`** in `server/lib/project-access.ts`
  for the membership check. Admin-only actions also call `requireAdmin(role)`.
- **API keys: hash SHA-256 at rest, plaintext shown once.** Don't change the storage format.
- **Storage paths:** `p/{projectId}/v{n}/tokens.{json,css}` are immutable;
  `p/{projectId}/current.{json,css}` is overwritten each publish.
- **CDN endpoint path:** `/k/{plaintext_key}/{file}` — plaintext key lives in URL by design (same
  model as Stripe `pk_live_` keys).

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

## When in doubt

- Read `klanghaus/docs/grundtone-studio/roadmap.md` for what's planned.
- Read `klanghaus/docs/grundtone-studio/architecture.md` for how it all hangs together.
- The codebase is the source of truth. If a doc and the code disagree, the code wins and the doc
  gets updated.
