import { assertRuntimeFlags } from '~~/server/lib/runtime-flags'

// Nitro runs plugins during app initialisation, before the server answers
// anything, so a throw here means the process never serves a request with an
// authorizer or a billing surface nobody chose.
//
// The rule, its message and its cells live in server/lib/runtime-flags.ts;
// this file only decides WHEN it is asked. runtime-flags.test.ts fails if this
// file stops calling it.
export default defineNitroPlugin(() => {
  assertRuntimeFlags()
})
