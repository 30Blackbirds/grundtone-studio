import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  clearDiscoveryCache,
  completeLogin,
  LOGIN_TTL_MS,
  OidcLoginError,
  startLogin,
} from './flow'
import { parseRoleMapping, readOidcConfig, type OidcConfig } from './config'
import { startFakeIdp, type FakeIdp } from './fake-idp'

// The login flow against a fake IdP and a REAL Postgres (oidc_login). Denial
// paths come first because they are the point: every way a callback can be
// wrong must end in an OidcLoginError and never in claims.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL && process.env.CI) {
  throw new Error('DATABASE_URL is not visible to the test process in CI')
}

type Db = typeof import('~~/server/db').db
let db: Db
let schema: typeof import('~~/server/db/schema')
let idp: FakeIdp
let cfg: OidcConfig

const REDIRECT = 'https://studio.example.com/api/oidc/callback'

/** One browser: start a login, return what the IdP would see and the cookie. */
async function begin(next?: string) {
  const { url, state } = await startLogin(db, cfg, next)
  const auth = new URL(url)
  return { auth, state, nonce: auth.searchParams.get('nonce')! }
}

const callback = (state: string, extra = '') => `?code=abc&state=${state}${extra}`

async function fails(promise: Promise<unknown>, code: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(OidcLoginError)
  expect((err as OidcLoginError).code).toBe(code)
}

