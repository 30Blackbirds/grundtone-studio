import { describe, it, expect } from 'vitest'
import { buildBreadcrumb, SECTION_LABELS } from './breadcrumb'

const t = (key: string) => `t:${key}`
const base = { orgSlug: 'klanghaus', orgName: 'KlangHaus', projectSlug: null, projectName: null, t }

describe('buildBreadcrumb', () => {
  it('is empty outside an org', () => {
    expect(buildBreadcrumb({ ...base, path: '/dashboard', orgSlug: null, orgName: null })).toEqual(
      [],
    )
  })

  it('project: org › Projekter (link to the project list) › project', () => {
    expect(
      buildBreadcrumb({
        ...base,
        path: '/orgs/klanghaus/projects/blog',
        projectSlug: 'blog',
        projectName: 'KlangHaus Blog',
      }),
    ).toEqual([
      { label: 'KlangHaus', to: '/orgs/klanghaus' },
      { label: 't:projects.title', to: '/orgs/klanghaus' },
      { label: 'KlangHaus Blog' },
    ])
  })

  it.each(Object.entries(SECTION_LABELS))('section %s: org (link) › section title', (seg, key) => {
    expect(buildBreadcrumb({ ...base, path: `/orgs/klanghaus/${seg}` })).toEqual([
      { label: 'KlangHaus', to: '/orgs/klanghaus' },
      { label: `t:${key}` },
    ])
  })

  it('member detail keeps the members section', () => {
    expect(buildBreadcrumb({ ...base, path: '/orgs/klanghaus/members/m1' })).toEqual([
      { label: 'KlangHaus', to: '/orgs/klanghaus' },
      { label: 't:members.title' },
    ])
  })

  it('billing has a section step', () => {
    expect(buildBreadcrumb({ ...base, path: '/orgs/klanghaus/billing' }).at(-1)).toEqual({
      label: 't:billing.nav',
    })
  })

  it('org index: org › Projekter', () => {
    expect(buildBreadcrumb({ ...base, path: '/orgs/klanghaus' })).toEqual([
      { label: 'KlangHaus', to: '/orgs/klanghaus' },
      { label: 't:projects.title' },
    ])
  })

  it('falls back to slugs when names are not loaded yet', () => {
    expect(
      buildBreadcrumb({
        ...base,
        path: '/orgs/klanghaus/projects/blog',
        orgName: null,
        projectSlug: 'blog',
        projectName: null,
      }).map((i) => i.label),
    ).toEqual(['klanghaus', 't:projects.title', 'blog'])
  })

  // GTBreadcrumb marks every item without `to`/`href` as aria-current="page",
  // so exactly one item (the last) may lack a link.
  it('only the last item lacks a link, on every kind of page', () => {
    const cases = [
      { ...base, path: '/orgs/klanghaus/projects/blog', projectSlug: 'blog', projectName: 'Blog' },
      { ...base, path: '/orgs/klanghaus' },
      { ...base, path: '/orgs/klanghaus/members/m1' },
      ...Object.keys(SECTION_LABELS).map((seg) => ({ ...base, path: `/orgs/klanghaus/${seg}` })),
      { ...base, path: '/orgs/klanghaus/unknown' },
    ]
    for (const input of cases) {
      const items = buildBreadcrumb(input)
      expect(
        items.filter((i) => !i.to),
        input.path,
      ).toEqual([items.at(-1)])
    }
  })

  it('the current page is never a link', () => {
    for (const path of ['/orgs/klanghaus', '/orgs/klanghaus/audit', '/orgs/klanghaus/unknown']) {
      expect(buildBreadcrumb({ ...base, path }).at(-1)?.to).toBeUndefined()
    }
  })
})
