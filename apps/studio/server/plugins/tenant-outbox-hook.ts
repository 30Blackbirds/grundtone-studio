import { onOrgServed } from '~~/server/lib/org-hooks'
import { ensureTenantProvisioned } from '~~/server/lib/tenant-outbox'

// Wires the account announcement (tenantProvisioned, queued at an org's first
// use) to the org-served hook. ensureTenantProvisioned remembers the orgs it
// has queued and never throws. This is the one piece that moves to the
// billing overlay together with tenant-outbox.ts.
export default defineNitroPlugin(() => {
  onOrgServed(async (org) => {
    await ensureTenantProvisioned(org)
  })
})
