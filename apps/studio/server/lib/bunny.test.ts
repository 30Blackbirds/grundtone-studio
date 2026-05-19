import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// In-memory DB stub. The helper does one SELECT against api_key when
// keyPrefixes isn't supplied; we control its output via this array.
let apiKeyRows: Array<{ keyPrefix: string }> = []

vi.mock('../db', () => {
  const select = () => ({
    from: () => ({
      where: () => Promise.resolve(apiKeyRows),
    }),
  })
  return { db: { select } }
})
vi.mock('../db/schema', () => ({
  apiKey: {
    projectId: 'project_id',
    revokedAt: 'revoked_at',
    keyPrefix: 'key_prefix',
  },
}))
vi.mock('drizzle-orm', () => ({
  and: () => null,
  eq: () => null,
  isNull: () => null,
}))

const { purgeProjectCdn } = await import('./bunny')

const fetchMock = vi.fn<typeof globalThis.fetch>()
beforeEach(() => {
  apiKeyRows = []
  fetchMock.mockReset()
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
  process.env.BUNNY_PURGE_API_KEY = 'test-bunny-key'
  process.env.NUXT_PUBLIC_CDN_BASE = 'https://cdn.grundtone.io'
})

const originalFetch = globalThis.fetch
afterAll(() => {
  globalThis.fetch = originalFetch
  delete process.env.BUNNY_PURGE_API_KEY
  delete process.env.NUXT_PUBLIC_CDN_BASE
})

describe('purgeProjectCdn', () => {
  it('skips silently when BUNNY_PURGE_API_KEY is unset (dev env)', async () => {
    delete process.env.BUNNY_PURGE_API_KEY
    expect(await purgeProjectCdn('p1', { keyPrefixes: ['pk_live_abc'] })).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips silently when NUXT_PUBLIC_CDN_BASE is unset', async () => {
    delete process.env.NUXT_PUBLIC_CDN_BASE
    expect(await purgeProjectCdn('p1', { keyPrefixes: ['pk_live_abc'] })).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 0 and skips fetch when the project has no active keys', async () => {
    apiKeyRows = []
    expect(await purgeProjectCdn('p1')).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('purges one wildcard URL per active key prefix', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
    apiKeyRows = [{ keyPrefix: 'pk_live_aaaaaaaa' }, { keyPrefix: 'pk_test_bbbbbbbb' }]
    const count = await purgeProjectCdn('p1')
    expect(count).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const urls = fetchMock.mock.calls.map(([url]) => url as string)
    expect(urls[0]).toContain(encodeURIComponent('https://cdn.grundtone.io/k/pk_live_aaaaaaaa*'))
    expect(urls[1]).toContain(encodeURIComponent('https://cdn.grundtone.io/k/pk_test_bbbbbbbb*'))
  })

  it('passes the API key as AccessKey header (Bunny convention)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
    await purgeProjectCdn('p1', { keyPrefixes: ['pk_live_x'] })
    const [, init] = fetchMock.mock.calls[0]
    expect((init as RequestInit)?.method).toBe('POST')
    expect((init as RequestInit)?.headers).toMatchObject({ AccessKey: 'test-bunny-key' })
  })

  it('uses explicit keyPrefixes when given (no DB lookup)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
    apiKeyRows = [{ keyPrefix: 'should-not-be-used' }]
    const count = await purgeProjectCdn('p1', { keyPrefixes: ['pk_live_explicit'] })
    expect(count).toBe(1)
    expect(fetchMock.mock.calls[0][0]).toContain('pk_live_explicit')
    expect(fetchMock.mock.calls[0][0]).not.toContain('should-not-be-used')
  })

  it('logs but does not throw when Bunny returns a non-2xx', async () => {
    const errSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockResolvedValue(new Response('Forbidden', { status: 403 }))
    await expect(purgeProjectCdn('p1', { keyPrefixes: ['pk_live_x'] })).resolves.toBe(1)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('logs but does not throw when fetch itself rejects', async () => {
    const errSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockRejectedValue(new Error('network down'))
    await expect(purgeProjectCdn('p1', { keyPrefixes: ['pk_live_x'] })).resolves.toBe(1)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('strips trailing slash on the CDN base before composing the purge URL', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
    process.env.NUXT_PUBLIC_CDN_BASE = 'https://cdn.grundtone.io/'
    await purgeProjectCdn('p1', { keyPrefixes: ['pk_live_x'] })
    expect(fetchMock.mock.calls[0][0]).toContain(
      encodeURIComponent('https://cdn.grundtone.io/k/pk_live_x*'),
    )
  })
})
