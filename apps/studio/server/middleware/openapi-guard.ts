import { createError, defineEventHandler, getRequestHeader } from 'h3'

// /_openapi.json beskriver hele den interne API-flade (36 stier inkl.
// billing/eksport) — den må ikke være offentlig (jura-fund 2026-08-03,
// consent-spec §1a). Ruten består KUN til API-docs-aggregatoren
// (api.klanghaus.dk), som sender en delt token. FAIL-CLOSED i produktion:
// uden OPENAPI_SPEC_TOKEN i env'en er ruten 404 — eksponering kræver et
// aktivt valg, aldrig en glemt variabel. Dev er åben (lokal DX +
// aggregator-udvikling); [infra] provisionerer token i begge ender.
export default defineEventHandler((event) => {
  if (event.path !== '/_openapi.json') return
  if (import.meta.dev) return

  const expected = process.env.OPENAPI_SPEC_TOKEN
  const provided = getRequestHeader(event, 'x-openapi-token')
  if (!expected || provided !== expected) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
})
