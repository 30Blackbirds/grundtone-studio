import type { OrgNavItem, StudioExtensions } from './lib/extensions'

// Studio's own entries in the layer registries (lib/extensions.ts says how a
// layer adds to them). A self-hosted Studio has no extra org links and no
// upgrade page; the processors are the ones every deployment of this code uses.
export default defineAppConfig({
  studio: {
    orgNav: [] as OrgNavItem[],
    upgradePath: undefined as string | undefined,
    legalProcessors: ['upcloud', 'bunny', 'postmark', 'sentry', 'proton'],
  } satisfies StudioExtensions,
})
