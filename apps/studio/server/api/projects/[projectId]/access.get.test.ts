import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3, PROJECT } from '~~/tests/helpers/endpoint-fixtures'

// access.get.ts relies on Nuxt auto-imports for these.
const h3 = mockH3()
vi.stubGlobal('defineEventHandler', h3.defineEventHandler)
vi.stubGlobal('getRouterParam', h3.getRouterParam)
vi.stubGlobal('createError', h3.createError)

type Verdict = 'allowed' | 'denied' | 'unavailable'
const verdicts = new Map<string, Verdict>()
vi.mock('~~/server/lib/pdp', () => ({
  batchCheckProjects: vi.fn(async (_e: unknown, ids: string[], action: string) =>
    Object.fromEntries(ids.map((id) => [id, verdicts.get(action) ?? 'denied'])),
  ),
}))

const handler = (await import('./access.get')).default as unknown as (
  event: unknown,
) => Promise<{ role: string | null }>

const event = () => fakeEvent({ params: { projectId: PROJECT.id } })

beforeEach(() => {
  verdicts.clear()
})

describe('GET /api/projects/[projectId]/access', () => {
  it('resolves the highest allowed role', async () => {
    verdicts.set('can_view', 'allowed')
    verdicts.set('can_edit', 'allowed')
    await expect(handler(event())).resolves.toEqual({ role: 'editor' })
  })

  it('returns role:null when every relation is denied (control)', async () => {
    await expect(handler(event())).resolves.toEqual({ role: null })
  })

  it('503 pdp_unavailable when any check cannot be answered — not role:null', async () => {
    verdicts.set('can_view', 'allowed')
    verdicts.set('can_admin', 'unavailable')
    await expect(handler(event())).rejects.toMatchObject({
      statusCode: 503,
      data: { code: 'pdp_unavailable' },
    })
  })

  it('401 without an actor', async () => {
    await expect(
      handler(fakeEvent({ params: { projectId: PROJECT.id }, context: {} })),
    ).rejects.toMatchObject({ statusCode: 401 })
  })
})
