import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3, type FakeEvent } from '~~/tests/helpers/endpoint-fixtures'

// Each test sets up the rows it wants the handler to see. The db mock is the
// same shape as the real Drizzle chain — select().from().innerJoin().where()
// resolves to whatever the current test pushed in.
interface KeyRow {
  projectId: string
  organizationId: string
  allowedOrigins: string[]
  rateLimit: number
}
let nextDbRows: KeyRow[] = []
// Suspension rows (kontrakt §8a): select().from().where() without innerJoin
// resolves to these — empty = org not suspended.
let nextSuspensionRows: { cdnGraceUntil: Date }[] = []

// Storage map: tests pre-set the bytes that getObjectAsString should return
// for each blob key. Missing key → null (handler returns 404).
const storage = new Map<string, string>()

vi.mock('h3', () => mockH3())
vi.mock('drizzle-orm', () => ({
  and: () => null,
  eq: () => null,
  isNull: () => null,
}))
vi.mock('~~/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => Promise.resolve(nextDbRows),
        }),
        where: () => Promise.resolve(nextSuspensionRows),
      }),
    }),
  },
}))
vi.mock('~~/server/db/schema', () => ({
  apiKey: {
    projectId: 'project_id',
    allowedOrigins: 'allowed_origins',
    rateLimit: 'rate_limit',
    keyHash: 'key_hash',
    revokedAt: 'revoked_at',
  },
  project: { id: 'id', organizationId: 'organization_id' },
  orgSuspension: { organizationId: 'organization_id', cdnGraceUntil: 'cdn_grace_until' },
}))
vi.mock('~~/server/lib/storage', () => ({
  paths: (projectId: string) => ({
    currentJson: `p/${projectId}/current.json`,
    currentCss: `p/${projectId}/current.css`,
    currentAsset: (name: string) => `p/${projectId}/current/${name}`,
  }),
  getObjectAsString: (key: string) => Promise.resolve(storage.get(key) ?? null),
  getObjectAsBuffer: (key: string) => {
    const v = storage.get(key)
    return Promise.resolve(v === undefined ? null : Buffer.from(v))
  },
}))

const handler = (await import('./[...file].get')).default as unknown as (
  event: FakeEvent,
) => Promise<unknown>

// Distinct key + projectId per test isolates the module-scoped TTLCache +
// sliding-window rate limiter that the handler stitches across calls.
let testCounter = 0
function fresh(opts: Partial<KeyRow> = {}): { key: string; projectId: string; row: KeyRow } {
  testCounter += 1
  const key = `pk_test_${testCounter.toString().padStart(4, '0')}`
  const projectId = `proj-${testCounter}`
  const row: KeyRow = {
    projectId,
    organizationId: `org-${testCounter}`,
    allowedOrigins: opts.allowedOrigins ?? [],
    rateLimit: opts.rateLimit ?? 1000,
  }
  return { key, projectId, row }
}

beforeEach(() => {
  nextDbRows = []
  nextSuspensionRows = []
  storage.clear()
})

