// grundtone-studio · parallel mode against KlangHaus/jenkins-library
//
// 🔴 THIS FILE MUST NOT GROW. Repo-specific pipeline logic belongs in the
//    library as a parameterised facility — a PR to [quality] — NEVER here.
//    Otherwise we end up with nine interpretations of "as we recommend it".
//
// 🔴 PARALLEL, NOT FLIP. `checksPrefix` publishes the names as `jenkins/Test`
//    next to Actions' `Test`. Without the prefix they would not stand NEXT TO
//    it but REPLACE it: GitHub takes the LATEST check run per name regardless
//    of app, and Jenkins reports after Actions — every PR would be blocked by
//    a red check from an agent without tooling.
//    (Measured by [taktart] on their main `0e1a214`.)
//
//    FLIP is ONE operation with three steps in THIS order:
//      remove the prefix -> verify the names landed -> turn Actions off LAST.
//    Never the reverse: a missing required check cannot be seen failing — it
//    just says "Expected" forever.
//
// 🔴 THE GATE LIVES IN BRANCH PROTECTION, NOT IN A RULESET. Measured on both
//    surfaces 2026-09-11: `branches/main/protection` has 14 contexts,
//    `rules/branches/main` has none. (grundtone is the reverse — there it
//    lives in the ruleset. The two repos cannot be measured with one call.)
//    `Test` below is the EXACT required name; the prefix is added by the
//    library, so at flip one line is removed and the name is already right.
//
// ⛔ `Test` and `Lint & Typecheck` ARE PORTED (the latter folds ESLint,
//    Prettier, Stylelint, TypeScript and i18n parity, see its block). The other required contexts stay on Actions
//    until each has been measured on its own. A thin start is not a partial
//    port: it is one name at a time, where disagreements can be attributed.
//
// 🔴 POSTGRES COMES FROM `KH_TEST_PG_DSN`, NOT FROM `services:`. The library's
//    `services:` catalog only DECLARES a sidecar (`klanghausServices.declare()`
//    sets KH_SVC_*_HOST/PORT and starts nothing); the controller-side mechanism
//    that would start it does not exist, and the two consumers that relied on
//    it were red on exactly that check (this repo on main `a21bf06`, permissions'
//    `Integration assertions`). What DOES exist is infra#395 (2026-09-30): every
//    agent gets `KH_TEST_PG_DSN` to the shared `ci-postgres` (jenkins.yaml) as
//    the role `ci_build` (NOSUPERUSER NOCREATEROLE CREATEDB), and each build
//    must create and drop its own database. resonans' `Tenant isolation` is
//    green on that contract; here the per-build database is made by
//    `apps/studio/server/db/ci-db.ts`.
//
// ⚠️ A DECLARED DIFFERENCE, so a disagreement during the parallel week is not
//    attributed to the port: Actions runs `postgres:17-alpine` as
//    `grundtone/grundtone_ci`, database `grundtone_studio`; ci-postgres is
//    `postgres:16-alpine` as `ci_build`, database
//    `studio_<BUILD_TAG>_<hash>` (apps/studio/server/db/ci-db-name.ts). Schema
//    and tests are the same. Should a test one day depend on the database NAME or
//    on a postgres-17-only feature, this is where the disagreement comes from.
//
// 🔴 IF THE CATALOG DOES NOT COVER a future stack: open a PR to
//    jenkins-library with image AND digest. That is the ONLY way.
//    The temptation — `docker run` your own image from `cmd` below — is
//    closed on purpose: the agent has no docker, and if it had, that would
//    require socket access, i.e. root equivalence for foreign code.
//    [sikkerhed]'s ruling: the distinction is the CAPABILITY, not the intent.
//    Moving execution without moving the specification moves the syscall, not
//    the trust boundary. That is why image and digest live on the trusted
//    side, and a repo declares a KEY from a closed set.
//    Written here rather than only in a riff, because the riff gets closed
//    and the file stays — and because otherwise the next gap becomes "the
//    catalog did not cover it", found under time pressure by someone who does
//    not know the reasoning.

