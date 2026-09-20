import { createError, defineEventHandler, proxyRequest } from 'h3'
import { devAuthBypassEnabled } from '~~/server/lib/dev-auth-bypass'
import { DEV_AUTH_STUB_ROUTES, stubKeyFor } from '~~/server/lib/dev-auth-stub'

// BFF-proxy for central auth (domæne-arkitekturen: login = BFF).
//
// Studio (studio.grundtone.com) og central-auth (api.klanghaus.dk) er FORSKELLIGE
// registrerbare domæner. Kalder browseren auth-origin direkte, er Better Auths
// session-cookie en third-party-cookie i studio-kontekst — SameSite=Lax afvises
// cross-site, og Safari/Firefox blokerer den uanset attributter. Login "lykkes"
// (200 + token) men sessionen gemmes aldrig.
//
// Denne route proxy'er derfor /api/auth/** server-side til auth-servicen, så
// Set-Cookie lander som FIRST-party cookie på studios eget domæne. Server-
// middlewaren (server/middleware/auth.ts) læser præcis den cookie og veksler
// den til JWT — resten af kæden er uændret.
//
// Klienten peges herpå via NUXT_PUBLIC_AUTH_URL (lib/auth-client.ts):
//   prod:  https://studio.grundtone.com  → baseURL = <studio-origin>/api/auth
//   lokal: direkte auth-URL (samme site på localhost — cookien virker der uden
//          proxy, og Tilt-opsætningen er uændret)
//
// h3's proxyRequest udelader indgående `Host` (getProxyRequestHeaders), så
// upstream ser Host = api.klanghaus.dk fra target-URL'en — det matcher Caddy-
// vhosten. Origin/Cookie forwardes urørt; studio-origin er i auths
// TRUSTED_ORIGINS, så CSRF-checket består.
function authProxyTarget(): string | undefined {
  // Samme opløsning som server/middleware/auth.ts: intern adresse når sat
  // (container-net i Tilt), ellers den offentlige issuer. `||` (ikke `??`) så
  // en TOM env-værdi også falder tilbage til issueren.
  return process.env.AUTH_INTERNAL_URL || process.env.AUTH_ISSUER || undefined
}

export default defineEventHandler((event) => {
  // 🔴 THE LOCAL DESIGN-REVIEW BYPASS (dev-auth-bypass.ts) SHORT-CIRCUITS HERE,
  // before the proxy target is even resolved, because locally there is no auth
  // service to proxy to. Three gates, all checked in one place; see that file.
  if (devAuthBypassEnabled(event)) {
    const key = stubKeyFor(event.path)
    if (key in DEV_AUTH_STUB_ROUTES) return DEV_AUTH_STUB_ROUTES[key]
    // A path the stub does not know must NOT quietly become an empty 200: that
    // would render as a blank panel and be reported as a design defect.
    throw createError({
      statusCode: 501,
      statusMessage: `dev auth bypass has no answer for ${key} — add it to DEV_AUTH_STUB_ROUTES`,
    })
  }

  const target = authProxyTarget()
  if (!target) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Auth proxy target not configured (AUTH_INTERNAL_URL/AUTH_ISSUER)',
    })
  }
  // event.path indeholder både /api/auth/... og query-strengen.
  //
  // redirect:'manual' er BÆRENDE, ikke en optimering. Uden den bruger
  // proxy-fetchen sin default ('follow') og følger auths 302 SERVER-SIDE —
  // og fordi Location er relativ, resolver den mod AUTH-origin i stedet for
  // studio-origin. Resultatet var at verify-flowet endte på auth-hostens
  // fallback-side ("KlangHaus identity", HTTP 200) frem for på /verify/done
  // (diagnosticeret af [auth] 2026-08-04 med A/B mod prod).
  //
  // To grunde til at 3xx SKAL videregives rått til browseren:
  //   1. Location er relativ → browseren resolver den mod studio-origin,
  //      hvilket er præcis den rute vi vil have (/verify/done?error=…).
  //   2. Session-cookien fra autoSignInAfterVerification sidder PÅ selve
  //      302-svaret. Følger vi redirecten server-side, forsvinder den, og
  //      brugeren ville blive verificeret men ikke logget ind.
  //
  // Open-redirect-risikoen er auths: den validerer callbackURL som relativ
  // (låst i verify-kontrakten), så vi videregiver kun destinationer den har
  // godkendt. h3's sendProxy kopierer status, Location og Set-Cookie som de
  // er — det eneste manglende var at fetchen ikke måtte spise redirecten.
  return proxyRequest(event, `${target}${event.path}`, {
    fetchOptions: { redirect: 'manual' },
  })
})