describe('GET /k/[key]/[file]', () => {
  it('404s when key or file is missing', async () => {
    await expect(handler(fakeEvent({ params: {} }))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('404s on a file name outside the allowlist', async () => {
    await expect(
      handler(fakeEvent({ params: { key: 'pk_test_x', file: 'evil.js' } })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('401s when the API key hash does not resolve to a row', async () => {
    nextDbRows = [] // no matching row → 401
    await expect(
      handler(fakeEvent({ params: { key: 'pk_test_unknown', file: 'tokens.json' } })),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('404s when the storage blob is missing (project not published yet)', async () => {
    const { key, row } = fresh()
    nextDbRows = [row]
    await expect(
      handler(fakeEvent({ params: { key, file: 'tokens.json' } })),
    ).rejects.toMatchObject({ statusCode: 404, message: expect.stringContaining('Not published') })
  })

  it('returns tokens.json with content-type, cache-control, CORS and an ETag', async () => {
    const { key, projectId, row } = fresh()
    nextDbRows = [row]
    storage.set(`p/${projectId}/current.json`, '{"colors":{"primary":"#000"}}')
    const event = fakeEvent({ params: { key, file: 'tokens.json' } })
    const body = await handler(event)
    expect(body).toBe('{"colors":{"primary":"#000"}}')
    expect(event.responseHeaders['content-type']).toBe('application/json')
    expect(event.responseHeaders['cache-control']).toBe('public, max-age=60, must-revalidate')
    expect(event.responseHeaders['access-control-allow-origin']).toBe('*')
    expect(event.responseHeaders.etag).toMatch(/^"[a-f0-9]{16}"$/)
  })

  it('returns tokens.css with the CSS content-type', async () => {
    const { key, projectId, row } = fresh()
    nextDbRows = [row]
    storage.set(`p/${projectId}/current.css`, ':root{--color-primary:#000}')
    const event = fakeEvent({ params: { key, file: 'tokens.css' } })
    await handler(event)
    expect(event.responseHeaders['content-type']).toBe('text/css')
  })

  it('reflects the request Origin into the CORS header and Vary: Origin', async () => {
    const { key, projectId, row } = fresh({ allowedOrigins: ['acme.com'] })
    nextDbRows = [row]
    storage.set(`p/${projectId}/current.json`, '{}')
    const event = fakeEvent({
      params: { key, file: 'tokens.json' },
      headers: { origin: 'https://acme.com' },
    })
    await handler(event)
    expect(event.responseHeaders['access-control-allow-origin']).toBe('https://acme.com')
    expect(event.responseHeaders.vary).toBe('Origin')
  })

  it('responds 304 when If-None-Match matches the served ETag', async () => {
    const { key, projectId, row } = fresh()
    nextDbRows = [row]
    storage.set(`p/${projectId}/current.json`, '{"v":1}')

    // First call: populate caches and capture the ETag we'll echo back.
    const first = fakeEvent({ params: { key, file: 'tokens.json' } })
    await handler(first)
    const etag = first.responseHeaders.etag
    expect(etag).toBeTruthy()

    // Second call with the same ETag should short-circuit to 304 + empty body.
    const second = fakeEvent({
      params: { key, file: 'tokens.json' },
      headers: { 'if-none-match': etag },
    })
    const body = await handler(second)
    expect(body).toBe('')
    expect(second.responseStatus).toBe(304)
  })

  it('403s when the request Origin is not in the allowlist', async () => {
    const { key, projectId, row } = fresh({ allowedOrigins: ['acme.com'] })
    nextDbRows = [row]
    storage.set(`p/${projectId}/current.json`, '{}')
    await expect(
      handler(
        fakeEvent({
          params: { key, file: 'tokens.json' },
          headers: { origin: 'https://evil.example' },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('accepts wildcard subdomains via *.host patterns', async () => {
    const { key, projectId, row } = fresh({ allowedOrigins: ['*.acme.com'] })
    nextDbRows = [row]
    storage.set(`p/${projectId}/current.json`, '{}')
    const event = fakeEvent({
      params: { key, file: 'tokens.json' },
      headers: { origin: 'https://studio.acme.com' },
    })
    await expect(handler(event)).resolves.toBeTruthy()
  })

  it('keeps serving a suspended org while the CDN grace window is open', async () => {
    const { key, projectId, row } = fresh()
    nextDbRows = [row]
    nextSuspensionRows = [{ cdnGraceUntil: new Date(Date.now() + 60_000) }]
    storage.set(`p/${projectId}/current.json`, '{}')
    await expect(handler(fakeEvent({ params: { key, file: 'tokens.json' } }))).resolves.toBeTruthy()
  })

  it('410s once the CDN grace window has passed (ToS §10.2)', async () => {
    const { key, projectId, row } = fresh()
    nextDbRows = [row]
    nextSuspensionRows = [{ cdnGraceUntil: new Date(Date.now() - 1_000) }]
    storage.set(`p/${projectId}/current.json`, '{}')
    await expect(
      handler(fakeEvent({ params: { key, file: 'tokens.json' } })),
    ).rejects.toMatchObject({ statusCode: 410 })
  })

  it('429s after the per-key rate limit is exceeded', async () => {
    const { key, projectId, row } = fresh({ rateLimit: 2 })
    nextDbRows = [row]
    storage.set(`p/${projectId}/current.json`, '{}')

    // Two requests inside the limit succeed.
    await handler(fakeEvent({ params: { key, file: 'tokens.json' } }))
    await handler(fakeEvent({ params: { key, file: 'tokens.json' } }))

    // Third request trips the sliding window — handler raises 429 with a
    // Retry-After header so a well-behaved client can back off.
    const overLimit = fakeEvent({ params: { key, file: 'tokens.json' } })
    await expect(handler(overLimit)).rejects.toMatchObject({ statusCode: 429 })
    expect(overLimit.responseHeaders['retry-after']).toMatch(/^\d+$/)
  })

  // 🔴 SIK-010: denne assertion er ikke kosmetik. Fire kendte SVG-vektorer
  // (svg/onload, svg:script, SMIL animate/set) er inerte ALENE fordi dette
  // header sættes — saniteringen fanger dem ikke alle. Fjernes headeret,
  // bliver de til stored XSS på app-originet hvor session-cookies bor.
  // Se svg-sanitize.ts' filhoved. Testen skal fejle FØR en kunde opdager det.
  it('serves logo.svg from current/ with CSP sandbox + nosniff (brand-assets)', async () => {
    const { key, projectId, row } = fresh()
    nextDbRows = [row]
    storage.set(`p/${projectId}/current/logo.svg`, '<svg viewBox="0 0 24 24"/>')
    const event = fakeEvent({ params: { key, file: 'logo.svg' } })
    const body = (await handler(event)) as Buffer
    expect(Buffer.isBuffer(body)).toBe(true)
    expect(body.toString()).toContain('<svg')
    expect(event.responseHeaders['content-type']).toBe('image/svg+xml')
    expect(event.responseHeaders['content-security-policy']).toBe("sandbox; default-src 'none'")
    expect(event.responseHeaders['x-content-type-options']).toBe('nosniff')
    expect(event.responseHeaders.etag).toMatch(/^"[a-f0-9]{16}"$/)
  })

  it('serves custom font files under fonts/ with the woff2 content type', async () => {
    const { key, projectId, row } = fresh()
    nextDbRows = [row]
    storage.set(`p/${projectId}/current/fonts/asp-grotesk-400.woff2`, 'wOF2....')
    const event = fakeEvent({
      params: { key, file: 'fonts/asp-grotesk-400.woff2' },
      headers: { origin: 'https://acme.example' },
    })
    await handler(event)
    expect(event.responseHeaders['content-type']).toBe('font/woff2')
    expect(event.responseHeaders['x-content-type-options']).toBe('nosniff')
  })

  it('404s traversal-shaped and off-pattern asset paths', async () => {
    const { key, row } = fresh()
    nextDbRows = [row]
    for (const file of [
      'fonts/../../secrets.txt',
      'fonts/Æblegrød.woff2',
      'logo.gif',
      'current.json',
      'fonts/x.ttf',
    ]) {
      await expect(handler(fakeEvent({ params: { key, file } }))).rejects.toMatchObject({
        statusCode: 404,
      })
    }
  })

  it('does NOT add CSP/nosniff headers on token files (uændret kontrakt)', async () => {
    const { key, projectId, row } = fresh()
    nextDbRows = [row]
    storage.set(`p/${projectId}/current.json`, '{"colors":{}}')
    const event = fakeEvent({ params: { key, file: 'tokens.json' } })
    await handler(event)
    expect(event.responseHeaders['content-security-policy']).toBeUndefined()
  })

  // [infra] kunne ikke ramme et FAKTISK asset-svar gennem CDN'en (ingen
  // gyldig tenant-sti med et uploadet logo — featuren er ny og ubrugt), og
  // noterede ærligt at "header-sætning kan i princippet variere pr.
  // respons-vej". Denne test lukker netop det hul stærkere end ét curl ville:
  // den går ALLE asset-veje igennem, ikke bare den ene nogen tilfældigvis
  // rammer. Falder én af dem ud af CSP-stien, bliver det rødt her.
  it.each([
    ['logo.svg', 'image/svg+xml'],
    ['logo.png', 'image/png'],
    ['fonts/heading-inter-400.woff2', 'font/woff2'],
    ['fonts/body-asp-grotesk-700.woff2', 'font/woff2'],
  ])('every asset response path carries CSP + nosniff: %s', async (file, contentType) => {
    const { key, projectId, row } = fresh()
    nextDbRows = [row]
    storage.set(`p/${projectId}/current/${file}`, 'x')
    // Origin med på alle veje: sådan ser et rigtigt browser-kald ud, og fonte
    // KRÆVER headeren (SIK-011). At logo/tokens også virker UDEN den er
    // dækket separat nedenfor — undtagelsen er bevidst, ikke et hul.
    const event = fakeEvent({ params: { key, file }, headers: { origin: 'https://acme.example' } })
    await handler(event)
    expect(event.responseHeaders['content-type']).toBe(contentType)
    expect(event.responseHeaders['content-security-policy']).toBe("sandbox; default-src 'none'")
    expect(event.responseHeaders['x-content-type-options']).toBe('nosniff')
  })

  // ─── SIK-011: fonte kræver Origin ([jura] 2026-08-05) ────────────────────
  //
  // Grænsen er LICENS-OMFANG, ikke fortrolighed: kunden erklærer ved upload
  // at vi må distribuere fonten til "de brugere, der besøger mine brands",
  // og et header-løst kald er ikke det. Testene under her holder BEGGE sider
  // af snittet fast — både at fonte afvises, og at tokens/logo bevidst IKKE
  // gør det. Uden den anden halvdel kunne en fremtidig "konsistens-oprydning"
  // udvide kravet til hele endpointet og brække build-time-hentning af
  // tokens.json, uden at noget blev rødt.
  it('403s a font request with no Origin header (uden for kundens erklæring)', async () => {
    const { key, projectId, row } = fresh()
    nextDbRows = [row]
    storage.set(`p/${projectId}/current/fonts/asp-grotesk-400.woff2`, 'wOF2....')
    await expect(
      handler(fakeEvent({ params: { key, file: 'fonts/asp-grotesk-400.woff2' } })),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  // Beskeden er ikke kosmetik, og den er derfor pinnet. MÅLT: en
  // `<link rel=preload as=font>` UDEN crossorigin hentes i no-cors-mode og
  // sender intet Origin — så netop de kunder rammer denne 403. Uden
  // `crossorigin` i teksten kan de ikke se hvad de skal gøre, og en 403 uden
  // handlingsanvisning på en offentlig flade bliver en supportsag.
  it('tells the caller HOW to fix it — the 403 names crossorigin', async () => {
    const { key, projectId, row } = fresh()
    nextDbRows = [row]
    storage.set(`p/${projectId}/current/fonts/asp-grotesk-400.woff2`, 'wOF2....')
    // Læser property'en direkte: `statusMessage` er ikke enumerable på H3Error,
    // så toMatchObject ser den ikke og ville bestå uanset indhold.
    const err = (await handler(
      fakeEvent({ params: { key, file: 'fonts/asp-grotesk-400.woff2' } }),
    ).catch((e: unknown) => e)) as { statusCode: number; statusMessage: string }
    expect(err.statusCode).toBe(403)
    expect(err.statusMessage).toContain('crossorigin')
  })

  it('serves the same font once an Origin is present', async () => {
    const { key, projectId, row } = fresh()
    nextDbRows = [row]
    storage.set(`p/${projectId}/current/fonts/asp-grotesk-400.woff2`, 'wOF2....')
    const event = fakeEvent({
      params: { key, file: 'fonts/asp-grotesk-400.woff2' },
      headers: { origin: 'https://acme.example' },
    })
    await expect(handler(event)).resolves.toBeTruthy()
    expect(event.responseHeaders['content-type']).toBe('font/woff2')
  })

  it.each(['tokens.json', 'tokens.css', 'logo.svg', 'logo.png'])(
    'keeps serving %s WITHOUT an Origin — server-til-server er tilladt her',
    async (file) => {
      const { key, projectId, row } = fresh()
      nextDbRows = [row]
      const blob = file.startsWith('tokens.')
        ? `p/${projectId}/current.${file.split('.')[1]}`
        : `p/${projectId}/current/${file}`
      storage.set(blob, '{}')
      await expect(handler(fakeEvent({ params: { key, file } }))).resolves.toBeTruthy()
    },
  )

  it('still applies the origin allowlist to fonts when one is configured', async () => {
    const { key, projectId, row } = fresh({ allowedOrigins: ['acme.com'] })
    nextDbRows = [row]
    storage.set(`p/${projectId}/current/fonts/asp-grotesk-400.woff2`, 'wOF2....')
    await expect(
      handler(
        fakeEvent({
          params: { key, file: 'fonts/asp-grotesk-400.woff2' },
          headers: { origin: 'https://evil.example' },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})
