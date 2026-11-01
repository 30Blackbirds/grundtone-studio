// Verify-tillids-flowet (/verify → BFF → /verify/done). Kontrakt låst med
// [auth]: mail-linket lander på /verify?token&callbackURL, siden navigerer
// browseren til BFF'ens GET /api/auth/verify-email (session-cookie sættes
// first-party via auth-proxyen), og auth redirecter til callbackURL'en vi
// giver den — altid /verify/done, med ?error=<enum> ved fejl og uden param
// ved succes ("allerede bekræftet" er også ren succes, ingen egen kode).

/** Udtømmende fejl-enum fra auths verify-endpoint (source-verificeret af [designer]+[auth]). */
export const VERIFY_ERROR_STATES = {
  TOKEN_EXPIRED: 'expired',
  INVALID_TOKEN: 'invalid',
  USER_NOT_FOUND: 'userGone',
  INVALID_USER: 'wrongUser',
} as const

export type VerifyDoneState =
  (typeof VERIFY_ERROR_STATES)[keyof typeof VERIFY_ERROR_STATES] | 'success'

/**
 * Mapper /verify/done's ?error-param til UI-state. Intet param = succes;
 * ukendte koder behandles som ugyldigt link (defensivt — enum'et er låst,
 * men et fremmed param må aldrig vise succes-UI).
 */
export function verifyDoneState(error: unknown): VerifyDoneState {
  if (error == null || error === '') return 'success'
  if (typeof error !== 'string') return 'invalid'
  return VERIFY_ERROR_STATES[error as keyof typeof VERIFY_ERROR_STATES] ?? 'invalid'
}

/**
 * Open-redirect-værn for callbackURL fra mail-linket (trust boundary):
 * kun app-relative stier — leading '/', ikke '//' (protokol-relativ) og
 * ikke '/\' (backslash-varianten browsere normaliserer til '//').
 */
export function isSafeRelativePath(path: unknown): path is string {
  if (typeof path !== 'string') return false
  if (!path.startsWith('/')) return false
  if (path.startsWith('//') || path.startsWith('/\\')) return false
  return true
}

/**
 * sessionStorage-stash sat af /verify og læst af /verify/done. Token'et
 * genbruges KUN til retry efter log-ud (INVALID_USER-kanten); email driver
 * "send nyt link"; next = valideret mål for "Fortsæt til Studio".
 */
export const VERIFY_STASH_KEY = 'gt-verify-flow'

export interface VerifyStash {
  token?: string
  email?: string
  next?: string
}

export function readVerifyStash(storage: Pick<Storage, 'getItem'>): VerifyStash {
  try {
    const raw = storage.getItem(VERIFY_STASH_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const { token, email, next } = parsed as Record<string, unknown>
    return {
      token: typeof token === 'string' ? token : undefined,
      email: typeof email === 'string' ? email : undefined,
      next: isSafeRelativePath(next) ? next : undefined,
    }
  } catch {
    return {}
  }
}

/** URL'en /verify sender browseren til — fuld navigation, så Set-Cookie + redirect sker nativt. */
export function verifyApiUrl(token: string): string {
  return `/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent('/verify/done')}`
}
