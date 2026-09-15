import { describe, it, expect, vi, beforeEach } from 'vitest'

// project-access now delegates the decision to the PDP (pdp.ts) and reads
// identity from event.context.auth. We mock pdp.ts so the helper runs against
// in-memory check results, plus the db (project row lookup) and org-lookup
// (display org). createError is provided by h3's Nuxt auto-import in app code;
// here we stub a global so the helper's throws carry a statusCode.

const projectRows: Array<{ id: string; organizationId: string }> = []
// "<resource>::<action>" → true (allowed), false/absent (denied) or
// 'unavailable' (the PDP could not answer).
const allow: Record<string, boolean | 'unavailable'> = {}
const verdictFor = (key: string) =>
  allow[key] === 'unavailable' ? 'unavailable' : allow[key] ? 'allowed' : 'denied'

// Spread form (as mockH3's createError) so `data.code` survives into assertions.
vi.stubGlobal(
  'createError',
  (opts: { statusCode: number; statusMessage?: string; data?: unknown }) =>
    Object.assign(new Error(opts.statusMessage ?? ''), opts),
)

vi.mock('../db', () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(projectRows) }),
    }),
  },
}))
vi.mock('../db/schema', () => ({ project: { _: { name: 'project' } } }))
vi.mock('drizzle-orm', () => ({ eq: () => null }))

vi.mock('./org-lookup', () => ({
  lookupOrgById: vi.fn(async (_e: unknown, id: string) => ({
    id,
    name: 'Acme Corp',
    slug: 'acme',
  })),
}))

vi.mock('./pdp', () => ({
  checkProject: vi.fn(async (_e: unknown, projectId: string, action: string) =>
    verdictFor(`project:${projectId}::${action}`),
  ),
  checkOrg: vi.fn(async (_e: unknown, orgId: string, relation: string) =>
    verdictFor(`organization:${orgId}::${relation}`),
  ),
}))

const { requireProjectAccess, requireOrgRole, orgRoleHelpers } = await import('./project-access')

const PROJECT_ID = 'p1'
const ORG_ID = 'o1'
const SUB = 'u1'

function eventWithAuth(authed = true) {
  return {
    context: authed ? { auth: { sub: SUB, tenant: ORG_ID, email: 'u@acme.dk' } } : {},
  } as unknown as Parameters<typeof requireProjectAccess>[0]
}

beforeEach(() => {
  projectRows.length = 0
  // Reset all decisions to false between cases (Boolean(allow[k]) treats false
  // and absent identically, so this is equivalent to clearing the map).
  for (const k of Object.keys(allow)) allow[k] = false
})