@Library('klanghaus') _

klanghausPipeline(
  repo: 'KlangHaus/grundtone-studio',

  // Required by the library's sonar gate and by the `schedule` assertion.
  // Measured, not assumed: studio's default is `main` (grundtone's is `develop`).
  defaultBranch: 'main',

  // Default is 20. Actions' Test job takes ~1m28 with a warm cache; a cold
  // first run here makes install + migrate + test more expensive, and a
  // timeout in the middle of the parallel week would be read as a
  // disagreement between the instruments rather than as a limit we set.
  timeoutMinutes: 30,

  checksPrefix: 'jenkins/',

  // 🔴 REQUIRED IN PARALLEL MODE. Without `tools:`, `toolchains:` or
  //    `toolsNone:` the library stops every build in `checks`
  //    (klanghausPipeline.groovy:356), and no `jenkins/*` context is published.
  //    That was the state from #257 to riff hmatw17ycx9pfca2jakyae69.
  //
  // Not `toolsNone:`. Studio needs node 24: `.npmrc` has `engine-strict=true`
  // and `engines.node` is `>=24.0.0`. The agent's default node is 22.23.2, so
  // `pnpm install` would stop on the engine check, a red that says nothing
  // about the code. `toolchains` puts the agent's /usr/local/node-24.20.0 first
  // on PATH (klanghausToolchain.groovy, node contract); `tools` then asserts
  // what actually runs.
  //
  // ⚠️ A DECLARED DIFFERENCE: Actions reads `.nvmrc` (24.13.0). The agent image
  //    has one node 24, 24.20.0 (infra compose/prod/ci/agent/Dockerfile), so
  //    the two sides run different patch versions until `.nvmrc` moves to
  //    24.20.0 (blog did that in the same commit as its pin).
  //    pnpm matches: both sides take `packageManager` (pnpm@10.14.0); blog's
  //    green builds with a 10.0.0 pin show the agent honours that field.
  toolchains: ['node': [exact: '24.20.0']],
  tools: [
    'node': [exact: '24.20.0', cmd: 'node --version'],
    // `2>/dev/null | tail -1`: keeps the version line clean of any pnpm
    // warning on stderr.
    'pnpm': [exact: '10.14.0', cmd: 'pnpm --version 2>/dev/null | tail -1'],
  ],

  pnpmCache: true,

  checks: [
    [
      // The exact required name. See the note on the prefix above.
      context: 'Test',

      // No registry token: @klanghaus/auth-jwt and permissions-client are
      // vendored in apps/studio/server/vendor/ (KH-944, #354), so every
      // dependency is public. (`npmAuth:` would bind nothing anyway — the
      // library withdrew it.)

      cmd: '''
        set -euo pipefail

        # Fail closed and NAME the gap. An unset DSN means the facility was
        # renamed or removed; a check that quietly passes on no database is the
        # silence this check exists to end.
        test -n "${KH_TEST_PG_DSN:-}" || {
          echo "KH_TEST_PG_DSN is unset — this check needs the CI postgres from"
          echo "infra compose/prod/ci (ci-postgres, agent env via jenkins.yaml)."
          echo "Refusing to pass: no database is a wiring error, not a green."
          exit 1
        }

        # Same values as Actions' test job. They are CI placeholders, not
        # secrets — they are in plain text in ci.yml for the same reason.
        export BETTER_AUTH_SECRET='ci-secret-not-for-production-use-only'
        export BETTER_AUTH_URL='http://localhost:3000'
        export S3_ENDPOINT='http://127.0.0.1:9000'
        export S3_REGION='us-east-1'
        export S3_BUCKET='grundtone-studio'
        export S3_ACCESS_KEY_ID='ci'
        export S3_SECRET_ACCESS_KEY='ci-secret'
        export TURBO_TELEMETRY_DISABLED=1

        # `klanghausPipeline` has only checkout and checks — no build phase, and
        # all checks share one workspace. That is why each `cmd` is
        # self-contained; Actions' artifact hand-off (setup uploads, four jobs
        # download) does not exist here.
        pnpm install --frozen-lockfile

        # 🔴 POSITIVE CONTROL BEFORE THE MEASUREMENT: creating the per-build
        # database (see the note at the top) is it. With no reachable postgres
        # the script throws, so "the tests passed" cannot be told apart from
        # "nothing touched a database". The DSN carries a password and is only
        # ever captured, never echoed. The drop runs on every exit, so a red
        # migrate or test does not leave a database behind.
        DATABASE_URL="$(pnpm --filter @grundtone-studio/studio exec tsx server/db/ci-db.ts create)"
        export DATABASE_URL
        trap 'pnpm --filter @grundtone-studio/studio exec tsx server/db/ci-db.ts drop' EXIT
        pnpm --filter @grundtone-studio/studio db:migrate
        pnpm test
      ''',
    ],

    // ─── Lint & Typecheck ───────────────────────────────────────────────────
    [
      // The five static checks Actions' ci.yml ran as ESLint, Prettier,
      // Stylelint, TypeScript and i18n parity. ci.yml has been
      // disabled_manually since 2026-09-15, and since then NO check ran any of
      // them: `turbo run lint` sat red on main for days in September without
      // anything turning red (869fbfz99), and prettier was red on main again
      // when this was measured (3 files, fixed in the same PR).
      //
      // ONE check, not five: every check runs `pnpm install` in the one shared
      // workspace, and whether the library runs checks concurrently is not
      // measured — five installs racing in one node_modules is a risk this
      // does not need to take. Each step echoes its name, so a red run says
      // which of the five failed.
      //
      // No token, no services: plain public dependencies (vendored @klanghaus
      // packages, KH-944) and no database. Runs on PRs and main.
      context: 'Lint & Typecheck',
      cmd: '''
        set -euo pipefail
        export TURBO_TELEMETRY_DISABLED=1
        pnpm install --frozen-lockfile

        echo '── ESLint'
        pnpm turbo run lint
        echo '── Stylelint'
        pnpm stylelint
        echo '── TypeScript'
        pnpm typecheck
        echo '── i18n parity'
        node scripts/check-i18n-parity.mjs
        echo '── Prettier'
        pnpm format:check

        # 🔴 Nothing above may rewrite a tracked file. turbo did exactly that to
        # AGENTS.md when it detected an agent (agentGuidance, now off in
        # turbo.json); a tool that edits the tree makes the format check judge
        # a file nobody committed. A dirty tree here is red, with the diff.
        echo '── tree unchanged'
        git diff --exit-code --stat
      ''',
    ],

    // ─── vendored @klanghaus packages upstream ──────────────────────────────
    [
      // Do auth's packages/jwt and platform's packages/permissions-client on
      // main still hold the bytes studio vendored? (The LOCAL half — copy vs
      // manifest — runs in the test suite.) auth-jwt/src/verify.ts is the token
      // verifier, so studio carries a copy of a security control and must hear
      // when the original changes ([sikkerhed], #354 verdict). Same check as
      // auth#183. Needs to read the private source repos, so the App token; the
      // library binds it only on `defaultBranch`, hence main pushes only.
      // The token reaches ONLY this cmd: plain node, no install, no dependency
      // code. The script's positive control is each manifest's own
      // sourceCommit: a 404 there is "cannot see the source repo" (exit 2),
      // never drift. Exit 1 = drift: take the upstream change into
      // server/vendor or say why not.
      // Not a required context. UNMEASURED: that the App's installation can
      // read KlangHaus/auth and KlangHaus/platform — a 404 at a pin would show
      // it, as exit 2.
      context: 'vendored @klanghaus upstream',
      githubToken: true,
      cmd: 'set -euo pipefail\nnode apps/studio/scripts/vendor-drift.mjs --upstream main',
      when: { ctx -> !ctx.isPR },
    ],
  ],
)
