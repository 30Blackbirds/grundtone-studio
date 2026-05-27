import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3, type FakeEvent } from '~~/tests/helpers/endpoint-fixtures'

// node:fs/promises is mocked so tests can drive the readFile result without
// depending on whether the SDK has actually been built into the workspace.
const readFileMock = vi.fn<(path: string, encoding: string) => Promise<string>>()
vi.mock('node:fs/promises', () => ({
  readFile: (path: string, encoding: string) => readFileMock(path, encoding),
}))

vi.mock('h3', () => mockH3())

const handler = (await import('./[file].get')).default as unknown as (
  event: FakeEvent,
) => Promise<unknown>

beforeEach(() => {
  readFileMock.mockReset()
})

describe('GET /client/[file]', () => {
  it('404s when the file name is missing', async () => {
    await expect(handler(fakeEvent({ params: {} }))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('404s when the file name is not in the allowlist', async () => {
    await expect(handler(fakeEvent({ params: { file: 'evil.js' } }))).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('serves v1.js with the JS content-type, long cache, and CORS *', async () => {
    readFileMock.mockResolvedValueOnce('/* sdk bytes */')
    const event = fakeEvent({ params: { file: 'v1.js' } })
    const body = await handler(event)
    expect(body).toBe('/* sdk bytes */')
    expect(event.responseHeaders['content-type']).toBe('application/javascript')
    expect(event.responseHeaders['cache-control']).toBe('public, max-age=300')
    expect(event.responseHeaders['access-control-allow-origin']).toBe('*')
    // Resolved path ends at the saas-client dist's UMD bundle name.
    expect(readFileMock.mock.calls[0][0]).toMatch(/saas-client\/dist\/index\.umd\.js$/)
  })

  it('serves v1.mjs from the ESM dist file', async () => {
    readFileMock.mockResolvedValueOnce('export {}')
    const event = fakeEvent({ params: { file: 'v1.mjs' } })
    await handler(event)
    expect(readFileMock.mock.calls[0][0]).toMatch(/saas-client\/dist\/index\.mjs$/)
    expect(event.responseHeaders['content-type']).toBe('application/javascript')
  })

  it('serves source maps as JSON', async () => {
    readFileMock.mockResolvedValueOnce('{}')
    const event = fakeEvent({ params: { file: 'v1.js.map' } })
    await handler(event)
    expect(event.responseHeaders['content-type']).toBe('application/json')
  })

  it('serves SRI manifests as plain text', async () => {
    readFileMock.mockResolvedValueOnce('sha384-abc')
    const event = fakeEvent({ params: { file: 'v1.mjs.sri' } })
    await handler(event)
    expect(event.responseHeaders['content-type']).toBe('text/plain')
  })

  it('404s with a helpful build-the-SDK message when the dist file is missing', async () => {
    readFileMock.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await expect(handler(fakeEvent({ params: { file: 'v1.js' } }))).rejects.toMatchObject({
      statusCode: 404,
      message: expect.stringContaining('pnpm --filter @grundtone/saas-client build'),
    })
  })
})
