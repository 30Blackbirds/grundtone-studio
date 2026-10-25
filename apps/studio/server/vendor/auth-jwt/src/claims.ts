/** JWT claim names shared with [permissions] and [etude] (Beslutning O + K). */
export const JWT_CLAIM_SUB = 'sub'
export const JWT_CLAIM_ORG = 'org'

export interface KlanghausJwtPayload {
  sub: string
  email?: string
  org?: string
  iss?: string
  aud?: string | string[]
  exp?: number
  iat?: number
}
