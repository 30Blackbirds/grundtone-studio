import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createSpies,
  fakeEvent,
  mockH3,
  PROJECT,
  ORG,
  SESSION,
} from '~~/tests/helpers/endpoint-fixtures'

// One cell, its own file, because it needs the dtcg package to THROW — which
// the module mock below can only do for a whole file.
//
// 🔴 Why it exists: the endpoint wraps importTokens in a try/catch that turns
// anything unforeseen into a 400. Measured on the other cells, that catch was
// armed against nothing — every document they drive returns a report instead of
// throwing, so removing the catch would not have turned a single cell red. A
// guard no cell fires is a guard nobody knows works.

const spies = createSpies()

vi.mock('h3', () => mockH3())
vi.mock('drizzle-orm', () => ({
  and: () => null,
  desc: () => null,
  eq: () => null,
  max: () => null,
}))
vi.mock('@grundtone-studio/dtcg', () => ({
  // The endpoint checks the parser's bounds first; this file is about the
  // mapper throwing, so the bound lets every document through.
  checkBounds: () => null,
  importTokens: () => {
    throw new RangeError('Maximum call stack size exceeded')
  },
}))
vi.mock('~~/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }) }),
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => {
        spies.updates.push({ table: 'config_version', set: s })
        return { where: () => ({ returning: () => Promise.resolve([{}]) }) }
      },
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        spies.inserts.push({ table: 'config_version', values: v })
        return { returning: () => Promise.resolve([{ id: 'x', ...v }]) }
      },
    }),
  },
}))
vi.mock('~~/server/db/schema', () => ({ configVersion: { _: { name: 'config_version' } } }))

const auditEvents: unknown[] = []
vi.mock('~~/server/lib/audit', () => ({
  recordAuditEvent: (_e: unknown, payload: unknown) => {
    auditEvents.push(payload)
    return Promise.resolve()
  },
}))
vi.mock('~~/server/lib/project-access', () => ({
  requireProjectAccess: () =>
    Promise.resolve({
      userId: SESSION.user.id,
      project: PROJECT,
      organization: ORG,
      role: 'editor',
      source: 'org',
      orgRole: 'owner',
      projectRole: null,
    }),
}))

const handler = (await import('./import.post')).default as unknown as (
  event: unknown,
) => Promise<unknown>

beforeEach(() => {
  spies.inserts.length = 0
  spies.updates.length = 0
  auditEvents.length = 0
})

describe('when the mapper throws', () => {
  it('answers 400 naming the file, never a 500, and writes nothing', async () => {
    const error = (await handler(
      fakeEvent({ params: { projectId: PROJECT.id }, body: { base: { color: {} } } }),
    ).then(
      () => null,
      (e: unknown) => e,
    )) as { statusCode?: number; statusMessage?: string } | null

    expect(error).not.toBeNull()
    expect(error!.statusCode).toBe(400)
    expect(error!.statusMessage).toContain('could not be read')
    expect(spies.inserts).toHaveLength(0)
    expect(spies.updates).toHaveLength(0)
    expect(auditEvents).toHaveLength(0)
  })

  it('a dry run is refused the same way: a throw is never a silent empty report', async () => {
    const error = (await handler(
      fakeEvent({ params: { projectId: PROJECT.id }, body: { base: { color: {} }, dryRun: true } }),
    ).then(
      () => null,
      (e: unknown) => e,
    )) as { statusCode?: number } | null
    expect(error!.statusCode).toBe(400)
  })
})
