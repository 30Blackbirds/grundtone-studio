import { describe, expect, it } from 'vitest'
import { authMode, isSafeNext, oidcStateCookie, OidcConfigError, readOidcConfig } from './config'

const base = {
  AUTHORIZER: 'local',
  OIDC_ISSUER: 'https://idp.example.com',
  OIDC_CLIENT_ID: 'studio',
  NUXT_PUBLIC_APP_URL: 'https://studio.example.com',
}

describe('authMode', () => {
  it('defaults to better-auth so existing deployments are unchanged', () => {
    expect(authMode({})).toBe('better-auth')
    expect(authMode({ AUTH_MODE: '' })).toBe('better-auth')
    expect(authMode({ AUTH_ISSUER: 'https://auth.example.com' })).toBe('better-auth')
  })
  it('accepts the two modes and refuses anything else', () => {
    expect(authMode({ AUTH_MODE: 'oidc' })).toBe('oidc')
    expect(authMode({ AUTH_MODE: 'better-auth' })).toBe('better-auth')
    expect(() => authMode({ AUTH_MODE: 'OIDC ' })).toThrow(OidcConfigError)
    expect(() => authMode({ AUTH_MODE: 'saml' })).toThrow(OidcConfigError)
  })
})

describe('readOidcConfig', () => {
  it('reads a minimal config with safe defaults', () => {
    const cfg = readOidcConfig(base)
    expect(cfg).toMatchObject({
      issuer: 'https://idp.example.com',
      clientId: 'studio',
      clientSecret: undefined,
      scopes: ['openid', 'email', 'profile'],
      redirectUri: 'https://studio.example.com/api/oidc/callback',
      idTokenAlg: 'RS256',
      requireEmailVerified: true,
      allowedEmailDomains: [],
      jit: true,
    })
  })

  it('requires AUTHORIZER=local', () => {
    expect(() => readOidcConfig({ ...base, AUTHORIZER: 'pdp' })).toThrow(/AUTHORIZER=local/)
    expect(() => readOidcConfig({ ...base, AUTHORIZER: undefined })).toThrow(/AUTHORIZER=local/)
  })

  it.each([
    ['OIDC_ISSUER', undefined, /OIDC_ISSUER is required/],
    ['OIDC_ISSUER', 'http://idp.example.com', /must be https/],
    ['OIDC_ISSUER', 'https://u:p@idp.example.com', /credentials/],
    ['OIDC_ISSUER', 'https://idp.example.com/?x=1', /query string/],
    ['OIDC_ISSUER', 'not a url', /not a valid URL/],
    ['OIDC_CLIENT_ID', ' ', /OIDC_CLIENT_ID is required/],
    ['OIDC_SCOPES', 'email profile', /include openid/],
    ['OIDC_SCOPES', 'openid offline_access', /offline_access/],
    ['OIDC_ID_TOKEN_ALG', 'none', /OIDC_ID_TOKEN_ALG/],
    ['OIDC_ID_TOKEN_ALG', 'HS256', /OIDC_ID_TOKEN_ALG/],
    ['OIDC_REQUIRE_EMAIL_VERIFIED', 'maybe', /OIDC_REQUIRE_EMAIL_VERIFIED/],
    ['OIDC_REDIRECT_URI', 'http://studio.example.com/cb', /must be https/],
  ])('refuses %s = %s', (name, value, message) => {
    expect(() => readOidcConfig({ ...base, [name]: value })).toThrow(message)
  })

  it('accepts http only for loopback hosts', () => {
    expect(readOidcConfig({ ...base, OIDC_ISSUER: 'http://localhost:8080/realms/x' }).issuer).toBe(
      'http://localhost:8080/realms/x',
    )
    expect(() => readOidcConfig({ ...base, OIDC_ISSUER: 'http://localhost.evil.example' })).toThrow(
      /must be https/,
    )
  })

  it('needs a redirect URI when there is no app URL', () => {
    expect(() => readOidcConfig({ ...base, NUXT_PUBLIC_APP_URL: undefined })).toThrow(
      /OIDC_REDIRECT_URI is required/,
    )
    expect(
      readOidcConfig({
        ...base,
        NUXT_PUBLIC_APP_URL: undefined,
        OIDC_REDIRECT_URI: 'https://s.example.com/api/oidc/callback',
      }).redirectUri,
    ).toBe('https://s.example.com/api/oidc/callback')
  })

  it('parses the optional switches', () => {
    const cfg = readOidcConfig({
      ...base,
      OIDC_CLIENT_SECRET: 's3',
      OIDC_JIT: 'off',
      OIDC_REQUIRE_EMAIL_VERIFIED: 'false',
      OIDC_ALLOWED_EMAIL_DOMAINS: ' Example.com, ,corp.example ',
      OIDC_ID_TOKEN_ALG: 'ES256',
    })
    expect(cfg).toMatchObject({
      clientSecret: 's3',
      jit: false,
      requireEmailVerified: false,
      allowedEmailDomains: ['example.com', 'corp.example'],
      idTokenAlg: 'ES256',
    })
  })
})

describe('isSafeNext', () => {
  it.each(['/', '/dashboard', '/orgs/a?x=1#y'])('accepts %s', (v) => {
    expect(isSafeNext(v)).toBe(true)
  })
  it.each([
    undefined,
    '',
    'dashboard',
    '//evil.example',
    '/\\evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    '/a\nb',
    '/a\\b',
    `/${'a'.repeat(2001)}`,
  ])('refuses %j', (v) => {
    expect(isSafeNext(v as string | undefined)).toBe(false)
  })
})

describe('oidcStateCookie', () => {
  it('uses the __Host- prefix over https', () => {
    expect(oidcStateCookie({ redirectUri: 'https://s.example.com/cb' })).toEqual({
      name: '__Host-studio_oidc',
      secure: true,
    })
  })
  it('drops it only for plain-http localhost', () => {
    expect(oidcStateCookie({ redirectUri: 'http://localhost:3000/cb' })).toEqual({
      name: 'studio_oidc',
      secure: false,
    })
  })
})
