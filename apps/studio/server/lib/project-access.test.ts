import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the db module before importing the helper, so getProjectRole works
// against an in-memory store instead of Postgres. The helper accesses three
// tables; we stub a single select-chain that returns rows per the last
// matched table name.

const fixtures = {
  project: [] as Array<{ id: string; organizationId: string }>,
  member: [] as Array<{ organizationId: string; userId: string; role: string }>,
  projectMember: [] as Array<{ projectId: string; userId: string; role: string }>,
}

vi.mock('../db', () => {
  const select = () => ({
    from: (table: { _: { name?: string } } | unknown) => {
      const name = ((table as { _: { name?: string } })?._?.name ?? '').toString()
      const rows: unknown[] =
        name === 'project'
          ? fixtures.project
          : name === 'member'
            ? fixtures.member
            : name === 'project_member'
              ? fixtures.projectMember
              : []
      return { where: () => Promise.resolve(rows) }
    },
  })
  return { db: { select } }
})

vi.mock('../db/schema', () => ({
  project: { _: { name: 'project' } },
  projectMember: { _: { name: 'project_member' } },
}))
vi.mock('../db/schema/auth', () => ({
  member: { _: { name: 'member' } },
  organization: { _: { name: 'organization' } },
}))
vi.mock('drizzle-orm', () => ({
  and: () => null,
  eq: () => null,
}))

vi.mock('./auth', () => ({ auth: { api: { getSession: vi.fn() } } }))

const { getProjectRole, orgRoleHelpers } = await import('./project-access')

const PROJECT_ID = 'p1'
const ORG_ID = 'o1'
const USER = 'u1'

function setup(opts: {
  hasProject?: boolean
  orgRole?: 'billing' | 'member' | 'admin' | 'manager' | 'owner' | null
  projectRole?: 'viewer' | 'editor' | 'admin' | null
}) {
  fixtures.project = opts.hasProject === false ? [] : [{ id: PROJECT_ID, organizationId: ORG_ID }]
  fixtures.member = opts.orgRole
    ? [{ organizationId: ORG_ID, userId: USER, role: opts.orgRole }]
    : []
  fixtures.projectMember = opts.projectRole
    ? [{ projectId: PROJECT_ID, userId: USER, role: opts.projectRole }]
    : []
}

describe('getProjectRole — Sentry-style 5-tier org roles', () => {
  beforeEach(() => {
    fixtures.project = []
    fixtures.member = []
    fixtures.projectMember = []
  })

  it('returns null when the project does not exist', async () => {
    setup({ hasProject: false })
    expect(await getProjectRole(USER, PROJECT_ID)).toBeNull()
  })

  it('returns null when the user has no org and no project membership', async () => {
    setup({})
    expect(await getProjectRole(USER, PROJECT_ID)).toBeNull()
  })

  it('org:owner → project:admin (full power on every project)', async () => {
    setup({ orgRole: 'owner' })
    const r = await getProjectRole(USER, PROJECT_ID)
    expect(r).toEqual({ role: 'admin', source: 'org', orgRole: 'owner', projectRole: null })
  })

  it('org:manager → project:admin (full power on every project)', async () => {
    setup({ orgRole: 'manager' })
    expect((await getProjectRole(USER, PROJECT_ID))?.role).toBe('admin')
  })

  it('org:admin → project:viewer by default (no auto write access)', async () => {
    setup({ orgRole: 'admin' })
    const r = await getProjectRole(USER, PROJECT_ID)
    expect(r?.role).toBe('viewer')
  })

  it('org:member → project:viewer (read-only across the org)', async () => {
    setup({ orgRole: 'member' })
    expect((await getProjectRole(USER, PROJECT_ID))?.role).toBe('viewer')
  })

  it('org:billing → no project access (returns null)', async () => {
    setup({ orgRole: 'billing' })
    expect(await getProjectRole(USER, PROJECT_ID)).toBeNull()
  })

  it('org:billing + direct project membership still grants project-only access', async () => {
    setup({ orgRole: 'billing', projectRole: 'editor' })
    const r = await getProjectRole(USER, PROJECT_ID)
    expect(r).toEqual({
      role: 'editor',
      source: 'project',
      orgRole: 'billing',
      projectRole: 'editor',
    })
  })

  it('direct project membership without org membership (source = project)', async () => {
    setup({ projectRole: 'editor' })
    const r = await getProjectRole(USER, PROJECT_ID)
    expect(r).toEqual({ role: 'editor', source: 'project', orgRole: null, projectRole: 'editor' })
  })

  it('takes the higher of two roles when both are present (source = both)', async () => {
    // org:admin → viewer, project:editor → editor → effective editor
    setup({ orgRole: 'admin', projectRole: 'editor' })
    expect(await getProjectRole(USER, PROJECT_ID)).toEqual({
      role: 'editor',
      source: 'both',
      orgRole: 'admin',
      projectRole: 'editor',
    })
  })

  it('org:owner outranks any narrower project role', async () => {
    setup({ orgRole: 'owner', projectRole: 'viewer' })
    expect((await getProjectRole(USER, PROJECT_ID))?.role).toBe('admin')
  })

  it('rejects garbage role strings in the project_member row', async () => {
    setup({ projectRole: 'wizard' as 'viewer' })
    expect(await getProjectRole(USER, PROJECT_ID)).toBeNull()
  })

  it('rejects garbage role strings in the org member row', async () => {
    setup({ orgRole: 'sysadmin' as 'admin' })
    expect(await getProjectRole(USER, PROJECT_ID)).toBeNull()
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
    expect(orgRoleHelpers.canManageBilling('admin')).toBe(false)
    expect(orgRoleHelpers.canManageBilling('member')).toBe(false)
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
    expect(orgRoleHelpers.canViewProjects('manager')).toBe(true)
    expect(orgRoleHelpers.canViewProjects('admin')).toBe(true)
    expect(orgRoleHelpers.canViewProjects('member')).toBe(true)
    expect(orgRoleHelpers.canViewProjects('billing')).toBe(false)
  })
})
