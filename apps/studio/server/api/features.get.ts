import { authMode } from '~~/server/lib/oidc/config'
import { featureEnabled } from '~~/server/lib/features'

// Which optional surfaces this deployment has, so the UI hides what the server
// would refuse anyway. Only a convenience: a layer's routes enforce their own
// switch, so a stale answer here can show a link that 404s, never open a route
// that is off.

defineRouteMeta({
  openAPI: {
    summary: 'Which optional features this deployment has enabled.',
    description:
      'Public and cheap: no auth, no DB. `billing` is true only when a layer registered a billing surface and switched it on; `authMode` is `better-auth` or `oidc`. The UI uses them to hide what this deployment does not have.',
    tags: ['System'],
  },
})

export default defineEventHandler(() => {
  return { billing: featureEnabled('billing'), authMode: authMode() }
})
