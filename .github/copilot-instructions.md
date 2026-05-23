# Copilot review instructions — Grundtone Studio

These instructions tell GitHub Copilot's PR reviewer what to look for in this codebase. They mirror
the rules a human reviewer applies, derived from `CLAUDE.md` and the standards we've enforced across
the existing PRs.

## What this repo is

Private monorepo for **Grundtone Studio** (Nuxt 3 + Nitro SaaS) and `@grundtone/saas-client`
(runtime SDK). TypeScript end-to-end. Better Auth + Drizzle + Postgres + S3-compatible storage.
EU-hosted, GDPR-scoped.

## Review priorities (in order)

### 1. Dead code & duplication

- Flag unused exports, unreferenced helpers, unreachable branches, leftover
  `console.log`/`debugger`.
- Flag commented-out code blocks that aren't documented as future work.
- Flag duplicated logic across files — if two places do the same thing, suggest extracting a shared
  helper. Three near-identical lines is fine; a fourth means it should be DRY.
- After a refactor, the OLD code path should be gone, not parallel. We have an explicit "refactor
  over duplicate" rule.

### 2. DRY without premature abstraction

- Push back on copy-paste duplication, BUT also push back on abstractions invented for one caller.
  "Three similar lines is better than a premature abstraction" — flag both extremes.
- Helper functions that wrap a single call with no added behaviour are noise. Flag them.

### 3. SOLID, sized for a Nuxt/Nitro app

- **Single responsibility**: a server handler should validate input, call domain helpers, and shape
  the response — not also render Markdown or hash passwords. Domain logic belongs in `server/lib/*`.
- **Open/Closed**: new behaviour added via composition or new modules, not by branching inside
  existing helpers with feature flags.
- **Liskov**: function signatures should mean what their types say. A return type of `User`
  shouldn't sometimes be `null` — say `User | null`.
- **Interface segregation**: zod schemas split per endpoint, not one mega-schema with optional
  fields per route.
- **Dependency inversion**: server code talks to the storage abstraction in `server/lib/storage.ts`,
  not directly to `@aws-sdk/client-s3`.

### 4. No hardcoded user-facing strings

- **Every** string the user sees flows through `useI18n()` / `t(...)` and exists in both
  `apps/studio/i18n/locales/da.json` and `en.json`. Default locale is Danish; English is the
  secondary.
- This includes button labels, alert headings, placeholder text, `aria-label`, `confirm()` messages,
  and email subjects/bodies.
- Email templates live in `server/lib/email-templates.ts` and are locale-aware via
  `localeFromBetterAuthContext()` / `localeFromEvent()`.
- Exception: log messages (`console.warn/error/info`) stay in English. They're for engineers, not
  end users.
- Flag any `<button>Save</button>` or `throw new Error('Not found')` — shapes that reach the user —
  with a recommendation to plumb through i18n.

### 5. Magic strings & enums

- Status / role / event-type strings should be `const` unions or zod enums, not bare string literals
  scattered across files. Examples already in the codebase: `OrgRole`, `ProjectRole`, `AuditAction`.
- Audit-log action names, role names, environment names, CDN-key types all live in one place and get
  imported.
- Flag `if (role === 'admin')` if `role` could be typed as `OrgRole` instead of `string`.

### 6. Tests + estimated coverage

For each PR, evaluate:

- **What's the new behaviour?** Identify the function or flow under test.
- **What tests cover it?** Look for `*.test.ts` next to the changed files. New behaviour without new
  tests is a flag unless explicitly justified (pure wiring, framework-only, docs-only, covered by an
  existing integration test).
- **Estimate code coverage** of the changed lines: rough percentage of new conditional branches that
  are exercised by tests. Flag if significantly below ~70% for server-lib code, ~50% for UI
  components (UI components have a lower bar because most logic should already live in the testable
  `server/lib` or `utils` layer).
- Tests must use fake timers cleanly: `vi.useRealTimers()` in `afterEach` whenever
  `vi.useFakeTimers()` is set in `beforeEach`.
- Tests that mutate `process.env` must restore it in `afterAll`.

### 7. Architecture invariants (hard rules)

These come from `CLAUDE.md` and must never be relaxed:

- **Every API endpoint validates input via zod.** Raw `readBody()` without a schema parse is a bug.
- **Project endpoints go through `requireProjectAccess(event, projectId, min)`** from
  `server/lib/project-access.ts`. Direct DB access for an authz check is a bug.
