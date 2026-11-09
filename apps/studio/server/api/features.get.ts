import { billingEnabled } from '~~/server/lib/runtime-flags'

// Which optional surfaces this deployment has, so the UI hides what the server
// would refuse anyway. Only a convenience: every billing route enforces
// FEATURE_BILLING itself (requireBillingEnabled), so a stale answer here can
// show a link that 404s, never open a route that is off.

defineRouteMeta({
  openAPI: {
    summary: 'Which optional features this deployment has enabled.',
    description:
      'Public and cheap: no auth, no DB. `billing` mirrors FEATURE_BILLING. The UI uses it to hide the billing page and its link.',
    tags: ['System'],
  },
})

export default defineEventHandler(() => {
  return { billing: billingEnabled() }
})
