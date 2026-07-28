import { describe, it, expect } from 'vitest'
import { assembleDashboard } from './dashboard'

const org = (id: string, slug: string, role: string | null = 'owner') => ({
  id,
  slug,
  name: slug.toUpperCase(),
  memberCount: 3,
  role,
})

describe('assembleDashboard', () => {
  it('derives project status: active → published, draft-only → draft, neither → none', () => {
    const out = assembleDashboard(
      [org('o1', 'acme')],
      [
        { id: 'p1', organizationId: 'o1', slug: 'a', name: 'A' },
        { id: 'p2', organizationId: 'o1', slug: 'b', name: 'B' },
        { id: 'p3', organizationId: 'o1', slug: 'c', name: 'C' },
      ],
      [
        {
          projectId: 'p1',
          publishedAt: '2026-07-01T10:00:00Z',
          tokensJson: { colors: { primary: '#0059b3' } },
        },
      ],
      [{ projectId: 'p2' }],
      [],
    )
    expect(out.projects.map((p) => p.status)).toEqual(['published', 'draft', 'none'])
    expect(out.projects[0].primaryColor).toBe('#0059b3')
    expect(out.projects[0].publishedAt).toBe('2026-07-01T10:00:00Z')
    expect(out.projects[1].primaryColor).toBeNull()
  })

  it('maps org slug/name onto projects and drops rows for unknown orgs', () => {
    const out = assembleDashboard(
      [org('o1', 'acme')],
      [
        { id: 'p1', organizationId: 'o1', slug: 'a', name: 'A' },
        { id: 'px', organizationId: 'o-unknown', slug: 'x', name: 'X' },
      ],
      [],
      [],
      [],
    )
    expect(out.projects).toHaveLength(1)
    expect(out.projects[0].orgSlug).toBe('acme')
    expect(out.projects[0].orgName).toBe('ACME')
  })

  it('scopes activity to known orgs and serialises dates to ISO strings', () => {
    const out = assembleDashboard(
      [org('o1', 'acme')],
      [],
      [],
      [],
      [
        {
          id: 'e1',
          organizationId: 'o1',
          action: 'config.published',
          actorEmail: 'a@b.dk',
          targetLabel: 'Project A',
          createdAt: new Date('2026-07-28T12:00:00Z'),
        },
        {
          id: 'e2',
          organizationId: 'o-other',
          action: 'member.removed',
          actorEmail: null,
          targetLabel: null,
          createdAt: '2026-07-28T11:00:00Z',
        },
      ],
    )
    expect(out.activity).toHaveLength(1)
    expect(out.activity[0]).toMatchObject({
      id: 'e1',
      orgSlug: 'acme',
      action: 'config.published',
      createdAt: '2026-07-28T12:00:00.000Z',
    })
  })

  it('handles tokens without a colors.primary gracefully', () => {
    const out = assembleDashboard(
      [org('o1', 'acme')],
      [{ id: 'p1', organizationId: 'o1', slug: 'a', name: 'A' }],
      [{ projectId: 'p1', publishedAt: null, tokensJson: { spacing: { sm: '4px' } } }],
      [],
      [],
    )
    expect(out.projects[0].primaryColor).toBeNull()
    expect(out.projects[0].publishedAt).toBeNull()
    expect(out.projects[0].status).toBe('published')
  })
})
