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
// ⛔ ONLY `Test` IS PORTED. The other 13 required contexts stay on Actions
//    until each has been measured on its own. A thin start is not a partial
//    port: it is one name at a time, where disagreements can be attributed.
//
// 🔴 `jenkins/Test` IS NOT EXPECTED TO BE GREEN YET — DO NOT FLIP ON IT.
//    Measured 2026-09-14: jenkins-library `6fb3c0a` `klanghausServices.declare()`
//    only sets `KH_SVC_POSTGRES17_HOST=localhost` plus the catalog port and
//    echoes that the service is declared; it STARTS nothing. infra `4d54fa8`
//    has 0 occurrences of `postgres17`. The mechanism that would start the
//    sidecar does not exist yet (riff mt07g5mckqfv4tubau7mym3v). Until it
//    does, the TCP control in `cmd` is meant to fail this check loudly.
//
// ⚠️ A DECLARED DIFFERENCE, so a disagreement during the parallel week is not
//    attributed to the port: Actions runs postgres with `grundtone/grundtone_ci`
//    and the database `grundtone_studio`. The library's catalog is a CLOSED
//    set — a repo declares a KEY, never an image or its `env` — so here it is
//    `postgres/postgres` against the default database. Schema and tests are
//    the same; only user name and database name differ. Should a test one day
//    depend on the database NAME, this is where the disagreement comes from.
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
    // `2>/dev/null | tail -1`: pnpm warns on stderr about the unset
    // ${NODE_AUTH_TOKEN} in `.npmrc`, which would hide the version line.
    'pnpm': [exact: '10.14.0', cmd: 'pnpm --version 2>/dev/null | tail -1'],
  ],

  pnpmCache: true,

  checks: [
    [
      // The exact required name. See the note on the prefix above.
      context: 'Test',

      // 🔴 The token is SCOPED to this check, not ambient. studio's .npmrc
      // points the @klanghaus scope at npm.pkg.github.com via ${NODE_AUTH_TOKEN};
      // without the binding `pnpm install` gets 401 on @klanghaus/permissions-client.
      npmAuth: true,

      // The library only DECLARES this key: it sets KH_SVC_POSTGRES17_HOST/PORT
      // and starts nothing. Starting the sidecar is [infra]'s controller-side
      // mechanism, which does not exist yet (see the note at the top). The key
      // is digest-pinned in the catalog and corresponds to the
      // `postgres:17-alpine` that Actions runs.
      services: ['postgres17'],

      cmd: '''
        set -euo pipefail

        # 🔴 POSITIVE CONTROL BEFORE THE MEASUREMENT. Without it, "the tests
        # passed" cannot be told apart from "no sidecar was ever started and
        # nothing touched a database".
        # The two `:?` lines prove only that the key was DECLARED: the library
        # sets both variables whether or not anything runs, so they cannot
        # fail once `services:` names the key. The TCP loop is the actual
        # control, and it has a limit too: it proves that SOMETHING accepts
        # connections on that host:port, not that it is the catalog's
        # postgres17. `db:migrate` with the catalog credentials is the
        # stronger signal that follows.
        : "${KH_SVC_POSTGRES17_HOST:?sidecaren postgres17 er ikke deklareret}"
        : "${KH_SVC_POSTGRES17_PORT:?sidecaren postgres17 mangler port}"
        for i in $(seq 1 30); do
          if (exec 3<>"/dev/tcp/${KH_SVC_POSTGRES17_HOST}/${KH_SVC_POSTGRES17_PORT}") 2>/dev/null; then
            exec 3<&- 2>/dev/null || true
            break
          fi
          [ "$i" = 30 ] && { echo "🔴 postgres17 svarer ikke paa ${KH_SVC_POSTGRES17_HOST}:${KH_SVC_POSTGRES17_PORT} efter 30 forsoeg"; exit 1; }
          sleep 1
        done
        echo "postgres17 naaet paa ${KH_SVC_POSTGRES17_HOST}:${KH_SVC_POSTGRES17_PORT}"

        # See the declared difference at the top: the catalog's credentials are fixed.
        export DATABASE_URL="postgresql://postgres:postgres@${KH_SVC_POSTGRES17_HOST}:${KH_SVC_POSTGRES17_PORT}/postgres"

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
        pnpm --filter @grundtone-studio/studio db:migrate
        pnpm test
      ''',
    ],
  ],
)
