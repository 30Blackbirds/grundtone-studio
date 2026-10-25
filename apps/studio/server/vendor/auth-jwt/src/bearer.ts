/** Extract Bearer token from an Authorization header value. */
export function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null
  const match = /^bearer\s+(\S+)\s*$/i.exec(authorization)
  return match?.[1] ?? null
}
