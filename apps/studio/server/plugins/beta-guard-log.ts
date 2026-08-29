import { BETA_MODE } from '~~/lib/plan-catalog'
import { internalOrgCount } from '~~/server/lib/internal-orgs'

// Boot-log for beta-værnet ([sikkerhed]s krav). Loggen siger ANTALLET, ikke
// id'erne: antallet er nok til at skelne "værnet virker som konfigureret" fra
// "listen er tom, fordi nogen stavede forkert", og id'erne hører hjemme i den
// SOPS-styrede env, ikke i driftsloggen.
export default defineNitroPlugin(() => {
  if (!BETA_MODE) return
  console.info(`[billing] beta guard: ${internalOrgCount()} internal orgs configured`)
})
