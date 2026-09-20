import { assertBypassBindsLoopback } from '~~/server/lib/dev-auth-bypass'

// 🔴 THE BIND ASSERTION RUNS WHEN A LISTENER IS STARTED, WHICH IS WHAT IT IS
// ABOUT. Nitro runs plugins during app initialisation, before the server
// answers anything, so a throw here means the process never serves a request —
// the same outcome as the module-scope call it replaces, for the one kind of
// process the assertion actually describes.
//
// It moved out of dev-auth-bypass.ts because that module is also imported by
// things that open no port. MEASURED: `pnpm db:seed` with the bypass on and
// HOST unset died with "refusing to start a bypassed server that other machines
// can reach" — true about the variable, false about the process.
//
// Keep the call here rather than inlining the check: the rule, its message and
// its cells live in one module, and this file only decides WHEN it is asked.
// dev-auth-bypass.test.ts fails if this file stops calling it, because losing
// it would fail OPEN.
export default defineNitroPlugin(() => {
  assertBypassBindsLoopback()
})
