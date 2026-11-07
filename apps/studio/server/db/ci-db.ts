// Per-build test database on the shared CI postgres.
//
// Jenkins hands every agent ONE DSN, KH_TEST_PG_DSN (infra compose/prod/ci,
// jenkins.yaml) as the role `ci_build` (NOSUPERUSER NOCREATEROLE CREATEDB), and the
// contract is that each build makes its own database and drops it again — two
// concurrent builds of this repo would otherwise migrate into the same schema.
// This lives in repo code rather than in the Jenkinsfile for the same reason
// resonans does it in Go: the Jenkinsfile must not grow, the agents have no
// docker and no psql, and a code path runs the same on a laptop.
//
//   tsx server/db/ci-db.ts create   -> prints the per-build DATABASE_URL on
//                                      stdout (nothing else goes to stdout)
//   tsx server/db/ci-db.ts drop     -> drops it again (idempotent)
//
// The name derives from BUILD_TAG, so a retry reclaims its own leftovers
// instead of orphaning a new database. `create` drops first for that reason.
// Creating the database IS the positive control of the check: with no
// reachable postgres it throws, and the check cannot pass on no database.
import postgres from 'postgres'
import { ciDbName } from './ci-db-name'

const action = process.argv[2]
if (action !== 'create' && action !== 'drop') {
  console.error('usage: tsx server/db/ci-db.ts <create|drop>')
  process.exit(2)
}

const adminDsn = process.env.KH_TEST_PG_DSN
if (!adminDsn) {
  console.error(
    'KH_TEST_PG_DSN is not set — this script needs the CI postgres (infra compose/prod/ci)',
  )
  process.exit(1)
}

const tag = process.env.BUILD_TAG ?? `local-${process.env.USER ?? 'dev'}`
// A postgres identifier with a hash of the raw tag, so two builds never share
// (and FORCE-drop) one database. See ci-db-name.ts.
const dbName = ciDbName(tag)

// The `postgres` client validates the identifier when it is passed as a
// value, so the name is never interpolated as raw SQL.
// `onnotice`: the client's default is console.log, which put the server's
// "database ... does not exist, skipping" NOTICE on stdout — and stdout is the
// DSN the caller captures. Notices are still worth seeing, so they go to stderr.
const sql = postgres(adminDsn, {
  max: 1,
  prepare: false,
  onnotice: (n) => console.error(`notice: ${n.message}`),
})

try {
  // FORCE terminates leftover sessions from a retried build (postgres >= 13).
  await sql`DROP DATABASE IF EXISTS ${sql(dbName)} WITH (FORCE)`
  if (action === 'create') {
    await sql`CREATE DATABASE ${sql(dbName)}`
    const url = new URL(adminDsn)
    url.pathname = `/${dbName}`
    process.stdout.write(url.toString())
  }
  console.error(`${action}: ${dbName}`)
} finally {
  await sql.end()
}
