// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

describe('solveAltchaChallenge', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('solves a challenge and returns the base64 solution payload', async () => {
    const salt = 'deadbeef'
    const number = 42
    const signature = 'sig-abc'
    const challenge = await sha256Hex(salt + number)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ algorithm: 'SHA-256', challenge, salt, signature, maxnumber: 1000 }),
      }),
    )

    const { solveAltchaChallenge } = await import('~~/composables/useAltcha')
    const solution = await solveAltchaChallenge()

    expect(solution).not.toBe('')
    const payload = JSON.parse(atob(solution))
    expect(payload).toEqual({ algorithm: 'SHA-256', challenge, number, salt, signature })
  })

  it('degrades gracefully to empty string when the challenge endpoint 404s (gate off)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))

    const { solveAltchaChallenge } = await import('~~/composables/useAltcha')
    await expect(solveAltchaChallenge()).resolves.toBe('')
  })

  it('degrades gracefully when the fetch itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const { solveAltchaChallenge } = await import('~~/composables/useAltcha')
    await expect(solveAltchaChallenge()).resolves.toBe('')
  })
})
