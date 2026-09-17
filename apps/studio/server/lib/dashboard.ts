// Pure assembly for the dashboard payload — separated from the endpoint so the
// shaping logic (status derivation, primary-color extraction, activity
// scoping) is unit-testable without DB/auth plumbing.

export interface DashboardOrg {
  id: string
  slug: string
  name: string
  memberCount: number | null
  role: string | null
}

export interface DashboardProject {
  id: string
  orgSlug: string
  orgName: string
  slug: string
  name: string
  primaryColor: string | null
  status: 'published' | 'draft' | 'none'
  publishedAt: string | null
  /** Leaf values in the published version's tokens; null when nothing is published. */
  tokenCount: number | null
}

export interface DashboardActivity {
  id: string
  orgSlug: string
  action: string
  actorEmail: string | null
  targetLabel: string | null
  createdAt: string
}

export interface DashboardPayload {
  orgs: DashboardOrg[]
  projects: DashboardProject[]
  activity: DashboardActivity[]
}

interface OrgInput {
  id: string
  slug: string
  name: string
  memberCount: number | null
  role: string | null
}

interface ProjectRow {
  id: string
  organizationId: string
  slug: string
  name: string
}

interface ActiveRow {
  projectId: string
  publishedAt: Date | string | null
  tokensJson: Record<string, unknown>
}

interface DraftRow {
  projectId: string
}

interface ActivityRow {
  id: string
  organizationId: string
  action: string
  actorEmail: string | null
  targetLabel: string | null
  createdAt: Date | string
}

function primaryColorOf(tokens: Record<string, unknown>): string | null {
  const colors = tokens.colors
  if (colors && typeof colors === 'object' && 'primary' in colors) {
    const v = (colors as Record<string, unknown>).primary
    return typeof v === 'string' ? v : null
  }
  return null
}

function countTokens(value: unknown): number {
  if (value === null || typeof value !== 'object') return 1
  return Object.values(value).reduce<number>((n, v) => n + countTokens(v), 0)
}

function iso(d: Date | string): string {
  return typeof d === 'string' ? d : d.toISOString()
}

export function assembleDashboard(
  orgs: OrgInput[],
  projects: ProjectRow[],
  activeRows: ActiveRow[],
  draftRows: DraftRow[],
  activityRows: ActivityRow[],
): DashboardPayload {
  const orgById = new Map(orgs.map((o) => [o.id, o]))
  const activeByProject = new Map(activeRows.map((r) => [r.projectId, r]))
  const draftProjects = new Set(draftRows.map((r) => r.projectId))

  const projectItems: DashboardProject[] = projects
    // Projects whose org the caller can't see (shouldn't happen — the query is
    // scoped by the caller's org ids) are dropped rather than leaked.
    .filter((p) => orgById.has(p.organizationId))
    .map((p) => {
      const org = orgById.get(p.organizationId)!
      const active = activeByProject.get(p.id)
      const status: DashboardProject['status'] = active
        ? 'published'
        : draftProjects.has(p.id)
          ? 'draft'
          : 'none'
      return {
        id: p.id,
        orgSlug: org.slug,
        orgName: org.name,
        slug: p.slug,
        name: p.name,
        primaryColor: active ? primaryColorOf(active.tokensJson) : null,
        status,
        publishedAt: active?.publishedAt ? iso(active.publishedAt) : null,
        tokenCount: active ? countTokens(active.tokensJson) : null,
      }
    })

  const activity: DashboardActivity[] = activityRows
    .filter((r) => orgById.has(r.organizationId))
    .map((r) => ({
      id: r.id,
      orgSlug: orgById.get(r.organizationId)!.slug,
      action: r.action,
      actorEmail: r.actorEmail,
      targetLabel: r.targetLabel,
      createdAt: iso(r.createdAt),
    }))

  return {
    orgs: orgs.map((o) => ({
      id: o.id,
      slug: o.slug,
      name: o.name,
      memberCount: o.memberCount,
      role: o.role,
    })),
    projects: projectItems,
    activity,
  }
}
