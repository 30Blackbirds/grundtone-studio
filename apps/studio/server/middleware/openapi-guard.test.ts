import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeEvent, mockH3, type FakeEvent } from '~~/tests/helpers/endpoint-fixtures'

vi.mock('h3', () => mockH3())

const handler = (await import('./openapi-guard')).default as unknown as (
  event: FakeEvent & { path: string },
) => unknown

function specEvent(headers: Record<string, string> = {}, path = '/_openapi.json') {
  return Object.assign(fakeEvent({ headers }), { path })
}

beforeEach(() => {
  delete process.env.OPENAPI_SPEC_TOKEN
})
afterEach(() => {
  delete process.env.OPENAPI_SPEC_TOKEN
})

// Jura-fund (consent-spec §1a): the spec route describes the internal attack
// surface — FAIL-CLOSED in production is the contract, not a default.
describe('openapi-guard', () => {
  it('404s the spec route when no token is provisioned (fail-closed)', () => {
    expect(() => handler(specEvent())).toThrowError(expect.objectContaining({ statusCode: 404 }))
  })

  it('404s on a wrong token even when one is provisioned', () => {
    process.env.OPENAPI_SPEC_TOKEN = 'correct'
    expect(() => handler(specEvent({ 'x-openapi-token': 'wrong' }))).toThrowError(
      expect.objectContaining({ statusCode: 404 }),
    )
  })

  it('lets the aggregator through with the provisioned token', () => {
    process.env.OPENAPI_SPEC_TOKEN = 'correct'
    expect(handler(specEvent({ 'x-openapi-token': 'correct' }))).toBeUndefined()
  })

  it('ignores every other route', () => {
    expect(handler(specEvent({}, '/api/healthz'))).toBeUndefined()
  })
})