- **Org-level endpoints use `requireOrgRole(event, orgId, min)`** from the same module.
- **API keys: SHA-256 hashed at rest, plaintext shown once.** Storing the plaintext is a bug.
  Returning the plaintext on a list endpoint is a bug.
- **Storage paths are immutable per version, pointer files are mutable.**
  `p/{projectId}/v{n}/tokens.{json,css}` is never overwritten; `p/{projectId}/current.{json,css}`
  is.
- **Org-role mapping** (Sentry-style 5-tier) lives only in `server/lib/project-access.ts` —
  re-encoding the mapping anywhere else is a bug.

### 8. Security & data hygiene

- User-controlled values in HTML must escape (`server/lib/email-templates.ts` has a working `esc()`
  helper).
- Constant-time compare for secrets (use `crypto.timingSafeEqual`, not manual byte loops).
- No `console.log` of session tokens, raw API keys, hashed passwords, or webhook secrets.
- New env vars must be added to `apps/studio/.env.example` with a comment block explaining what it
  does and where the value comes from.
- Webhook + callback endpoints must authenticate the caller (HMAC or Basic Auth depending on
  provider).

### 9. Grundtone-first

We eat our own design system. Flag:

- Inline `style="..."` attributes — promote to a class instead.
- Ad-hoc CSS classes when a grundtone utility (`flex`, `gap-*`, `text-tertiary`,
  `bg-surface-raised`, etc.) already covers it.
- Hardcoded color values in components — they should come from CSS variables driven by tokens.
- Native `<button>` / `<input>` used instead of `<GTButton>` / `<GTInput>` when no extra feature is
  needed.

### 10. Database migrations

- Drizzle migrations live in `apps/studio/server/db/migrations/`. New schema changes must include:
  - The `.sql` file with explicit `CREATE INDEX` statements after `--> statement-breakpoint`
    (matches the rest of the chain).
  - A new entry in `meta/_journal.json` with monotonic `idx` and `when`.
  - A `meta/NNNN_snapshot.json` updated to reflect the new schema (copied from the previous
    snapshot + the new table block).
- Migrations should be additive when possible; column drops + renames need the explicit `--down`
  companion if they affect production data.
- Data-only migrations (no schema diff) still need a journal entry and a snapshot copy with the
  prev/next IDs threaded.

### 11. Audit log

Any new mutation that an org member can perform on shared state should emit an audit event via
`recordAuditEvent()`. Examples already wired: member invite/role/remove, project create, api-key
create/revoke, config publish/activate. Flag new mutations that skip the audit.

### 12. Comments & docstrings

- Default to no comments. Add one only when the _why_ is non-obvious — a hidden constraint, a subtle
  invariant, a workaround for a specific bug.
- Don't explain _what_ the code does; well-named identifiers should already do that.
- Don't reference the current task, fix, or PR in comments (those belong in the PR description and
  the commit message). They rot.
- Docstrings on exported helpers should describe inputs, outputs, and failure modes — not
  implementation details.

### 13. Commit & PR hygiene

- Conventional commits enforced via commitlint: `<type>(<scope>): <subject>`. Valid scopes:
  `auth, db, dashboard, api, ui, deps, config, ci, docs, deploy`.
- Never `Co-Authored-By: Claude`-style attributions.
- Never `--no-verify` on commits or `--force` on pushes to `develop`/`main`.

### 14. DoD checklist

Every PR description should explicitly answer:

1. What's the behaviour under test?
2. What tests cover it (existing or new)?
3. If no tests added, why not? ("Trivial wiring" / "framework-only" / "covered by integration test
   #67" are valid; "didn't write any" is not.)

Flag PRs that skip this evaluation.

## What NOT to flag

To keep noise low, please skip these:

- Style/whitespace nits — Prettier handles them in the pre-commit hook.
- Import ordering — ESLint handles it.
- Single-line comments on obvious code (`// increment counter`) — flag them as removable but don't
  block the PR over them.
- TypeScript type widening in _test files_ — tests cast freely; only flag in production code.
- Markdown line breaks / Oxford commas in docs.

## Stack reference

- Nuxt 3 + Nitro, Vue 3, Vite, pnpm workspace, Turbo
- Better Auth (custom 5-tier org roles, organization plugin)
- Drizzle ORM + Postgres
- S3-compatible storage (MinIO local, UpCloud prod)
- Bunny.net for CDN delivery
- Postmark for transactional email (DNS + provisioning in `docs/email/`)
- Sentry for error tracking, OpenTelemetry under the hood
- Vitest for unit tests (file convention: `*.test.ts` next to source)
- `@grundtone/vue` + `@grundtone/nuxt` as the consumed design system
