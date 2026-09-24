import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

/**
 * End-to-end cells for `grundtone-tokens import`: they run the REAL command as
 * a process against a stub Studio and read exit code, stdout and the request
 * body. The report shape and the exit decision are tested in-process in
 * import.test.ts; what these cover is the part a module test cannot see — that
 * the wiring in cli.ts actually applies the exit code and actually sends what
 * the flags say.
 */

const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url))
const run = promisify(execFile)
const cleanups: (() => void)[] = []

interface Seen {
  url?: string
  auth?: string
  body?: Record<string, unknown>
}

async function studio(response: unknown, status = 200): Promise<{ base: string; seen: Seen }> {
  const seen: Seen = {}
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => {
      seen.url = req.url
      seen.auth = req.headers.authorization
      seen.body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(response))
    })
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  const port = (server.address() as { port: number }).port
  cleanups.push(() => server.close())
  return { base: `http://127.0.0.1:${port}`, seen }
}

function files(base: unknown, dark?: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'tokens-cli-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, 'base.json'), JSON.stringify(base))
  if (dark !== undefined) writeFileSync(join(dir, 'dark.json'), JSON.stringify(dark))
  return { dir, base: join(dir, 'base.json'), dark: join(dir, 'dark.json') }
}

async function cli(apiBase: string, args: string[]) {
  try {
    const { stdout, stderr } = await run('npx', ['tsx', CLI, ...args], {
      env: {
        ...process.env,
        GRUNDTONE_API_BASE: apiBase,
        GRUNDTONE_TOKEN_KEY: 'sk_test',
      },
    })
    return { code: 0, stdout, stderr }
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string }
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

const report = (over: Record<string, unknown> = {}) => ({
  total: 1,
  mapped: [],
  converted: [],
  notMapped: [],
  invalid: [],
  notMappedByPrefix: {},
  droppedExtensions: {},
  parseErrors: [],
  overwritten: 0,
  ...over,
})

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

describe('grundtone-tokens import (as a process)', () => {
  it('sends the parsed files and the key, and exits 0 on a clean write', async () => {
    const { base, seen } = await studio({ report: report(), version: 4, saved: true })
    const f = files({ color: { primary: { $type: 'color', $value: '#000' } } }, { x: 1 })

    const { code, stdout } = await cli(base, ['import', 'p1', '--file', f.base, '--dark', f.dark])

    expect(code).toBe(0)
    expect(seen.url).toBe('/api/projects/p1/tokens/import')
    expect(seen.auth).toBe('Bearer sk_test')
    expect(seen.body).toEqual({
      base: { color: { primary: { $type: 'color', $value: '#000' } } },
      dark: { x: 1 },
      dryRun: false,
    })
    expect(stdout).toContain('✓ saved draft version 4')
  }, 30_000)

  it('🔴 exits non-zero on a WRITE that refused tokens — and still prints why', async () => {
    const { base } = await studio({
      report: report({
        invalid: [{ code: 'neg', path: 'spacing.neg', value: '-4px', reason: 'no negatives' }],
      }),
      version: 5,
      saved: true,
    })
    const f = files({ spacing: {} })

    const { code, stdout } = await cli(base, ['import', 'p1', '--file', f.base])

    expect(code).toBe(2)
    expect(stdout).toContain('spacing.neg')
    expect(stdout).toContain('no negatives')
    // The write happened; the code says the file was lossy, not that nothing
    // was saved.
    expect(stdout).toContain('✓ saved draft version 5')
  }, 30_000)

  it('exits 0 on the same report under --dry-run, and sends dryRun=true', async () => {
    const { base, seen } = await studio({
      report: report({
        invalid: [{ code: 'neg', path: 'spacing.neg', value: '-4px', reason: 'no negatives' }],
      }),
      saved: false,
    })
    const f = files({ spacing: {} })

    const { code, stdout } = await cli(base, ['import', 'p1', '--file', f.base, '--dry-run'])

    expect(code).toBe(0)
    expect(seen.body?.dryRun).toBe(true)
    expect(seen.body).not.toHaveProperty('dark')
    expect(stdout).toContain('nothing written')
  }, 30_000)

  it('fails before any request when a file is not JSON, naming the file', async () => {
    const { base, seen } = await studio({ report: report(), saved: false })
    const f = files({ ok: true })
    writeFileSync(f.dark, '{not json')

    const { code, stderr } = await cli(base, [
      'import',
      'p1',
      '--file',
      f.base,
      '--dark',
      f.dark,
      '--dry-run',
    ])

    expect(code).toBe(1)
    expect(stderr).toContain('dark file')
    expect(seen.url).toBeUndefined()
  }, 30_000)
})
