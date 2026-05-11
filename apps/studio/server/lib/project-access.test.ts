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
  // The helper does `db.select().from(table).where(...)` and consumes the
  // resulting array via destructuring. We sniff the table name off the
  // first arg to .from() and return the matching fixture rows filtered
  // by the predicate we constructed in the helper. Simplest stub: filter
  // each table by all known predicates and let the caller's destructure
  // pick the first.
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

// auth.ts throws at module load if BETTER_AUTH_SECRET is unset — getProjectRole
// doesn't touch it, but the import chain pulls it in transitively.
vi.mock('./auth', () => ({ auth: { api: { getSession: vi.fn() } } }))

// Re-import after mocks are in place.
const { getProjectRole } = await import('./project-access')

const PROJECT_ID = 'p1'
const ORG_ID = 'o1'
const USER = 'u1'

function setup(opts: {
  hasProject?: boolean
  orgRole?: 'owner' | 'admin' | 'member' | null
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

describe('getProjectRole', () => {
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

  it('maps org:owner to project:admin (source = org)', async () => {
    setup({ orgRole: 'owner' })
    const r = await getProjectRole(USER, PROJECT_ID)
    expect(r).toEqual({ role: 'admin', source: 'org', orgRole: 'owner', projectRole: null })
  })

  it('maps org:admin to project:admin', async () => {
    setup({ orgRole: 'admin' })
    expect((await getProjectRole(USER, PROJECT_ID))?.role).toBe('admin')
  })

  it('maps org:member to project:editor', async () => {
    setup({ orgRole: 'member' })
    expect((await getProjectRole(USER, PROJECT_ID))?.role).toBe('editor')
  })

  it('gives direct project membership (source = project) when no org membership', async () => {
    setup({ projectRole: 'editor' })
    const r = await getProjectRole(USER, PROJECT_ID)
    expect(r).toEqual({ role: 'editor', source: 'project', orgRole: null, projectRole: 'editor' })
  })

  it('takes the higher of two roles when both are present (source = both)', async () => {
    // org:member → editor, project:admin → admin → effective admin
    setup({ orgRole: 'member', projectRole: 'admin' })
    expect(await getProjectRole(USER, PROJECT_ID)).toEqual({
      role: 'admin',
      source: 'both',
      orgRole: 'member',
      projectRole: 'admin',
    })
  })

  it('keeps the org-side role when project role is narrower', async () => {
    // org:owner → admin always wins over project:viewer
    setup({ orgRole: 'owner', projectRole: 'viewer' })
    const r = await getProjectRole(USER, PROJECT_ID)
    expect(r?.role).toBe('admin')
  })

  it('rejects garbage role strings in the project_member row', async () => {
    setup({ projectRole: 'wizard' as 'viewer' })
    expect(await getProjectRole(USER, PROJECT_ID)).toBeNull()
  })
})
