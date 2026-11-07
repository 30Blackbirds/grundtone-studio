import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// scripts/ci-test-db.sh, the Jenkins Test check's per-build database. The DSN
// carries ci_build's password: it must reach DATABASE_URL intact and the log
// never. A fake `pnpm` first prints a stray line on stdout, as pnpm 10.14.0 did
// on node 24.18.0 ("WARN Unsupported engine"), then plays ci-db.ts.

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..')
const script = join(root, 'scripts/ci-test-db.sh')
const PASSWORD = 'pw-must-not-leak-5f3c'
const DSN = `postgresql://ci_build:${PASSWORD}@ci-postgres:5432/studio_jenkins_pr_347_4_7d078da2ef77`
const WARN = 'WARN Unsupported engine: wanted: {"node":">=24.18.1"} (current: {"node":"v24.18.0"})'

// `--out <file>`: write FAKE_CONTENT there (ci-db.ts today). No `--out`: print
// FAKE_CONTENT on stdout (ci-db.ts before this change). Either way the stray
// line comes first, on stdout.
const FAKE_PNPM = `#!/usr/bin/env bash
echo '${WARN}'
out=''
while [ $# -gt 0 ]; do
  if [ "$1" = --out ]; then out="$2"; shift; fi
  shift
done
if [ -n "$out" ]; then printf '%s' "$FAKE_CONTENT" > "$out"; else printf '%s' "$FAKE_CONTENT"; fi
`

let dir: string
let dsnFile: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ci-test-db-'))
  writeFileSync(join(dir, 'pnpm'), FAKE_PNPM)
  chmodSync(join(dir, 'pnpm'), 0o755)
  dsnFile = join(dir, 'dsn')
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

const run = (cmd: string[], content: string) => {
  const res = spawnSync('bash', cmd, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FAKE_CONTENT: content },
  })
  return { status: res.status, stdout: res.stdout, log: res.stdout + res.stderr }
}

describe('scripts/ci-test-db.sh create', () => {
  it('🔴 a stray stdout line neither corrupts the DSN nor puts it in the log', () => {
    const r = run([script, 'create', dsnFile], DSN)
    expect(r.status).toBe(0)
    expect(readFileSync(dsnFile, 'utf8')).toBe(DSN)
    expect(r.stdout).toBe('')
    expect(r.log).toContain(WARN) // still visible, on stderr
    expect(r.log).not.toContain(PASSWORD)
  })

  it('the DSN file is readable by its owner only', () => {
    run([script, 'create', dsnFile], DSN)
    expect(statSync(dsnFile).mode & 0o777).toBe(0o600)
  })

  it.each([
    ['two lines', `${WARN}\n${DSN}`],
    ['no studio_ database', `postgresql://ci_build:${PASSWORD}@ci-postgres:5432/postgres`],
    ['not a postgres URL', `mysql://ci_build:${PASSWORD}@ci-postgres:5432/studio_x`],
  ])('🔴 a malformed DSN (%s) fails without printing it', (_, content) => {
    const r = run([script, 'create', dsnFile], content)
    expect(r.status).toBe(1)
    expect(r.log).toContain('does not hold a postgres URL')
    expect(r.log).not.toContain(PASSWORD)
  })
})

describe('negative control: the old capture', () => {
  it('`$(pnpm … create)` takes the stray line into DATABASE_URL', () => {
    const old =
      'DATABASE_URL="$(pnpm --filter @grundtone-studio/studio exec tsx server/db/ci-db.ts create)"; ' +
      'printf %s "$DATABASE_URL"'
    const r = run(['-c', old], DSN)
    expect(r.stdout).not.toBe(DSN)
    expect(r.stdout.startsWith(WARN)).toBe(true)
  })
})
