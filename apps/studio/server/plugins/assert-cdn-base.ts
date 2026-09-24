import { assertCdnBaseConfigured } from '~~/server/lib/cdn-base-required'

// Nitro runs plugins during app initialisation, before the server answers
// anything, so a throw here means the process never serves a request with a
// host it cannot stand behind.
//
// The rule, its message and its cells live in server/lib/cdn-base-required.ts;
// this file only decides WHEN it is asked. cdn-base-required.test.ts fails if
// this file stops calling it — losing it would fail OPEN, which is the whole
// failure this guards against.
export default defineNitroPlugin(() => {
  assertCdnBaseConfigured(useRuntimeConfig().public.cdnBase, process.env.NODE_ENV)
})
