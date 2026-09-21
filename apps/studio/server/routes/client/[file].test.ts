import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3, type FakeEvent } from '~~/tests/helpers/endpoint-fixtures'

// node:fs/promises is mocked so the cells drive both sources without depending
// on whether the SDK has been built or the contract directory copied.
//   readFile — the bytes of whatever file the route decides to read
//   readdir  — the listing of apps/studio/sdk-contract/. The route caches it
//              for the module's lifetime, so it is ONE fixed listing for the
//              whole file, as it would be for one running image.
const readFileMock = vi.fn<(path: string, encoding: string) => Promise<string>>()
const COMMITTED = [
  ...['1.0.0', '1.0.1'].flatMap((v) =>
    ['js', 'mjs', 'js.map', 'mjs.map', 'js.sri', 'mjs.sri'].map((e) => `v${v}.${e}`),
  ),
  // A stray file in the directory must never become servable: the route only
  // admits names matching v<x.y.z>.<ext>.
  'notes.txt',
]
vi.mock('node:fs/promises', () => ({
  readFile: (path: string, encoding: string) => readFileMock(path, encoding),
  readdir: async () => COMMITTED,
}))

vi.mock('h3', () => mockH3())

const handler = (await import('./[file].get')).default as unknown as (
  event: FakeEvent,
) => Promise<unknown>

// The latest build: the workspace dist in Nuxt dev, the Dockerfile's copy in
// the image. The published versions: the committed contract directory.
const WORKSPACE_DIST = resolve(process.cwd(), '../..', 'packages/saas-client/dist')
const IMAGE_DIST = resolve(process.cwd(), 'packages/saas-client/dist')
const CONTRACT_DIR = resolve(process.cwd(), 'sdk-contract')
const SHORT_CACHE = 'public, max-age=300'
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })

async function serve(file: string, body = '/* sdk bytes */') {
  readFileMock.mockResolvedValueOnce(body)
  const event = fakeEvent({ params: { file } })
  const result = await handler(event)
  return { event, result, path: readFileMock.mock.calls[0]![0] }
}

beforeEach(() => {
  readFileMock.mockReset()
})

describe('GET /client/[file]', () => {
  it('404s when the file name is missing', async () => {
    await expect(handler(fakeEvent({ params: {} }))).rejects.toMatchObject({ statusCode: 404 })
  })

  it.each([
    'evil.js',
    'v2.js',
    'v0.9.0.js', // a version that was never committed
    'v1.0.2.js', // a version that does not exist yet
    'v1.0.0.css', // a committed version, an extension the contract does not have
    'notes.txt', // a stray file that IS in the directory listing
    '../v1.js',
    '../v1.0.0.js',
  ])('404s for %s, which is not part of the public contract', async (file) => {
    await expect(handler(fakeEvent({ params: { file } }))).rejects.toMatchObject({
      statusCode: 404,
    })
    expect(readFileMock, `${file} must never reach the filesystem`).not.toHaveBeenCalled()
  })
})

describe('the latest build (v1.*)', () => {
  it('serves v1.js from the dist with a short cache and CORS *', async () => {
    const { event, result, path } = await serve('v1.js')
    expect(result).toBe('/* sdk bytes */')
    expect(path).toBe(resolve(WORKSPACE_DIST, 'index.umd.js'))
    expect(event.responseHeaders['content-type']).toBe('application/javascript')
    expect(event.responseHeaders['cache-control']).toBe(SHORT_CACHE)
    expect(event.responseHeaders['access-control-allow-origin']).toBe('*')
  })

  it('falls back to the dist the Dockerfile copies into the image', async () => {
    readFileMock.mockRejectedValueOnce(enoent()).mockResolvedValueOnce('/* image */')
    const result = await handler(fakeEvent({ params: { file: 'v1.js' } }))
    expect(result).toBe('/* image */')
    expect(readFileMock.mock.calls[1]![0]).toBe(resolve(IMAGE_DIST, 'index.umd.js'))
  })

  it('404s with a helpful build-the-SDK message when neither dist has the file', async () => {
    readFileMock.mockRejectedValue(enoent())
    await expect(handler(fakeEvent({ params: { file: 'v1.js' } }))).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: expect.stringContaining('saas-client build'),
    })
  })
})

describe('published contract versions (v<x.y.z>.*) — KH-991', () => {
  // 🔴 THE PROPERTY THIS WHOLE CHANGE EXISTS FOR. Before KH-991 the versioned
  // URL was served from the dist, so it only existed for the CURRENT contract:
  // after the bump to 1.0.1, /client/v1.0.0.js would have been a 404 and every
  // SRI pin on it broken. It must come from the COMMITTED file instead.
  it('keeps serving v1.0.0.js after the bump, from the committed file, not the dist', async () => {
    const { event, path } = await serve('v1.0.0.js')
    expect(path).toBe(resolve(CONTRACT_DIR, 'v1.0.0.js'))
    expect(path.startsWith(WORKSPACE_DIST) || path.startsWith(IMAGE_DIST)).toBe(false)
    expect(event.responseHeaders['cache-control']).toBe(IMMUTABLE_CACHE)
  })

  it('serves the current version (v1.0.1) from its committed file too', async () => {
    const { path } = await serve('v1.0.1.js')
    expect(path).toBe(resolve(CONTRACT_DIR, 'v1.0.1.js'))
  })

  it.each([
    ['v1.0.0.mjs', 'application/javascript'],
    ['v1.0.0.js.map', 'application/json'],
    ['v1.0.0.mjs.map', 'application/json'],
    ['v1.0.0.js.sri', 'text/plain'],
    ['v1.0.0.mjs.sri', 'text/plain'],
    ['v1.0.1.mjs.sri', 'text/plain'],
  ])('serves %s as %s, immutably, from the committed directory', async (file, contentType) => {
    const { event, path } = await serve(file)
    expect(path).toBe(resolve(CONTRACT_DIR, file))
    expect(event.responseHeaders['content-type']).toBe(contentType)
    expect(event.responseHeaders['cache-control']).toBe(IMMUTABLE_CACHE)
    expect(event.responseHeaders['access-control-allow-origin']).toBe('*')
  })
})
