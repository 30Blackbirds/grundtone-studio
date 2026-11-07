import { createError } from 'h3'

/** The header account reads the user token from (account src/http/user-binding.ts). */
export const USER_TOKEN_HEADER = 'x-klanghaus-user-token'

/** Account's 403s on the user binding (condition 2 (a)). */
const USER_BINDING_403 = new Set(['user_org_mismatch', 'user_role_insufficient'])

// S2S-relayet til account (kontrakt §5/§7a). Checkout- og portal-mintet delte
// 16 linjer ordret: dormant-503, headers, bearer, fetch med timeout, 502.
//
// 🔴 TO funktioner, ikke én — fordi RÆKKEFØLGEN i handlerne er bevidst:
//
//   rolle-tjek → (beta-værn) → dormant-503 → appUrl → fetch
//
// Den dormante 503 skal falde FØR vi rører runtime-config og bygger bodyen.
// Samlede helperen begge trin, ville bodyen — og dermed `useRuntimeConfig` —
// blive evalueret før 503'en, og et usat ACCOUNT_URL ville rapportere sig som
// noget andet end dormant. Derfor står `requireAccountUrl` for sig, og
// kalderen bygger sin body bagefter.

/**
 * Den dormante 503: billing er ikke konfigureret endnu.
 *
 * Egen fejlkode (`billing_unavailable`), fordi "ikke konfigureret" og "kaldet
 * fejlede" er to forskellige tilstande for den der læser svaret.
 */
export function requireAccountUrl(): string {
  const accountUrl = process.env.ACCOUNT_URL
  if (!accountUrl) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Billing is not available yet',
      data: { code: 'billing_unavailable' },
    })
  }
  return accountUrl
}

export interface RelayFailure {
  statusMessage: string
  code: string
}

/**
 * POST til account med S2S-token og 5s timeout; 502 med kalderens egen
 * fejlkode når svaret ikke er ok.
 *
 * Bemærk at der ikke er nogen fallback når `ACCOUNT_S2S_TOKEN` mangler:
 * headeren udelades, og account afviser. Et tomt `Bearer ` ville se ud som et
 * forsøg på at autentificere frem for som en manglende konfiguration.
 */
export async function postToAccount<T>(
  accountUrl: string,
  path: string,
  body: Record<string, unknown>,
  failure: RelayFailure,
  /** The logged-in user's account token (server/lib/account-user-token.ts). */
  userToken?: string,
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const token = process.env.ACCOUNT_S2S_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  if (userToken) headers[USER_TOKEN_HEADER] = userToken

  const res = await fetch(`${accountUrl}${path}`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(5_000),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    // Account's errors are `{ error, message }` (account src/http/errors.ts).
    const code = ((await res.json().catch(() => null)) as { error?: unknown } | null)?.error
    // A 403 on the user binding is the user's role or org, as account reads it
    // from auth: pass it on as a 403 the page can explain. Everything else —
    // including a 401 on the token, which means Studio sent a bad one — stays
    // Studio's 502, logged with account's code.
    if (res.status === 403 && typeof code === 'string' && USER_BINDING_403.has(code)) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Requires the owner or billing role',
        data: { code },
      })
    }
    console.error(`[account-relay] ${path} answered ${res.status}:`, code ?? '(no code)')
    throw createError({
      statusCode: 502,
      statusMessage: failure.statusMessage,
      data: { code: failure.code },
    })
  }

  return (await res.json()) as T
}