describe('requireProjectAccess — PDP-backed', () => {
  it('401 when no actor on the request', async () => {
    await expect(requireProjectAccess(eventWithAuth(false), PROJECT_ID)).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('404 when the project does not exist', async () => {
    projectRows.length = 0
    await expect(requireProjectAccess(eventWithAuth(), PROJECT_ID)).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('403 when the PDP denies the required relation', async () => {
    projectRows.push({ id: PROJECT_ID, organizationId: ORG_ID })
    // no allow entries → denied
    await expect(requireProjectAccess(eventWithAuth(), PROJECT_ID, 'editor')).rejects.toMatchObject(
      { statusCode: 403 },
    )
  })

  it('grants access and resolves the precise role from the top down', async () => {
    projectRows.push({ id: PROJECT_ID, organizationId: ORG_ID })
    allow[`project:${PROJECT_ID}::can_view`] = true
    allow[`project:${PROJECT_ID}::can_edit`] = true
    // can_admin denied → effective role is editor

    const access = await requireProjectAccess(eventWithAuth(), PROJECT_ID, 'viewer')
    expect(access.role).toBe('editor')
    expect(access.userId).toBe(SUB)
    expect(access.organization).toMatchObject({ id: ORG_ID, name: 'Acme Corp', slug: 'acme' })
  })

  it('admin gate passes when can_admin is allowed', async () => {
    projectRows.push({ id: PROJECT_ID, organizationId: ORG_ID })
    allow[`project:${PROJECT_ID}::can_view`] = true
    allow[`project:${PROJECT_ID}::can_edit`] = true
    allow[`project:${PROJECT_ID}::can_admin`] = true

    const access = await requireProjectAccess(eventWithAuth(), PROJECT_ID, 'admin')
    expect(access.role).toBe('admin')
  })

  it('503 pdp_unavailable — not 403 — when the PDP cannot answer the gate check', async () => {
    projectRows.push({ id: PROJECT_ID, organizationId: ORG_ID })
    allow[`project:${PROJECT_ID}::can_edit`] = 'unavailable'
    await expect(requireProjectAccess(eventWithAuth(), PROJECT_ID, 'editor')).rejects.toMatchObject(
      { statusCode: 503, data: { code: 'pdp_unavailable' } },
    )
  })

  it('503 when the gate passes but role resolution cannot be answered (never a guessed role)', async () => {
    projectRows.push({ id: PROJECT_ID, organizationId: ORG_ID })
    allow[`project:${PROJECT_ID}::can_view`] = true
    allow[`project:${PROJECT_ID}::can_admin`] = 'unavailable'
    await expect(requireProjectAccess(eventWithAuth(), PROJECT_ID, 'viewer')).rejects.toMatchObject(
      { statusCode: 503, data: { code: 'pdp_unavailable' } },
    )
  })
})

describe('requireOrgRole — PDP-backed', () => {
  it('401 without an actor', async () => {
    await expect(requireOrgRole(eventWithAuth(false), ORG_ID)).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('403 when the org relation is denied', async () => {
    await expect(requireOrgRole(eventWithAuth(), ORG_ID, 'manager')).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it('passes and resolves the highest-held role', async () => {
    allow[`organization:${ORG_ID}::member`] = true
    allow[`organization:${ORG_ID}::admin`] = true
    // manager/owner denied → resolved role is admin

    const access = await requireOrgRole(eventWithAuth(), ORG_ID, 'member')
    expect(access.role).toBe('admin')
    expect(access.organizationId).toBe(ORG_ID)
  })

  it('503 pdp_unavailable — not 403 — when an org check cannot be answered', async () => {
    allow[`organization:${ORG_ID}::owner`] = 'unavailable'
    await expect(requireOrgRole(eventWithAuth(), ORG_ID, 'member')).rejects.toMatchObject({
      statusCode: 503,
      data: { code: 'pdp_unavailable' },
    })
  })
})

describe('orgRoleHelpers', () => {
  it('only owner + manager can manage org members', () => {
    expect(orgRoleHelpers.canManageOrgMembers('owner')).toBe(true)
    expect(orgRoleHelpers.canManageOrgMembers('manager')).toBe(true)
    expect(orgRoleHelpers.canManageOrgMembers('admin')).toBe(false)
    expect(orgRoleHelpers.canManageOrgMembers('member')).toBe(false)
    expect(orgRoleHelpers.canManageOrgMembers('billing')).toBe(false)
  })

  it('only owner + billing can manage billing', () => {
    expect(orgRoleHelpers.canManageBilling('owner')).toBe(true)
    expect(orgRoleHelpers.canManageBilling('billing')).toBe(true)
    expect(orgRoleHelpers.canManageBilling('manager')).toBe(false)
  })

  it('owner + manager + admin can create projects', () => {
    expect(orgRoleHelpers.canCreateProjects('owner')).toBe(true)
    expect(orgRoleHelpers.canCreateProjects('manager')).toBe(true)
    expect(orgRoleHelpers.canCreateProjects('admin')).toBe(true)
    expect(orgRoleHelpers.canCreateProjects('member')).toBe(false)
    expect(orgRoleHelpers.canCreateProjects('billing')).toBe(false)
  })

  it('billing cannot view projects; everyone else can', () => {
    expect(orgRoleHelpers.canViewProjects('owner')).toBe(true)
    expect(orgRoleHelpers.canViewProjects('member')).toBe(true)
    expect(orgRoleHelpers.canViewProjects('billing')).toBe(false)
  })
})
