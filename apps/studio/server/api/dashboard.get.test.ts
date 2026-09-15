import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3 } from '~~/tests/helpers/endpoint-fixtures'

// dashboard.get.ts relies on Nuxt auto-imports for these two.
vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
vi.stubGlobal('createError', mockH3().createError)

vi.mock('h3', () => mockH3())

// Predicate builders return STRUCTURE, so the test can read which filters the
// activity query actually carries.
vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ op: 'and', parts: parts.filter(Boolean) }),
  desc: (col: unknown) => ({ op: 'desc', col }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  inArray: (col: unknown, vals: unknown) => ({ op: 'inArray', col, vals }),
  notInArray: (col: unknown, vals: unknown) => ({ op: 'notInArray', col, vals }),
}))

const tables = {
  project: { _name: 'project', id: 'project.id', organizationId: 'project.organization_id' },
  activeVersion: {
    _name: 'active_version',
    projectId: 'av.project_id',
    configVersionId: 'av.cv_id',
  },
  configVersion: {
    _name: 'config_version',
    id: 'cv.id',
    projectId: 'cv.project_id',
    status: 'cv.status',
  },
  auditLog: { _name: 'audit_log', organizationId: 'audit.organization_id', action: 'audit.action' },
}
vi.mock('~~/server/db/schema', () => tables)

const queries: Array<{ table: string; where: unknown; limit?: number }> = []
vi.mock('~~/server/db', () => {
  const select = () => ({
    from: (table: { _name: string }) => {
      const q: { table: string; where: unknown; limit?: number } = {
        table: table._name,
        where: null,
      }
      queries.push(q)
      const rows: unknown[] = []
      const builder = {
        innerJoin: () => builder,
        where: (pred: unknown) => {
          q.where = pred
          return {
            orderBy: () => ({
              limit: (n: number) => {
                q.limit = n
                return Promise.resolve(rows)
              },
            }),
            then: (resolve: (r: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
          }
        },
      }
      return builder
    },
  })
  return { db: { select } }
})

const orgRole = { value: 'owner' }
vi.mock('~~/server/lib/org-lookup', () => ({
  listCallerOrgs: () => Promise.resolve([{ id: 'org-1', slug: 'acme', name: 'Acme' }]),
  lookupOrgById: () => Promise.resolve({ members: [{ userId: 'user-1', role: orgRole.value }] }),
}))

const route = await import('./dashboard.get')
const handler = route.default as unknown as (event: unknown) => Promise<{ activity: unknown[] }>
const { AUDIT_ACTIONS } = await import('~~/server/lib/audit')

function find(node: unknown, op: string): { col: unknown; vals: unknown } | null {
  if (!node || typeof node !== 'object') return null
  const n = node as { op?: string; parts?: unknown[]; col?: unknown; vals?: unknown }
  if (n.op === op) return { col: n.col, vals: n.vals }
  for (const p of n.parts ?? []) {
    const hit = find(p, op)
    if (hit) return hit
  }
  return null
}

const event = () => fakeEvent({ context: { auth: { sub: 'user-1', tenant: 'org-1' } } } as never)

beforeEach(() => {
  queries.length = 0
  orgRole.value = 'owner'
})

describe('GET /api/dashboard — activity feed', () => {
  it('keeps draft saves out of the activity query itself, before the 8-row limit', async () => {
    await handler(event())

    const activity = queries.find((q) => q.table === 'audit_log')
    expect(activity).toBeDefined()
    expect(activity!.limit).toBe(8)
    expect(find(activity!.where, 'inArray')).toEqual({
      col: tables.auditLog.organizationId,
      vals: ['org-1'],
    })
    expect(find(activity!.where, 'notInArray')).toEqual({
      col: tables.auditLog.action,
      vals: ['config.draft_saved', 'asset.font_uploaded', 'asset.logo_uploaded'],
    })
  })

  it('only excludes actions that exist in the audit action list', () => {
    expect(route.FEED_EXCLUDED_ACTIONS.length).toBeGreaterThan(0)
    for (const action of route.FEED_EXCLUDED_ACTIONS) expect(AUDIT_ACTIONS).toContain(action)
  })

  it('does not query the audit log at all for a plain member (control)', async () => {
    orgRole.value = 'member'
    const res = await handler(event())

    expect(queries.some((q) => q.table === 'audit_log')).toBe(false)
    expect(res.activity).toEqual([])
  })
})
