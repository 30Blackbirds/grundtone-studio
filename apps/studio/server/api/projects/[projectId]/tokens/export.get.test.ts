import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent, mockH3, ORG, PROJECT, SESSION } from '~~/tests/helpers/endpoint-fixtures'

vi.mock('h3', () => mockH3())

const loadTokenSource = vi.fn()
vi.mock('~~/server/lib/token-source', () => ({
  loadTokenSource: (...args: unknown[]) => loadTokenSource(...args),
}))

const requireProjectAccess = vi.fn()
vi.mock('~~/server/lib/project-access', () => ({
  requireProjectAccess: (...args: unknown[]) => requireProjectAccess(...args),
}))

const handler = (await import('./export.get')).default as unknown as (
  event: unknown,
) => Promise<unknown>

const withDark = {
  colors: { primary: '#4F46E5', secondary: 'var(--brand)' },
  dark: { colors: { primary: '#818CF8' } },
}

function request(query: Record<string, string>) {
  return fakeEvent({ params: { projectId: PROJECT.id }, query })
}

beforeEach(() => {
  loadTokenSource.mockReset()
  requireProjectAccess.mockReset()
  requireProjectAccess.mockResolvedValue({
    userId: SESSION.user.id,
    project: PROJECT,
    organization: ORG,
    role: 'viewer',
  })
})

describe('GET /api/projects/[projectId]/tokens/export', () => {
  it.each([[{}], [{ source: 'latest' }]])('400s without a valid source (%j)', async (query) => {
    await expect(handler(request(query))).rejects.toMatchObject({ statusCode: 400 })
    expect(loadTokenSource).not.toHaveBeenCalled()
  })

  it('400s on an unknown part', async () => {
    await expect(handler(request({ source: 'draft', part: 'zip' }))).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('asks for viewer access, the same bar as reading the config (E1)', async () => {
    loadTokenSource.mockResolvedValue({ version: 1, tokens: withDark })
    await handler(request({ source: 'active' }))
    expect(requireProjectAccess).toHaveBeenCalledWith(expect.anything(), PROJECT.id)
    expect(loadTokenSource).toHaveBeenCalledWith(PROJECT.id, 'active')
  })

  it('404s when the project has no version for that source, with no fallback', async () => {
    loadTokenSource.mockResolvedValue(null)
    await expect(handler(request({ source: 'active' }))).rejects.toMatchObject({
      statusCode: 404,
      data: { code: 'version_not_found' },
    })
    expect(loadTokenSource).toHaveBeenCalledTimes(1)
  })

  it('base: DTCG media type, attachment named after the project slug (E2)', async () => {
    loadTokenSource.mockResolvedValue({ version: 3, tokens: withDark })
    const event = request({ source: 'draft' })
    const body = await handler(event)
    expect(event.responseHeaders['content-type']).toBe('application/design-tokens+json')
    expect(event.responseHeaders['content-disposition']).toBe(
      `attachment; filename="${PROJECT.slug}.tokens.json"`,
    )
    expect(event.responseHeaders['cache-control']).toBe('no-store')
    expect(JSON.parse(body as string).color.primary.$value.hex).toBe('#4f46e5')
  })

  it('resolver is served as application/json, as the resolver spec asks', async () => {
    loadTokenSource.mockResolvedValue({ version: 3, tokens: withDark })
    const event = request({ source: 'draft', part: 'resolver' })
    const body = JSON.parse((await handler(event)) as string)
    expect(event.responseHeaders['content-type']).toBe('application/json')
    expect(body.version).toBe('2025.10')
  })

  it('dark and resolver 404 when there is no dark layer (E3)', async () => {
    loadTokenSource.mockResolvedValue({ version: 1, tokens: { colors: { primary: '#000' } } })
    for (const part of ['dark', 'resolver']) {
      await expect(handler(request({ source: 'draft', part }))).rejects.toMatchObject({
        statusCode: 404,
        data: { code: 'no_dark_layer' },
      })
    }
  })

  it('report lists the files and what was left out (E6)', async () => {
    loadTokenSource.mockResolvedValue({ version: 7, tokens: withDark })
    const out = (await handler(request({ source: 'draft', part: 'report' }))) as {
      version: number
      files: Record<string, string | null>
      report: { total: number; exported: number; omitted: { path: string; code: string }[] }
    }
    expect(out.version).toBe(7)
    expect(out.files).toEqual({
      base: `${PROJECT.slug}.tokens.json`,
      dark: `${PROJECT.slug}.dark.tokens.json`,
      resolver: `${PROJECT.slug}.resolver.json`,
    })
    expect(out.report).toMatchObject({ total: 3, exported: 2 })
    expect(out.report.omitted).toMatchObject([{ path: 'colors.secondary', code: 'color_var' }])
  })
})
