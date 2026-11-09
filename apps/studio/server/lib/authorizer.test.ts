import { afterEach, describe, expect, it, vi } from 'vitest'

// Which implementation answers is decided by AUTHORIZER alone.

const pdpCheck = vi.fn(async () => 'allowed' as const)
const localCheck = vi.fn(async () => 'denied' as const)

vi.mock('./pdp', () => ({ checkProject: pdpCheck }))
vi.mock('./local-authorizer', () => ({ localAuthorizer: { checkProject: localCheck } }))

const { checkProject } = await import('./authorizer')
const event = {} as never

describe('authorizer()', () => {
  afterEach(() => {
    process.env.AUTHORIZER = 'pdp'
    pdpCheck.mockClear()
    localCheck.mockClear()
  })

  it('AUTHORIZER=pdp asks pdp.ts and nothing else', async () => {
    process.env.AUTHORIZER = 'pdp'
    await expect(checkProject(event, 'p1', 'can_view')).resolves.toBe('allowed')
    expect(pdpCheck).toHaveBeenCalledOnce()
    expect(localCheck).not.toHaveBeenCalled()
  })

  it('AUTHORIZER=local asks the local authorizer and nothing else', async () => {
    process.env.AUTHORIZER = 'local'
    await expect(checkProject(event, 'p1', 'can_view')).resolves.toBe('denied')
    expect(localCheck).toHaveBeenCalledOnce()
    expect(pdpCheck).not.toHaveBeenCalled()
  })

  // 🔴 A request with no chosen authorizer is refused, not decided by one.
  it('an unset AUTHORIZER refuses the request and asks neither', async () => {
    delete process.env.AUTHORIZER
    expect(() => checkProject(event, 'p1', 'can_view')).toThrow(/AUTHORIZER is unset/)
    expect(pdpCheck).not.toHaveBeenCalled()
    expect(localCheck).not.toHaveBeenCalled()
  })
})
