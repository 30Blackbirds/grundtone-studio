import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3, PROJECT, ORG, SESSION } from '~~/tests/helpers/endpoint-fixtures'

vi.mock('h3', () => mockH3())

const stored: string[] = []
vi.mock('~~/server/lib/storage', () => ({
  paths: (projectId: string) => ({ draftAsset: (name: string) => `p/${projectId}/draft/${name}` }),
  putObject: (key: string) => {
    stored.push(key)
    return Promise.resolve()
  },
}))

// Upload validation has its own tests (asset-upload); here it is only switched.
let valid = true
vi.mock('~~/server/lib/asset-upload', () => ({
  validateLogoUpload: (body: Buffer) =>
    valid
      ? { ok: true, type: 'png', contentType: 'image/png', body }
      : { ok: false, error: 'unsupported_format' },
}))

const requireProjectAccess = vi.fn()
vi.mock('~~/server/lib/project-access', () => ({
  requireProjectAccess: (...args: unknown[]) => requireProjectAccess(...args),
}))

const auditEvents: Array<{ action: string; payload: Record<string, unknown> }> = []
vi.mock('~~/server/lib/audit', () => ({
  recordAuditEvent: (_event: unknown, payload: { action: string }) => {
    auditEvents.push({ action: payload.action, payload })
    return Promise.resolve()
  },
}))

const handler = (await import('./logo.post')).default as unknown as (
  event: unknown,
) => Promise<{ file: string; type: string }>

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
const upload = () =>
  handler(
    fakeEvent({
      params: { projectId: PROJECT.id },
      body: PNG,
      context: { auth: { sub: SESSION.user.id, tenant: ORG.id, email: SESSION.user.email } },
    }),
  )

beforeEach(() => {
  valid = true
  stored.length = 0
  auditEvents.length = 0
  requireProjectAccess.mockReset()
  requireProjectAccess.mockResolvedValue({
    userId: SESSION.user.id,
    project: PROJECT,
    organization: ORG,
    role: 'editor',
  })
})

describe('POST assets/logo — audit (riff mfhvuk8515gubxh30puab9ch)', () => {
  it('audits exactly one asset.logo_uploaded after the file is stored — never the bytes', async () => {
    await expect(upload()).resolves.toEqual({ file: 'logo.png', type: 'png' })

    expect(stored).toEqual([`p/${PROJECT.id}/draft/logo.png`])
    expect(auditEvents).toHaveLength(1)
    expect(auditEvents[0].payload).toMatchObject({
      organizationId: ORG.id,
      action: 'asset.logo_uploaded',
      targetId: PROJECT.id,
      targetLabel: PROJECT.name,
      after: { file: 'logo.png', type: 'png' },
    })
    expect(JSON.stringify(auditEvents[0].payload)).not.toContain('PNG')
  })

  it('an invalid file (400) stores and audits nothing', async () => {
    valid = false
    await expect(upload()).rejects.toMatchObject({ statusCode: 400 })
    expect(stored).toHaveLength(0)
    expect(auditEvents).toHaveLength(0)
  })

  it('a caller without editor access (403) stores and audits nothing', async () => {
    requireProjectAccess.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { statusCode: 403 }),
    )
    await expect(upload()).rejects.toMatchObject({ statusCode: 403 })
    expect(stored).toHaveLength(0)
    expect(auditEvents).toHaveLength(0)
  })
})
