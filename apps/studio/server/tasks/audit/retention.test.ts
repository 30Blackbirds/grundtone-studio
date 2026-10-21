import { beforeEach, describe, expect, it, vi } from 'vitest'

// The task wrapper's one job beyond calling the lib: a failed run must be
// COUNTED and must still FAIL. Swallowing it would turn a broken retention
// promise into silence.
const applyAuditRetention = vi.fn()
const recordAuditRetentionRun = vi.fn()
vi.mock('~~/server/lib/audit-retention', () => ({ applyAuditRetention }))
vi.mock('~~/server/lib/metrics', () => ({ recordAuditRetentionRun }))
vi.stubGlobal('defineTask', (t: unknown) => t)

const task = (await import('./retention')).default as unknown as {
  meta: { name: string }
  run: () => Promise<unknown>
}

describe('audit:retention task', () => {
  beforeEach(() => {
    applyAuditRetention.mockReset()
    recordAuditRetentionRun.mockReset()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('is registered under the name nuxt.config schedules', () => {
    expect(task.meta.name).toBe('audit:retention')
  })

  it('records an ok run with its counts', async () => {
    const result = { stripped: 3, deleted: 1 }
    applyAuditRetention.mockResolvedValue(result)
    await expect(task.run()).resolves.toEqual({ result })
    expect(recordAuditRetentionRun).toHaveBeenCalledWith('ok', result)
  })

  it('🔴 counts a failed run AND rethrows it', async () => {
    applyAuditRetention.mockRejectedValue(new Error('db down'))
    await expect(task.run()).rejects.toThrow('db down')
    expect(recordAuditRetentionRun).toHaveBeenCalledWith('failed')
  })
})
