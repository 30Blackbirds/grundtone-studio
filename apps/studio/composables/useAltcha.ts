// ALTCHA proof-of-work captcha (erstatter Google reCAPTCHA v3 — EU-først, ingen
// tredjeparts-script eller sporings-cookies). Server-siden (challenge-udstedelse
// + verifikation + HMAC-secret) bor i central auth; her løser vi kun challengen
// klient-side og sender løsningen i den samme `x-captcha-response`-header som før.
//
// Challengen hentes same-origin via studios BFF (`/api/auth/altcha/challenge`),
// som proxy'er til auth. Endpointet findes KUN når auth har ALTCHA_HMAC_KEY sat;
// ellers 404 → vi degraderer gracefully (returnér '' så formularen ikke låses,
// mens enforcement stadig er slået fra i den staged cutover).
//
// PoW-solveren bruger en SYNKRON SHA-256 (@noble/hashes) i en chunked løkke.
// Auths prod-sværhed er maxnumber=1e6; en `await crypto.subtle.digest` per
// iteration er ~15k hash/s (→ ~32s gns. solve = login hænger). Synkron hash er
// ~58x hurtigere (~0,55s gns.), og vi yield'er mellem chunks så UI'et forbliver
// responsivt uden at fryse hovedtråden.

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

interface AltchaChallenge {
  algorithm: string
  challenge: string
  salt: string
  signature: string
  maxnumber?: number
}

const CHALLENGE_URL = '/api/auth/altcha/challenge'
const DEFAULT_MAX = 1_000_000
const CHUNK = 25_000

const encoder = new TextEncoder()

function sha256Hex(input: string): string {
  return bytesToHex(sha256(encoder.encode(input)))
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
  for (let start = 0; start <= max; start += CHUNK) {
    const end = Math.min(start + CHUNK, max)
    for (let number = start; number <= end; number++) {
      if (sha256Hex(challenge.salt + number) === challenge.challenge) {
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
    // Giv hovedtråden luft mellem chunks så pending-spinneren ikke fryser.
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  return ''
}

export function useAltcha() {
  return { solveAltchaChallenge }
}
