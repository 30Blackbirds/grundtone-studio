import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { exportJWK, generateKeyPair, SignJWT, type JWK, type CryptoKey } from 'jose'

// A minimal OIDC provider for tests: discovery, JWKS and a token endpoint that
// signs whatever ID token the test asks for. It is a test double, so the knobs
// are the point: wrong issuer, audience, nonce, key, algorithm, expiry.

export interface IdTokenOverrides {
  iss?: string
  aud?: string | string[]
  sub?: string | undefined
  nonce?: string | undefined
  exp?: number
  claims?: Record<string, unknown>
  /** Sign with a different key than the one JWKS publishes. */
  wrongKey?: boolean
  /** Emit an unsigned (`alg: none`) token. */
  unsigned?: boolean
  alg?: string
}

export interface FakeIdp {
  issuer: string
  clientId: string
  /** Next token response is built from these (reset after each use). */
  next: IdTokenOverrides
  /** Extra claims served by userinfo. */
  userinfo: Record<string, unknown> | null
  /** What discovery claims the issuer is; undefined means the real one. */
  metadataIssuer: string | undefined
  /** Whether discovery advertises end_session_endpoint. */
  endSession: boolean
  tokenRequests: URLSearchParams[]
  /** The nonce of the most recent authorization request seen by the test. */
  close(): Promise<void>
}

export async function startFakeIdp(clientId = 'studio'): Promise<FakeIdp> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
  const other = await generateKeyPair('RS256')
  const rs512 = await generateKeyPair('RS512', { extractable: true })
  const jwk512: JWK = { ...(await exportJWK(rs512.publicKey)), kid: 'k2', alg: 'RS512', use: 'sig' }
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }

  let issuer = ''
  const idp: FakeIdp = {
    get issuer() {
      return issuer
    },
    clientId,
    next: {},
    userinfo: null,
    metadataIssuer: undefined,
    endSession: true,
    tokenRequests: [],
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', issuer)
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (url.pathname === '/.well-known/openid-configuration') {
      return json({
        issuer: idp.metadataIssuer ?? issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        userinfo_endpoint: `${issuer}/userinfo`,
        ...(idp.endSession ? { end_session_endpoint: `${issuer}/logout` } : {}),
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
      })
    }
    if (url.pathname === '/jwks') return json({ keys: [jwk, jwk512] })
    if (url.pathname === '/userinfo') {
      return idp.userinfo ? json(idp.userinfo) : json({ error: 'nope' }, 401)
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', async () => {
        const form = new URLSearchParams(body)
        idp.tokenRequests.push(form)
        const o = idp.next
        idp.next = {}
        const now = Math.floor(Date.now() / 1000)
        const payload = {
          ...(o.sub === undefined && 'sub' in o ? {} : { sub: o.sub ?? 'user-1' }),
          ...(o.nonce === undefined && 'nonce' in o ? {} : { nonce: o.nonce }),
          ...o.claims,
        }
        let idToken: string
        if (o.unsigned) {
          const b = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
          idToken = `${b({ alg: 'none', typ: 'JWT' })}.${b({
            iss: o.iss ?? issuer,
            aud: o.aud ?? clientId,
            iat: now,
            exp: now + 300,
            ...payload,
          })}.`
        } else {
          const key: CryptoKey = o.wrongKey
            ? other.privateKey
            : o.alg === 'RS512'
              ? rs512.privateKey
              : privateKey
          idToken = await new SignJWT(payload)
            .setProtectedHeader({ alg: o.alg ?? 'RS256', kid: o.alg === 'RS512' ? 'k2' : 'k1' })
            .setIssuer(o.iss ?? issuer)
            .setAudience(o.aud ?? clientId)
            .setIssuedAt(now)
            .setExpirationTime(o.exp ?? now + 300)
            .sign(key)
        }
        json({ access_token: 'at-1', token_type: 'Bearer', expires_in: 300, id_token: idToken })
      })
      return
    }
    json({ error: 'not_found' }, 404)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return idp
}
