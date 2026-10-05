import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3, PROJECT, ORG } from '~~/tests/helpers/endpoint-fixtures'

// First cells for this endpoint — it had none (869fbuf68). The audit event was
// therefore unproven: removing the recordAuditEvent call shipped green, which
// is exactly what a mutation demonstrated on publish.post.

const h3 = mockH3()
vi.stubGlobal('defineEventHandler', h3.defineEventHandler)
vi.stubGlobal('getRouterParam', h3.getRouterParam)
vi.stubGlobal('createError', h3.createError)
vi.stubGlobal('defineRouteMeta', () => {})

const wheres: unknown[] = []
vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ op: 'and', parts }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
}))

let updatedRow: Record<string, unknown> | null = null
vi.mock('~~/server/db', () => ({
  db: {
    update: () => ({
      set: () => ({
        where: (w: unknown) => {
          wheres.push(w)
          return { returning: () => Promise.resolve(updatedRow ? [updatedRow] : []) }
        },
      }),
    }),
  },
}))
vi.mock('~~/server/db/schema', () => ({
  apiKey: {
    id: 'id',
    projectId: 'projectId',
    keyPrefix: 'keyPrefix',
    keyType: 'keyType',
    revokedAt: 'revokedAt',
  },
}))

const revokeMachineProjectRole = vi.fn()
vi.mock('~~/server/lib/pdp', () => ({
  revokeMachineProjectRole: (...a: unknown[]) => revokeMachineProjectRole(...a),
}))

const requireProjectAccess = vi.fn()
vi.mock('~~/server/lib/project-access', () => ({
  requireProjectAccess: (...a: unknown[]) => requireProjectAccess(...a),
}))

const auditEvents: Array<{ action: string; payload: Record<string, unknown> }> = []
vi.mock('~~/server/lib/audit', () => ({
  recordAuditEvent: (_e: unknown, payload: { action: string }) => {
    auditEvents.push({ action: payload.action, payload })
    return Promise.resolve()
  },
}))

const handler = (await import('./[keyId].delete')).default as unknown as (
  e: unknown,
) => Promise<Record<string, unknown>>

const revoke = () => handler(fakeEvent({ params: { projectId: PROJECT.id, keyId: 'k-1' } }))

/** Every leaf `eq` the update was narrowed with, flattened. */
function narrowedOn(): string[] {
  const out: string[] = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, unknown>
    if (o.op === 'and') (o.parts as unknown[]).forEach(walk)
    else if (o.op === 'eq') out.push(`${String(o.col)}=${String(o.val)}`)
  }
  wheres.forEach(walk)
  return out
}

beforeEach(() => {
  wheres.length = 0
  auditEvents.length = 0
  updatedRow = { id: 'k-1', keyPrefix: 'pk_live', keyType: 'publishable', revokedAt: new Date() }
  revokeMachineProjectRole.mockReset()
  revokeMachineProjectRole.mockResolvedValue(undefined)
  requireProjectAccess.mockReset()
  requireProjectAccess.mockResolvedValue({
    project: PROJECT,
    organization: ORG,
    role: 'admin',
    userId: 'user-1',
  })
})

describe('revoking an API key', () => {
  it('requires project ADMIN, not editor', async () => {
    // Key administration is one of the two things AC-D2 refuses to a machine,
    // and the bar is what makes that refusal possible. Asserted on the argument
    // rather than the outcome: a gate called with the wrong minimum passes its
    // own happy path.
    await revoke()
    expect(requireProjectAccess).toHaveBeenCalledWith(expect.anything(), PROJECT.id, 'admin')
  })

  it('🔴 writes the audit event, with the key id and a readable label', async () => {
    // The whole reason this file exists. Before it, nothing measured this.
    await revoke()
    expect(auditEvents).toHaveLength(1)
    expect(auditEvents[0]).toMatchObject({
      action: 'api_key.revoked',
      payload: { targetType: 'api_key', targetId: 'k-1', organizationId: ORG.id },
    })
    expect(auditEvents[0]!.payload.targetLabel).toContain('pk_live')
  })

  it('narrows the update on BOTH the key id and the project id', async () => {
    // The tenant boundary. Without the projectId leg, a project admin could
    // revoke another project's key by id — and the 404 below would never fire.
    await revoke()
    expect(narrowedOn()).toEqual(expect.arrayContaining([`id=k-1`, `projectId=${PROJECT.id}`]))
  })

  it('404s when the key is not in this project, and writes NO audit event', async () => {
    updatedRow = null
    await expect(revoke()).rejects.toMatchObject({ statusCode: 404 })
    expect(auditEvents).toEqual([])
  })
})

describe('🔴 the PDP tuple is deleted only for a SECRET key', () => {
  // A `sk_` key's authority IS a PDP machine tuple, so a soft-revoke alone
  // would leave it standing in the source of truth. A `pk_` has no tuple, and
  // calling revoke for one would ask the PDP to delete something that was never
  // granted. The pair is what makes either cell mean anything.
  it('deletes it for sk_', async () => {
    updatedRow = { id: 'k-1', keyPrefix: 'sk_live', keyType: 'secret', revokedAt: new Date() }
    await revoke()
    expect(revokeMachineProjectRole).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT.id,
      'k-1',
      'editor',
    )
  })

  it('does NOT for pk_ (negative control)', async () => {
    await revoke() // the default row is publishable
    expect(revokeMachineProjectRole).not.toHaveBeenCalled()
  })
})

describe('🔴 RECORDED, not cured: a PDP failure leaves a revoke with no audit trail', () => {
  it('propagates the error after the row is already soft-revoked', async () => {
    // `revokeMachineProjectRole` does not catch — it awaits client.revokeRole()
    // and lets it throw (server/lib/pdp.ts:352). It runs AFTER the UPDATE and
    // BEFORE the audit, so a PDP outage leaves: the key revoked in the database,
    // the tuple standing, and NO record that any of it happened.
    //
    // 🔴 THE SEVERITY IS LOWER THAN IT LOOKS, AND SAYING SO IS PART OF THE
    // FINDING. Both consumers of a key filter on isNull(revokedAt) — the CDN
    // route and provisioning-auth — so the key cannot authenticate afterwards.
    // The stale tuple is therefore unreachable: a dangling grant, not a live
    // privilege. The real residue is the missing audit row.
    //
    // Compare orgs/[orgId]/projects.post.ts, which rolls the row back when its
    // PDP write fails. That is the shape this endpoint does not have. Fixing it
    // changes behaviour on a pre-existing endpoint, so it is written down here
    // rather than changed under a task that asked for test files.
    updatedRow = { id: 'k-1', keyPrefix: 'sk_live', keyType: 'secret', revokedAt: new Date() }
    revokeMachineProjectRole.mockRejectedValue(new Error('pdp down'))
    await expect(revoke()).rejects.toThrow('pdp down')
    expect(auditEvents).toEqual([])
  })
})
