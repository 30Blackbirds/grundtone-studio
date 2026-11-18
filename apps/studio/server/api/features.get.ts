import { authMode } from '~~/server/lib/oidc/config'
import { billingEnabled } from '~~/server/lib/runtime-flags'

// Which optional surfaces this deployment has, so the UI hides what the server
// would refuse anyway. Only a convenience: every billing route enforces
// FEATURE_BILLING itself (requireBillingEnabled), so a stale answer here can
// show a link that 404s, never open a route that is off.

defineRouteMeta({
  openAPI: {
    summary: 'Which optional features this deployment has enabled.',
    description:
      'Public and cheap: no auth, no DB. `billing` mirrors FEATURE_BILLING; `authMode` is `better-auth` or `oidc`. The UI uses them to hide what this deployment does not have.',
    tags: ['System'],
  },
})

export default defineEventHandler(() => {
  return { billing: billingEnabled(), authMode: authMode() }
})
