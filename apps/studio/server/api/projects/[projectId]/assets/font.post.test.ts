import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3, PROJECT, ORG, SESSION } from '~~/tests/helpers/endpoint-fixtures'

// Bevis-sporet for font-licens-erklæringen (jura-ruling 2026-08-04). Reglen
// er at endpointet — ikke UI'et — er gaten, og at ingen fil kan lande i
// storage uden en persisteret erklæring. Testene pinner præcis det.

const inserted: Array<Record<string, unknown>> = []
const stored: string[] = []

vi.mock('h3', () => mockH3())
vi.mock('~~/server/db', () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v)
        return Promise.resolve()
      },
    }),
  },
}))
vi.mock('~~/server/db/schema', () => ({
  fontLicenceAttestation: { _: { name: 'font_licence_attestation' } },
}))
vi.mock('~~/server/lib/storage', () => ({
  paths: (projectId: string) => ({ draftAsset: (name: string) => `p/${projectId}/draft/${name}` }),
  putObject: (key: string) => {
    stored.push(key)
    return Promise.resolve()
  },
}))

const auditEvents: Array<{ action: string; payload: Record<string, unknown> }> = []
vi.mock('~~/server/lib/audit', () => ({
  recordAuditEvent: (_event: unknown, payload: { action: string }) => {
    auditEvents.push({ action: payload.action, payload })
    return Promise.resolve()
  },
}))

const requireProjectAccess = vi.fn()
vi.mock('~~/server/lib/project-access', () => ({
  requireProjectAccess: (...args: unknown[]) => requireProjectAccess(...args),
}))

const handler = (await import('./font.post')).default as unknown as (
  event: unknown,
) => Promise<unknown>

const WOFF2 = Buffer.concat([Buffer.from('wOF2', 'ascii'), Buffer.alloc(32)])
const VALID_QUERY = {
  slot: 'body',
  family: 'Asp Grotesk',
  weight: '400',
  licenceVersion: 'studio-font-licence-1.0',
  licenceAcceptedAt: '2026-08-04T12:00:00.000Z',
}

function upload(query: Record<string, string>, body: Buffer = WOFF2) {
  return handler(
    fakeEvent({
      params: { projectId: PROJECT.id },
      query,
      body,
      context: { auth: { sub: SESSION.user.id, tenant: ORG.id, email: SESSION.user.email } },
    }),
  )
}

beforeEach(() => {
  inserted.length = 0
  stored.length = 0
  auditEvents.length = 0
  requireProjectAccess.mockReset()
  requireProjectAccess.mockResolvedValue({
    userId: SESSION.user.id,
    project: PROJECT,
    organization: ORG,
    role: 'admin',
    source: 'org',
    orgRole: 'owner',
    projectRole: null,
  })
})

describe('POST assets/font — licence attestation gate', () => {
  it('400s without the attestation, and stores NOTHING', async () => {
    const { licenceVersion: _v, licenceAcceptedAt: _a, ...noAttestation } = VALID_QUERY
    await expect(upload(noAttestation)).rejects.toMatchObject({ statusCode: 400 })
    expect(stored).toHaveLength(0)
    expect(inserted).toHaveLength(0)
  })

  it('400s on an unknown licence version — we would not know what the user saw', async () => {
    await expect(
      upload({ ...VALID_QUERY, licenceVersion: 'studio-font-licence-0.9' }),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(stored).toHaveLength(0)
  })

  it('400s on a malformed acceptance timestamp', async () => {
    await expect(upload({ ...VALID_QUERY, licenceAcceptedAt: 'yesterday' })).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(inserted).toHaveLength(0)
  })

  it('persists the proof BEFORE the file, with everything needed to identify it later', async () => {
    await upload(VALID_QUERY)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      projectId: PROJECT.id,
      organizationId: ORG.id,
      slot: 'body',
      file: 'fonts/body-asp-grotesk-400.woff2',
      weight: 400,
      family: 'Asp Grotesk',
      version: 'studio-font-licence-1.0',
      userId: SESSION.user.id,
    })
    // Tidsstemplet gemmes som afgivet af klienten (afkrydsnings-tidspunktet),
    // ikke som serverens now() — beviset er hvornår BRUGEREN erklærede.
    expect((inserted[0].acceptedAt as Date).toISOString()).toBe('2026-08-04T12:00:00.000Z')
    expect(stored).toEqual([`p/${PROJECT.id}/draft/fonts/body-asp-grotesk-400.woff2`])
  })

  it('records a fresh proof per file — a second upload does not reuse the first', async () => {
    await upload(VALID_QUERY)
    await upload({ ...VALID_QUERY, weight: '700', licenceAcceptedAt: '2026-08-04T12:05:00.000Z' })
    expect(inserted).toHaveLength(2)
    expect(inserted.map((r) => r.file)).toEqual([
      'fonts/body-asp-grotesk-400.woff2',
      'fonts/body-asp-grotesk-700.woff2',
    ])
    expect((inserted[1].acceptedAt as Date).toISOString()).toBe('2026-08-04T12:05:00.000Z')
  })

  it('still rejects non-woff2 payloads after the attestation passes', async () => {
    await expect(upload(VALID_QUERY, Buffer.from('not a font'))).rejects.toMatchObject({
      statusCode: 400,
    })
    // Erklæringen må gerne være skrevet (harmløst) — filen må ikke være det.
    expect(stored).toHaveLength(0)
  })
  it('audits exactly one asset.font_uploaded after the proof and the file are stored — never the bytes', async () => {
    await upload(VALID_QUERY)

    expect(inserted).toHaveLength(1)
    expect(stored).toHaveLength(1)
    expect(auditEvents).toHaveLength(1)
    expect(auditEvents[0].payload).toMatchObject({
      organizationId: ORG.id,
      action: 'asset.font_uploaded',
      targetId: PROJECT.id,
      after: { slot: 'body', family: 'Asp Grotesk', weight: 400 },
    })
    expect(JSON.stringify(auditEvents[0].payload)).not.toContain('wOF2')
  })

  it('audits nothing when the upload is rejected', async () => {
    const { licenceVersion: _v, ...withoutLicence } = VALID_QUERY
    await expect(upload(withoutLicence)).rejects.toMatchObject({ statusCode: 400 })
    await expect(upload(VALID_QUERY, Buffer.from('not a font'))).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(auditEvents).toHaveLength(0)
  })
})
