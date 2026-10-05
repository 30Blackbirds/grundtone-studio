import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fakeEvent, mockH3, ORG, PROJECT } from '~~/tests/helpers/endpoint-fixtures'

// AC-D2's negative controls: a provisioning key must be refused member
// management and key administration — the `project.admin` operations.
//
// 🔴 WHY THESE CELLS LIVE AT THE GATE AND NOT ON SIX ENDPOINTS. The guarantee
// is a property of `requireProjectAccess` plus the grant the key actually
// holds (editor, never admin — AC-D4). Driving six handlers would measure six
// harnesses and still not say that the SET is complete, so the coverage is
// asserted separately, by reading the sources. Each half says what it cannot
// see.
//
// 🔴 AC-D3 IS NOT HERE, AND NOT BECAUSE IT PASSED. Its text does not exist
// anywhere on disk — the riff it lived in is gone (taktart stopped
// 2026-09-30), and the only trace is a summary line of my own saying
// "AC-D2/D3 negative controls". Reconstructing it from memory would produce a
// criterion nobody wrote. It stays UNMEASURED with the reason named.

vi.mock('h3', () => mockH3())
vi.stubGlobal('createError', mockH3().createError)
vi.mock('drizzle-orm', () => ({ eq: (c: unknown, v: unknown) => ({ op: 'eq', c, v }) }))
vi.mock('~~/server/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => Promise.resolve([PROJECT]) }) }) },
}))
vi.mock('~~/server/db/schema', () => ({ project: { id: 'id' } }))
vi.mock('~~/server/lib/org-lookup', () => ({
  lookupOrgById: () => Promise.resolve(ORG),
}))

// The PDP answers as OpenFGA would for a principal holding `editor` on this
// project and nothing above it. This is the whole point of the fixture: the key
// is NOT powerless — it can view and edit — so a refusal at `can_admin` is a
// statement about the bar, not about a principal that can do nothing.
const asked: string[] = []
vi.mock('~~/server/lib/pdp', () => ({
  checkProject: (_e: unknown, _p: string, action: string) => {
    asked.push(action)
    return Promise.resolve(action === 'can_admin' ? 'denied' : 'allowed')
  },
  checkOrg: () => Promise.resolve('denied'),
}))

const { requireProjectAccess } = await import('./project-access')

const MACHINE = { sub: 'machine:key-1', tenant: ORG.id }
const call = (min: 'viewer' | 'editor' | 'admin') =>
  requireProjectAccess(
    fakeEvent({ params: { projectId: PROJECT.id }, context: { auth: MACHINE } }) as never,
    PROJECT.id,
    min,
  )

beforeEach(() => {
  asked.length = 0
})

describe('🔴 AC-D2: a provisioning key is refused project.admin', () => {
  it('refuses at admin with 403 — the PDP said no, not "no identity"', async () => {
    // 🔴 THE CODE IS THE MEASUREMENT. requireProjectAccess answers 401 when
    // context.auth is MISSING and 403 when the PDP refuses. A cell that
    // accepted either would pass just as happily on a principal that was never
    // authenticated at all, which is a different and much weaker guarantee —
    // and it is the shape this exact gate produced while the provisioning
    // middleware was not wired in.
    await expect(call('admin')).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Requires project:admin',
    })
    expect(asked).toEqual(['can_admin'])
  })

  it('🔴 POSITIVE CONTROL: the same principal IS allowed at editor', async () => {
    // Without this, every cell above is satisfied by a key that can do nothing
    // whatsoever, and "least privilege" would be indistinguishable from "no
    // privilege". The key must be able to write tokens; that is what it is for.
    await expect(call('editor')).resolves.toMatchObject({ userId: 'machine:key-1' })
  })

  it('and at viewer', async () => {
    await expect(call('viewer')).resolves.toMatchObject({ userId: 'machine:key-1' })
  })
})

describe('🔴 AC-D2 coverage: every admin operation actually asks for admin', () => {
  // The gate cells above prove the MECHANISM. This one proves the SET — that
  // the member-management and key-administration endpoints route through that
  // bar rather than a lower one.
  //
  // 🔴 WHAT THIS CELL CANNOT SEE, because it reads sources: an endpoint added
  // later under a name this list does not match; an endpoint that gates with
  // something other than requireProjectAccess; and anything outside
  // server/api. It therefore also asserts the DENOMINATOR, so a pattern that
  // silently stops matching turns red instead of reporting a clean sweep.
  const API = join(import.meta.dirname, '..', 'api')

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((e) => {
      const p = join(dir, e)
      if (statSync(p).isDirectory()) return walk(p)
      return e.endsWith('.ts') && !e.endsWith('.test.ts') ? [p] : []
    })
  }

  const ADMIN_OPS = /(members|invitations|api-keys)[./]/

  it('finds the admin-operation endpoints at all (denominator)', () => {
    const hits = walk(API).filter((p) => ADMIN_OPS.test(p.replace(API, '')))
    // Measured on 2026-10-03: 12 files match. A drop means the pattern stopped
    // seeing them; a rise means new ones to classify. Either way, look.
    expect(hits.length).toBeGreaterThanOrEqual(12)
  })

  it("every WRITE under those names requires 'admin'", () => {
    const offenders: string[] = []
    for (const p of walk(API)) {
      const rel = p.replace(API, '')
      if (!ADMIN_OPS.test(rel)) continue
      const src = readFileSync(p, 'utf8')
      if (!src.includes('requireProjectAccess')) continue
      // A read gated at viewer is deliberate and out of AC-D2's scope as
      // recorded; see the member-list cell below, which measures it rather
      // than assuming it.
      if (/\.get\.ts$/.test(rel)) continue
      if (!/requireProjectAccess\([^)]*'admin'/s.test(src)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })
})

describe('🔴 OUTSIDE AC-D2 AS RECORDED: the member list is readable by a machine', () => {
  // Not a violation of AC-D2 — that criterion names member MANAGEMENT and key
  // administration, the `project.admin` operations, and this is a read. It is
  // recorded here because the exposure is real, nobody has decided on it, and
  // the alternative to writing it down is silence.
  //
  // The chain is measured, not inferred:
  //   1. members.get calls requireProjectAccess(event, projectId) with no
  //      minimum, so the bar is the signature default, 'viewer'.
  //   2. a machine principal passes at viewer — the cell above, and mutation
  //      A (PDP allows can_admin) proves that cell can fail.
  //   3. the handler returns { orgMembers, direct, pending } with no redaction
  //      and never mentions `machine`.
  // So a provisioning key holding editor can read every member's name and
  // email, and the pending invitations, for any project in its own org.
  //
  // This cell is a TRIPWIRE, not an endorsement: if someone raises that gate,
  // it turns red and brings them here to read why rather than letting the
  // finding disappear into a passing suite.
  const SRC = join(import.meta.dirname, '..', 'api', 'projects', '[projectId]', 'members.get.ts')

  it('still gates at the viewer default, and still redacts nothing', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain('requireProjectAccess(event, projectId)')
    expect(src).not.toMatch(/requireProjectAccess\([^)]*'(editor|admin)'/)
    // If this stops being true, the exposure above may be cured — re-measure
    // the chain instead of deleting the cell.
    expect(src).not.toContain('machine')
  })
})
