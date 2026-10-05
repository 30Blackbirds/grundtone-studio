import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3 } from '~~/tests/helpers/endpoint-fixtures'

// Cells for the write half of KH-964 AC-A3. The read half — that the NEXT
// request is refused — is measured in server/lib/provisioning-auth.test.ts,
// because a soft-revoke on its own proves nothing about authentication.

vi.mock('h3', () => mockH3())
vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => ({ op: 'and', a }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  isNull: (col: unknown) => ({ op: 'isNull', col }),
}))

let orgRole: string | null = 'owner'
vi.mock('~~/server/lib/project-access', () => {
  const ORG_ROLES = ['billing', 'member', 'admin', 'manager', 'owner'] as const
  return {
    ORG_ROLES,
    orgRoleHelpers: {
      canCreateProjects: (r: string) => r === 'owner' || r === 'manager' || r === 'admin',
    },
    requireOrgRole: (_e: unknown, organizationId: string, min: string) => {
      if (!orgRole || ORG_ROLES.indexOf(orgRole as never) < ORG_ROLES.indexOf(min as never)) {
        throw Object.assign(new Error(`Requires org:${min}`), { statusCode: 403 })
      }
      return Promise.resolve({ userId: 'u-1', organizationId, role: orgRole })
    },
  }
})

let updatedRows: Record<string, unknown>[] = []
let lastWhere: unknown = null
vi.mock('~~/server/db', () => ({
  db: {
    update: () => ({
      set: () => ({
        where: (w: unknown) => {
          lastWhere = w
          return { returning: () => Promise.resolve(updatedRows) }
        },
      }),
    }),
  },
}))
vi.mock('~~/server/db/schema', () => ({
  apiKey: {
    id: 'id',
    keyPrefix: 'keyPrefix',
    keyType: 'keyType',
    organizationId: 'organizationId',
    revokedAt: 'revokedAt',
  },
}))

const audits: Record<string, unknown>[] = []
vi.mock('~~/server/lib/audit', () => ({
  recordAuditEvent: (_e: unknown, entry: Record<string, unknown>) => {
    audits.push(entry)
    return Promise.resolve()
  },
}))

const handler = (await import('./[keyId].delete')).default as unknown as (
  e: ReturnType<typeof fakeEvent>,
) => Promise<Record<string, unknown>>

const call = () => handler(fakeEvent({ params: { orgId: 'org-1', keyId: 'k-1' } }) as never)

function conditions(): string[] {
  const out: string[] = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, unknown>
    if (o.op === 'and') (o.a as unknown[]).forEach(walk)
    else if (o.op === 'eq') out.push(`eq:${String(o.col)}`)
    else if (o.op === 'isNull') out.push(`isNull:${String(o.col)}`)
  }
  walk(lastWhere)
  return out
}

beforeEach(() => {
  orgRole = 'owner'
  audits.length = 0
  lastWhere = null
  updatedRows = [
    { id: 'k-1', keyPrefix: 'prov_live_ab', keyType: 'provisioning', revokedAt: new Date(0) },
  ]
})

describe('who may revoke', () => {
  it.each(['owner', 'manager', 'admin'])('%s can revoke', async (role) => {
    orgRole = role
    await expect(call()).resolves.toMatchObject({ id: 'k-1' })
  })

  it.each(['member', 'billing'])('%s is refused, and nothing is written', async (role) => {
    orgRole = role
    await expect(call()).rejects.toMatchObject({ statusCode: 403 })
    expect(lastWhere).toBeNull()
    expect(audits).toEqual([])
  })
})

describe('🔴 what the update is narrowed to', () => {
  it('scopes by organizationId, so another tenant key cannot be revoked across the boundary', async () => {
    await call()
    expect(conditions()).toContain('eq:organizationId')
  })

  it('narrows on keyType, so a pk_/sk_ key cannot be revoked outside its own gate', async () => {
    await call()
    expect(conditions()).toContain('eq:keyType')
  })

  it('narrows on isNull(revokedAt), so the FIRST revocation time survives', async () => {
    // Re-stamping would overwrite the audit trail's answer to "when was this
    // key revoked?" with the time someone pressed the button again.
    await call()
    expect(conditions()).toContain('isNull:revokedAt')
  })
})

describe('outcome', () => {
  it('404s when nothing matched — unknown id, other org, wrong type or already revoked', async () => {
    updatedRows = []
    await expect(call()).rejects.toMatchObject({ statusCode: 404 })
    expect(audits).toEqual([])
  })

  it('writes an audit event naming the org and the key', async () => {
    await call()
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      organizationId: 'org-1',
      action: 'provisioning_key.revoked',
      targetId: 'k-1',
    })
  })
})
