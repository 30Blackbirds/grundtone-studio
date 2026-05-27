import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// createTheme is mocked so the test verifies the SDK's wiring (URL build,
// fetch, apply, onLoad/onError plumbing) without coupling to the upstream
// @grundtone/core theme shape.
vi.mock('@grundtone/core', () => ({
  createTheme: ({ light, dark }: { light: unknown; dark: unknown }) => ({
    light: { ...(light as object), mode: 'light' },
    dark: { ...(dark as object), mode: 'dark' },
  }),
}))

// applyThemeToDOM is mocked to a spy. The real impl is covered separately in
// applyThemeToDOM.test.ts — this test cares about whether the loader calls
// it with the right inputs.
const applySpy = vi.fn()
vi.mock('./applyThemeToDOM', () => ({
  applyThemeToDOM: (...args: unknown[]) => applySpy(...args),
}))

import { loadByApiKey, grundtone, VERSION } from './index'

const fetchMock = vi.fn()

beforeEach(() => {
  applySpy.mockReset()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  document.documentElement.removeAttribute('style')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  } as Response
}

const TOKENS = { colors: { primary: '#4F46E5' } }

describe('loadByApiKey', () => {
  it('exports a VERSION string', () => {
    expect(typeof VERSION).toBe('string')
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('rejects when apiKey is missing', async () => {
    await expect(loadByApiKey({ apiKey: '' })).rejects.toThrow(/apiKey is required/)
  })

  it('fetches tokens.json from the default CDN base, URL-encoding the api key', async () => {
    fetchMock.mockResolvedValueOnce(okJson(TOKENS))
    await loadByApiKey({ apiKey: 'pk_live_abc/with spaces' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://cdn.grundtone.io/k/pk_live_abc%2Fwith%20spaces/tokens.json')
    expect((init as RequestInit).headers).toMatchObject({ Accept: 'application/json' })
  })

  it('uses cdnBase when provided and strips a trailing slash', async () => {
    fetchMock.mockResolvedValueOnce(okJson(TOKENS))
    await loadByApiKey({ apiKey: 'pk_live_x', cdnBase: 'https://studio.local/' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://studio.local/k/pk_live_x/tokens.json')
  })

  it('throws when the CDN responds non-2xx, surfacing the status code', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as Response)
    await expect(loadByApiKey({ apiKey: 'pk_live_x' })).rejects.toThrow(/401 Unauthorized/)
  })

  it('applies the fetched tokens via applyThemeToDOM and reports the chosen mode', async () => {
    fetchMock.mockResolvedValueOnce(okJson(TOKENS))
    const result = await loadByApiKey({ apiKey: 'pk_live_x' })
    expect(result.tokens).toEqual(TOKENS)
    expect(result.mode).toBe('light')
    // applyThemeToDOM is called with the light theme variant from createTheme
    // and no explicit target (so it defaults to document.documentElement).
    expect(applySpy).toHaveBeenCalledTimes(1)
    const [theme, target] = applySpy.mock.calls[0]
    expect((theme as { mode: string }).mode).toBe('light')
    expect(target).toBeUndefined()
  })

  it('passes a custom target element through to applyThemeToDOM', async () => {
    fetchMock.mockResolvedValueOnce(okJson(TOKENS))
    const target = document.createElement('div')
    await loadByApiKey({ apiKey: 'pk_live_x', target })
    expect(applySpy.mock.calls[0][1]).toBe(target)
  })

  it('switches to the dark theme when mode: "dark" is requested', async () => {
    fetchMock.mockResolvedValueOnce(okJson(TOKENS))
    const result = await loadByApiKey({ apiKey: 'pk_live_x', mode: 'dark' })
    expect(result.mode).toBe('dark')
    expect((applySpy.mock.calls[0][0] as { mode: string }).mode).toBe('dark')
  })

  it('mode: "auto" honors prefers-color-scheme: dark via matchMedia', async () => {
    fetchMock.mockResolvedValueOnce(okJson(TOKENS))
    const matchMediaMock = vi.fn().mockReturnValue({ matches: true })
    vi.stubGlobal('matchMedia', matchMediaMock)
    const result = await loadByApiKey({ apiKey: 'pk_live_x', mode: 'auto' })
    expect(matchMediaMock).toHaveBeenCalledWith('(prefers-color-scheme: dark)')
    expect(result.mode).toBe('dark')
  })

  it('fires onLoad with the raw tokens on success', async () => {
    fetchMock.mockResolvedValueOnce(okJson(TOKENS))
    const onLoad = vi.fn()
    await loadByApiKey({ apiKey: 'pk_live_x', onLoad })
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(onLoad.mock.calls[0][0]).toEqual(TOKENS)
  })
})

describe('grundtone Vue plugin', () => {
  it('install() triggers loadByApiKey and is non-blocking', async () => {
    fetchMock.mockResolvedValueOnce(okJson(TOKENS))
    grundtone.install({}, { apiKey: 'pk_live_x' })
    // Plugin doesn't await — give the microtask queue a tick so the fetch
    // call lands before the assertion.
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('routes fetch failures to options.onError when provided', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'oops' } as Response)
    const onError = vi.fn()
    grundtone.install({}, { apiKey: 'pk_live_x', onError })
    await new Promise((r) => setTimeout(r, 0))
    expect(onError).toHaveBeenCalledTimes(1)
    expect((onError.mock.calls[0][0] as Error).message).toMatch(/500/)
  })
})
