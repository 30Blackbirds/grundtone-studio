import { resolve } from 'node:path'
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

// The two places the dist can live: the workspace package when Nuxt dev runs
// from apps/studio, and the copy the Dockerfile puts under /app in the image.
const WORKSPACE_DIST = resolve(process.cwd(), '../..', 'packages/saas-client/dist')
const IMAGE_DIST = resolve(process.cwd(), 'packages/saas-client/dist')
const SHORT_CACHE = 'public, max-age=300'
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })

async function serve(file: string, body = '/* sdk bytes */') {
  readFileMock.mockResolvedValueOnce(body)
  const event = fakeEvent({ params: { file } })
  const result = await handler(event)
  return { event, result, path: readFileMock.mock.calls[0][0] }
}

beforeEach(() => {
  readFileMock.mockReset()
})

describe('GET /client/[file]', () => {
  it('404s when the file name is missing', async () => {
    await expect(handler(fakeEvent({ params: {} }))).rejects.toMatchObject({ statusCode: 404 })
  })

  it.each(['evil.js', 'v2.js', 'v1.0.1.js', 'v0.9.0.js', 'v1.0.0.css', '../v1.js'])(
    '404s for %s, which is not part of the public contract',
    async (file) => {
      await expect(handler(fakeEvent({ params: { file } }))).rejects.toMatchObject({
        statusCode: 404,
      })
      expect(readFileMock).not.toHaveBeenCalled()
    },
  )

  it('serves v1.js as the latest build with a short cache and CORS *', async () => {
    const { event, result, path } = await serve('v1.js')
    expect(result).toBe('/* sdk bytes */')
    expect(path).toBe(resolve(WORKSPACE_DIST, 'index.umd.js'))
    expect(event.responseHeaders['content-type']).toBe('application/javascript')
    expect(event.responseHeaders['cache-control']).toBe(SHORT_CACHE)
    expect(event.responseHeaders['access-control-allow-origin']).toBe('*')
  })

  it('serves v1.0.0.js from the same bundle with an immutable cache', async () => {
    const { event, path } = await serve('v1.0.0.js')
    expect(path).toBe(resolve(WORKSPACE_DIST, 'index.umd.js'))
    expect(event.responseHeaders['content-type']).toBe('application/javascript')
    expect(event.responseHeaders['cache-control']).toBe(IMMUTABLE_CACHE)
    expect(event.responseHeaders['access-control-allow-origin']).toBe('*')
  })

  it.each([
    ['v1.mjs', 'index.mjs', 'application/javascript', SHORT_CACHE],
    ['v1.js.map', 'index.umd.js.map', 'application/json', SHORT_CACHE],
    ['v1.mjs.map', 'index.mjs.map', 'application/json', SHORT_CACHE],
    ['v1.js.sri', 'index.umd.js.sri', 'text/plain', SHORT_CACHE],
    ['v1.mjs.sri', 'index.mjs.sri', 'text/plain', SHORT_CACHE],
    ['v1.0.0.mjs', 'index.mjs', 'application/javascript', IMMUTABLE_CACHE],
    ['v1.0.0.js.map', 'index.umd.js.map', 'application/json', IMMUTABLE_CACHE],
    ['v1.0.0.mjs.map', 'index.mjs.map', 'application/json', IMMUTABLE_CACHE],
    ['v1.0.0.js.sri', 'index.umd.js.sri', 'text/plain', IMMUTABLE_CACHE],
    ['v1.0.0.mjs.sri', 'index.mjs.sri', 'text/plain', IMMUTABLE_CACHE],
  ])('serves %s from %s as %s with cache %s', async (file, source, contentType, cache) => {
    const { event, path } = await serve(file)
    expect(path).toBe(resolve(WORKSPACE_DIST, source))
    expect(event.responseHeaders['content-type']).toBe(contentType)
    expect(event.responseHeaders['cache-control']).toBe(cache)
  })

  it('falls back to the dist the Dockerfile copies into the image', async () => {
    readFileMock.mockRejectedValueOnce(enoent()).mockResolvedValueOnce('/* image bytes */')
    const event = fakeEvent({ params: { file: 'v1.0.0.js' } })
    await expect(handler(event)).resolves.toBe('/* image bytes */')
    expect(readFileMock.mock.calls.map((call) => call[0])).toEqual([
      resolve(WORKSPACE_DIST, 'index.umd.js'),
      resolve(IMAGE_DIST, 'index.umd.js'),
    ])
    expect(event.responseHeaders['cache-control']).toBe(IMMUTABLE_CACHE)
  })

  it('404s with a helpful build-the-SDK message when neither dist has the file', async () => {
    readFileMock.mockRejectedValueOnce(enoent()).mockRejectedValueOnce(enoent())
    await expect(handler(fakeEvent({ params: { file: 'v1.js' } }))).rejects.toMatchObject({
      statusCode: 404,
      message: expect.stringContaining('pnpm --filter @grundtone/saas-client build'),
    })
    expect(readFileMock).toHaveBeenCalledTimes(2)
  })
})
