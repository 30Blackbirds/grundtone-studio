import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeEvent, mockH3, PROJECT, ORG } from '~~/tests/helpers/endpoint-fixtures'

// First cells for this endpoint (869fbuf68). It is a thin door onto
// lib/save-draft.ts, so the AUDIT belongs to that module and is measured in
// save-draft.test.ts. What is measured HERE is the door: the role bar, the
// validation, and that it hands saveDraft exactly what it was given.
//
// 🔴 A DELEGATION CELL IS NOT AN AUDIT CELL, and splitting them is the point.
// Before save-draft.test.ts existed, `config.draft_saved` was proven nowhere —
// both doors delegate, so endpoint cells asserting only the delegation would
// have left the event itself unmeasured while looking like coverage.

vi.mock('h3', () => mockH3())
vi.stubGlobal('defineRouteMeta', () => {})

const requireProjectAccess = vi.fn()
vi.mock('~~/server/lib/project-access', () => ({
  requireProjectAccess: (...a: unknown[]) => requireProjectAccess(...a),
}))

const saveDraft = vi.fn()
vi.mock('~~/server/lib/save-draft', () => ({
  saveDraft: (...a: unknown[]) => saveDraft(...a),
}))

// The REAL schema. Mocking it would make the 400 cell measure my own stub
// instead of the shape the endpoint actually refuses.
const handler = (await import('./config.post')).default as unknown as (
  e: unknown,
) => Promise<unknown>

const ACCESS = { project: PROJECT, organization: ORG, role: 'editor', userId: 'user-1' }
// Measured against the real tokensSchema, not assumed: the key is `colors`
// (plural). My first fixture used `color` and three cells failed with
// `Unrecognized key: "color"` — the endpoint was right, the fixture was not.
const VALID = { colors: { primary: '#0a7cff' } }
const post = (body: unknown) => handler(fakeEvent({ params: { projectId: PROJECT.id }, body }))

beforeEach(() => {
  requireProjectAccess.mockReset()
  requireProjectAccess.mockResolvedValue(ACCESS)
  saveDraft.mockReset()
  saveDraft.mockResolvedValue({ id: 'cv-1', version: 4 })
})

describe('saving a draft through the config editor', () => {
  it('requires EDITOR, not viewer', async () => {
    // Asserted on the argument, not the outcome: a gate called with 'viewer'
    // passes its own happy path and would let a read-only member write tokens.
    await post(VALID)
    expect(requireProjectAccess).toHaveBeenCalledWith(expect.anything(), PROJECT.id, 'editor')
  })

  it('hands saveDraft the access object, the project id and the PARSED tokens', async () => {
    await post(VALID)
    expect(saveDraft).toHaveBeenCalledWith(
      expect.anything(),
      ACCESS,
      PROJECT.id,
      expect.objectContaining({ colors: expect.objectContaining({ primary: '#0a7cff' }) }),
    )
  })

  it('returns whatever saveDraft returned, unwrapped', async () => {
    await expect(post(VALID)).resolves.toMatchObject({ id: 'cv-1', version: 4 })
  })

  it('🔴 400s on an invalid body and never reaches saveDraft', async () => {
    // The ordering is the guarantee: a rejected save must not produce a draft
    // row, and therefore must not produce an audit event either. Measured as
    // "saveDraft was not called" rather than as a status code alone, because a
    // handler that validated AFTER delegating would still answer 400.
    // `#12345` — five hex digits. Chosen because cssColor's own error names the
    // rule ("hex needs exactly 3, 4, 6 or 8 digits"), so the refusal is the
    // schema's, not a guess of mine. Two earlier guesses were wrong: `colors`
    // is not `color`, and a REAL slot accepts 'not-a-colour' because
    // CSS_COLOR_PATTERN admits bare identifiers.
    await expect(post({ colors: { primary: '#12345' } })).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('400s when the body is missing entirely', async () => {
    await expect(post(null)).rejects.toMatchObject({ statusCode: 400 })
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('400s without a projectId, before the gate is consulted', async () => {
    // A missing route param is a malformed request, not a permission question —
    // and asking the PDP about an undefined project is how a 403 gets reported
    // for what is really a 400.
    await expect(handler(fakeEvent({ params: {}, body: VALID }))).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(requireProjectAccess).not.toHaveBeenCalled()
  })
})
