import { createError } from 'h3'
import { BETA_MODE } from '~~/lib/plan-catalog'
import { isInternalOrg } from './internal-orgs'

/**
 * Beslutning AL: i beta kan de betalte planer hverken købes eller
 * forudbestilles. UI-tilstand er ikke håndhævelsen — den ligger her, så en
 * klient ikke kan omgå den ved at kalde endepunktet direkte.
 *
 * 🔴 ÉN definition, fordi koden og teksten er juras (consent-tekster.md).
 * To kopier kan drifte fra hinanden, og en drift ville være tavs: begge
 * ville stadig afvise, bare med hver sin kode, og kun den ene ville matche
 * det dokument kunden kan holde os til.
 *
 * `orgId` SKAL komme fra auth-opslaget, aldrig fra request-bodyen — ellers
 * er undtagelsen selv omgåelsesvejen ([sikkerhed]s krav).
 */
export function assertBetaPurchasesClosed(orgId: string, attempt: string): void {
  if (!BETA_MODE || isInternalOrg(orgId)) return
  // Logger det auth-udledte org-id, ikke klientens slug: en body-styret
  // værdi i logs er angriberens tekst i vores driftsspor.
  console.warn(`[billing] beta: ${attempt} attempt rejected (org=${orgId})`)
  throw createError({
    statusCode: 403,
    statusMessage: 'Paid plans open 1 January 2027',
    data: { code: 'beta_paid_plans_closed' },
  })
}
