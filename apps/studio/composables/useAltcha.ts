// ALTCHA proof-of-work captcha (erstatter Google reCAPTCHA v3 — EU-først, ingen
// tredjeparts-script eller sporings-cookies). Server-siden (challenge-udstedelse
// + verifikation + HMAC-secret) bor i central auth; her løser vi kun challengen
// klient-side og sender løsningen i den samme `x-captcha-response`-header som før.
//
// Challengen hentes same-origin via studios BFF (`/api/auth/altcha/challenge`),
// som proxy'er til auth. Endpointet findes KUN når auth har ALTCHA_HMAC_KEY sat;
// ellers 404 → vi degraderer gracefully (returnér '' så formularen ikke låses,
// mens enforcement stadig er slået fra i den staged cutover).

interface AltchaChallenge {
  algorithm: string
  challenge: string
  salt: string
  signature: string
  maxnumber?: number
}

const CHALLENGE_URL = '/api/auth/altcha/challenge'
const DEFAULT_MAX = 1_000_000

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Henter en ALTCHA-challenge og løser dens proof-of-work. Returnerer den
 * base64-encodede solution-payload (til `x-captcha-response`), eller '' hvis
 * challengen ikke er tilgængelig (gate off → 404) eller ikke kan løses —
 * kalderen tilføjer kun headeren når værdien er non-empty, så et tomt svar
 * blokerer aldrig submit.
 */
export async function solveAltchaChallenge(): Promise<string> {
  if (import.meta.server) return ''

  let challenge: AltchaChallenge
  try {
    const res = await fetch(CHALLENGE_URL, { headers: { accept: 'application/json' } })
    if (!res.ok) return ''
    challenge = await res.json()
  } catch {
    return ''
  }

  if (challenge.algorithm !== 'SHA-256' || !challenge.challenge || !challenge.salt) return ''

  const max = typeof challenge.maxnumber === 'number' ? challenge.maxnumber : DEFAULT_MAX
  for (let number = 0; number <= max; number++) {
    if ((await sha256Hex(challenge.salt + number)) === challenge.challenge) {
      const payload = {
        algorithm: challenge.algorithm,
        challenge: challenge.challenge,
        number,
        salt: challenge.salt,
        signature: challenge.signature,
      }
      return btoa(JSON.stringify(payload))
    }
  }

  return ''
}

export function useAltcha() {
  return { solveAltchaChallenge }
}