describe.skipIf(!DATABASE_URL)('OIDC login flow (fake IdP, real Postgres)', () => {
  beforeAll(async () => {
    ;({ db } = await import('~~/server/db'))
    schema = await import('~~/server/db/schema')
    idp = await startFakeIdp()
    cfg = readOidcConfig({
      AUTHORIZER: 'local',
      OIDC_ISSUER: idp.issuer,
      OIDC_CLIENT_ID: idp.clientId,
      OIDC_REDIRECT_URI: REDIRECT,
    })
  })

  beforeEach(async () => {
    clearDiscoveryCache()
    idp.next = {}
    idp.userinfo = null
    idp.tokenRequests.length = 0
    await db.delete(schema.oidcLogin)
  })

  afterAll(async () => {
    await idp?.close()
    if (db) {
      await db.delete(schema.oidcLogin)
      await db.$client.end()
    }
  })

  describe('denials', () => {
    it('refuses a callback whose state is not the cookie', async () => {
      const { state, nonce } = await begin()
      idp.next = { nonce }
      await fails(completeLogin(db, cfg, callback(state), 'another-state'), 'state_mismatch')
      // ...and it spent nothing: the attempt is still there for the real browser.
      const ok = await completeLogin(db, cfg, callback(state), state)
      expect(ok.claims.subject).toBe('user-1')
    })

    it('refuses a callback with no cookie at all (login CSRF)', async () => {
      const { state } = await begin()
      await fails(completeLogin(db, cfg, callback(state), undefined), 'state_mismatch')
    })

    it('refuses a callback without state', async () => {
      await begin()
      await fails(completeLogin(db, cfg, '?code=abc', 'x'), 'state_mismatch')
    })

    it('refuses a state Studio never issued', async () => {
      await fails(completeLogin(db, cfg, callback('forged'), 'forged'), 'login_expired_or_used')
    })

    it('refuses an IdP error response and does not echo it', async () => {
      const { state } = await begin()
      const err = await completeLogin(db, cfg, `?error=access_denied&state=${state}`, state).catch(
        (e: OidcLoginError) => e,
      )
      expect(err).toMatchObject({ code: 'idp_error', message: 'idp_error' })
    })

    it('lets a callback be used once', async () => {
      const { state, nonce } = await begin()
      idp.next = { nonce }
      await completeLogin(db, cfg, callback(state), state)
      idp.next = { nonce }
      await fails(completeLogin(db, cfg, callback(state), state), 'login_expired_or_used')
    })

    it('refuses an attempt older than ten minutes', async () => {
      const { state } = await begin()
      const later = new Date(Date.now() + LOGIN_TTL_MS + 1000)
      await fails(completeLogin(db, cfg, callback(state), state, later), 'login_expired_or_used')
    })

    it('only one of two concurrent callbacks gets the attempt', async () => {
      const { state, nonce } = await begin()
      idp.next = { nonce }
      const results = await Promise.allSettled([
        completeLogin(db, cfg, callback(state), state),
        completeLogin(db, cfg, callback(state), state),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    })

    it.each([
      ['wrong issuer', (n: string) => ({ nonce: n, iss: 'https://evil.example' })],
      ['wrong audience', (n: string) => ({ nonce: n, aud: 'someone-else' })],
      ['wrong nonce', () => ({ nonce: 'not-the-nonce' })],
      ['missing nonce', () => ({ nonce: undefined })],
      ['expired token', (n: string) => ({ nonce: n, exp: Math.floor(Date.now() / 1000) - 3600 })],
      ['unsigned (alg none)', (n: string) => ({ nonce: n, unsigned: true })],
      ['signed by another key', (n: string) => ({ nonce: n, wrongKey: true })],
    ])('refuses an ID token with %s', async (_name, build) => {
      const { state, nonce } = await begin()
      idp.next = build(nonce)
      await fails(completeLogin(db, cfg, callback(state), state), 'token_exchange_failed')
    })

    it('refuses an ID token without sub', async () => {
      const { state, nonce } = await begin()
      idp.next = { nonce, sub: undefined }
      await fails(completeLogin(db, cfg, callback(state), state), 'token_exchange_failed')
    })

    it('refuses an algorithm other than the pinned one', async () => {
      const { state, nonce } = await begin()
      idp.next = { nonce, alg: 'RS512' }
      await fails(completeLogin(db, cfg, callback(state), state), 'token_exchange_failed')
    })

    it('refuses an issuer whose metadata names a different issuer', async () => {
      idp.metadataIssuer = 'https://evil.example'
      clearDiscoveryCache()
      try {
        await fails(startLogin(db, cfg, '/'), 'discovery_failed')
      } finally {
        idp.metadataIssuer = undefined
      }
    })

    it('refuses an unreachable IdP', async () => {
      const gone = { ...cfg, issuer: 'http://127.0.0.1:9' }
      await fails(startLogin(db, gone, '/'), 'discovery_failed')
    })
  })

  describe('login', () => {
    it('sends PKCE S256, state, nonce and the configured redirect_uri', async () => {
      const { auth, state } = await begin()
      expect(auth.origin).toBe(idp.issuer)
      expect(auth.pathname).toBe('/authorize')
      expect(auth.searchParams.get('response_type')).toBe('code')
      expect(auth.searchParams.get('client_id')).toBe('studio')
      expect(auth.searchParams.get('redirect_uri')).toBe(REDIRECT)
      expect(auth.searchParams.get('scope')).toBe('openid email profile')
      expect(auth.searchParams.get('code_challenge_method')).toBe('S256')
      expect(auth.searchParams.get('state')).toBe(state)
      expect(state.length).toBeGreaterThanOrEqual(22)
    })

    it('keeps the verifier and nonce server-side, and only the hash of the state', async () => {
      const { state } = await begin()
      const [row] = await db.select().from(schema.oidcLogin)
      expect(row!.stateHash).toBe(createHash('sha256').update(state).digest('hex'))
      expect(row!.stateHash).not.toContain(state)
      expect(row!.codeVerifier.length).toBeGreaterThanOrEqual(43)
    })

    it('completes with verified claims and proves the PKCE verifier', async () => {
      const { auth, state, nonce } = await begin('/orgs/acme')
      idp.next = {
        nonce,
        sub: 'abc',
        claims: { email: 'a@example.com', email_verified: true, name: ' Ada ' },
      }
      const out = await completeLogin(db, cfg, callback(state), state)
      expect(out.next).toBe('/orgs/acme')
      expect(out.claims).toEqual({
        issuer: idp.issuer,
        subject: 'abc',
        email: 'a@example.com',
        emailVerified: true,
        name: 'Ada',
      })
      const req = idp.tokenRequests[0]!
      expect(req.get('grant_type')).toBe('authorization_code')
      expect(req.get('redirect_uri')).toBe(REDIRECT)
      const verifier = req.get('code_verifier')!
      expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
        auth.searchParams.get('code_challenge'),
      )
    })

    it('never takes the redirect_uri from the request', async () => {
      const { state, nonce } = await begin()
      idp.next = { nonce }
      await completeLogin(db, cfg, callback(state, '&redirect_uri=https://evil.example/'), state)
      expect(idp.tokenRequests[0]!.get('redirect_uri')).toBe(REDIRECT)
    })

    it.each(['//evil.example', 'https://evil.example', '/\\evil.example', undefined])(
      'turns next=%s into /',
      async (next) => {
        const { state, nonce } = await begin(next)
        idp.next = { nonce }
        expect((await completeLogin(db, cfg, callback(state), state)).next).toBe('/')
      },
    )

    it('counts only a boolean true or the string "true" as a verified e-mail', async () => {
      for (const [value, expected] of [
        [true, true],
        ['true', true],
        ['yes', false],
        [1, false],
        [undefined, false],
      ] as const) {
        const { state, nonce } = await begin()
        idp.next = { nonce, claims: { email: 'a@example.com', email_verified: value } }
        expect((await completeLogin(db, cfg, callback(state), state)).claims.emailVerified).toBe(
          expected,
        )
      }
    })

    it('reads the role claim only when a mapping is configured, as a list of strings', async () => {
      let { state, nonce } = await begin()
      idp.next = { nonce, claims: { groups: ['admins', 7, 'staff'] } }
      expect(
        (await completeLogin(db, cfg, callback(state), state)).claims.roleValues,
      ).toBeUndefined()
      const mapped = { ...cfg, roleMapping: parseRoleMapping('groups', 'admins=acme:admin') }
      ;({ state, nonce } = await begin())
      idp.next = { nonce, claims: { groups: ['admins', 7, 'staff'] } }
      expect((await completeLogin(db, mapped, callback(state), state)).claims.roleValues).toEqual([
        'admins',
        'staff',
      ])
      ;({ state, nonce } = await begin())
      idp.next = { nonce, claims: { groups: { admins: true } } }
      expect((await completeLogin(db, mapped, callback(state), state)).claims.roleValues).toEqual(
        [],
      )
    })

    it('falls back to preferred_username, then the e-mail local part, for the name', async () => {
      let { state, nonce } = await begin()
      idp.next = { nonce, claims: { preferred_username: 'ada', email: 'x@example.com' } }
      expect((await completeLogin(db, cfg, callback(state), state)).claims.name).toBe('ada')
      ;({ state, nonce } = await begin())
      idp.next = { nonce, claims: { email: 'grace@example.com' } }
      expect((await completeLogin(db, cfg, callback(state), state)).claims.name).toBe('grace')
    })

    it('fills a missing e-mail from userinfo, whose sub must match', async () => {
      idp.userinfo = { sub: 'user-1', email: 'u@example.com', email_verified: true }
      let { state, nonce } = await begin()
      idp.next = { nonce }
      const ok = await completeLogin(db, cfg, callback(state), state)
      expect(ok.claims.email).toBe('u@example.com')

      // A userinfo answer about someone else is ignored, not trusted.
      idp.userinfo = { sub: 'someone-else', email: 'victim@example.com', email_verified: true }
      ;({ state, nonce } = await begin())
      idp.next = { nonce }
      const out = await completeLogin(db, cfg, callback(state), state)
      expect(out.claims.email).toBeNull()
    })

    it('purges unfinished attempts when a new login starts', async () => {
      await begin()
      await db.update(schema.oidcLogin).set({ expiresAt: new Date(Date.now() - 1000) })
      await begin()
      expect(await db.select().from(schema.oidcLogin)).toHaveLength(1)
    })
  })

  it('leaves no row for a consumed attempt', async () => {
    const { state, nonce } = await begin()
    idp.next = { nonce }
    await completeLogin(db, cfg, callback(state), state)
    const rows = await db
      .select()
      .from(schema.oidcLogin)
      .where(eq(schema.oidcLogin.stateHash, createHash('sha256').update(state).digest('hex')))
    expect(rows).toHaveLength(0)
  })
})

describe.skipIf(!DATABASE_URL)('RP-initiated logout URL', () => {
  it('points at end_session_endpoint with the hint, client and a fixed return URL', async () => {
    const { endSessionUrl } = await import('./flow')
    const local = await startFakeIdp()
    try {
      const c = readOidcConfig({
        AUTHORIZER: 'local',
        OIDC_ISSUER: local.issuer,
        OIDC_CLIENT_ID: local.clientId,
        OIDC_REDIRECT_URI: REDIRECT,
      })
      const url = new URL((await endSessionUrl(c, 'the-id-token'))!)
      expect(url.origin + url.pathname).toBe(`${local.issuer}/logout`)
      expect(url.searchParams.get('id_token_hint')).toBe('the-id-token')
      expect(url.searchParams.get('client_id')).toBe('studio')
      expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://studio.example.com/')
      expect(new URL((await endSessionUrl(c, null))!).searchParams.has('id_token_hint')).toBe(false)
    } finally {
      await local.close()
    }
  })

  it('is null when the IdP has no end_session_endpoint: logout is local only', async () => {
    const { endSessionUrl } = await import('./flow')
    const local = await startFakeIdp()
    local.endSession = false
    try {
      const c = readOidcConfig({
        AUTHORIZER: 'local',
        OIDC_ISSUER: local.issuer,
        OIDC_CLIENT_ID: local.clientId,
        OIDC_REDIRECT_URI: REDIRECT,
      })
      expect(await endSessionUrl(c, 'x')).toBeNull()
    } finally {
      await local.close()
    }
  })
})
