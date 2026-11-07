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
//   tsx server/db/ci-db.ts create --out <file>
//                                   -> writes the per-build DATABASE_URL to
//                                      <file> (mode 0600) and nothing to stdout
//   tsx server/db/ci-db.ts drop     -> drops it again (idempotent)
//
// 🔴 The DSN goes to a FILE, not to stdout. It carries ci_build's password, and
// the caller used to capture `$(pnpm … ci-db.ts create)`, i.e. ALL of pnpm's
// stdout: one extra line (pnpm 10.14.0 printed "WARN Unsupported engine" there
// on node 24.18.0) became part of DATABASE_URL, migrate threw "Invalid URL" and
// printed the whole input, password included ([sikkerhed], #347). A file is
// not polluted by whatever else writes to stdout. scripts/ci-test-db.sh is the
// caller and checks the URL's shape without printing it.
//
// The name derives from BUILD_TAG, so a retry reclaims its own leftovers
// instead of orphaning a new database. `create` drops first for that reason.
// Creating the database IS the positive control of the check: with no
// reachable postgres it throws, and the check cannot pass on no database.
import { writeFileSync } from 'node:fs'
import postgres from 'postgres'
import { ciDbName } from './ci-db-name'

const action = process.argv[2]
const outIndex = process.argv.indexOf('--out')
const outFile = outIndex > 0 ? process.argv[outIndex + 1] : undefined
if ((action !== 'create' && action !== 'drop') || (action === 'create' && !outFile)) {
  console.error('usage: tsx server/db/ci-db.ts create --out <file> | drop')
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
// "database ... does not exist, skipping" NOTICE on stdout. Diagnostics belong
// on stderr; stdout stays empty.
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
    // `mode` applies when the file is created; the caller makes it under
    // `umask 077` too, so it is never readable by others in between.
    writeFileSync(outFile!, url.toString(), { mode: 0o600 })
  }
  console.error(`${action}: ${dbName}`)
} finally {
  await sql.end()
}
