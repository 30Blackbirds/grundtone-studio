/** Default JWKS URL for KlangHaus Auth-service (Beslutning D). */
export function defaultJwksUrl(issuer: string): string {
  const base = issuer.replace(/\/$/, '')
  return `${base}/.well-known/jwks.json`
}
