import type { StudioExtensions } from './lib/extensions'

// Studio's own entries in the layer registries (lib/extensions.ts says how a
// layer adds to them). The billing link and the payment processor are still
// registered here until the billing code moves to its own layer.
export default defineAppConfig({
  studio: {
    orgNav: [
      {
        id: 'billing',
        path: 'billing',
        labelKey: 'billing.nav',
        gate: 'billing',
        feature: 'billing',
      },
    ],
    legalProcessors: ['upcloud', 'bunny', 'stripe', 'postmark', 'sentry', 'proton'],
  } satisfies StudioExtensions,
})
