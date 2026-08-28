import { createError } from 'h3'

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
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const token = process.env.ACCOUNT_S2S_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${accountUrl}${path}`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(5_000),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: failure.statusMessage,
      data: { code: failure.code },
    })
  }

  return (await res.json()) as T
}
