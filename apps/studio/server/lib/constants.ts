// Cross-cutting status / enum tuples. Used as the single source of truth
// for `z.enum(...)` schemas and as the type backbone for query parameters.
// Call-sites still write the bare literal (`'draft'`, `'pending'`) because
// TypeScript already catches typos against the union type — keep this
// file lean.

// ─── API key environment ─────────────────────────────────────────────────
// The common publishable-key convention, pk_live_ / pk_test_. Live keys belong on
// production frontends; test keys are intended for dev / staging surfaces
// that need a working CDN flow without burning real customer quotas.
//
// (ConfigVersionStatus + ProjectInvitationStatus were considered but had
// no zod consumer at the time of writing — defining them here would be
// dead code. Re-add when the first consumer lands.)
export const API_KEY_ENVIRONMENTS = ['live', 'test'] as const
export type ApiKeyEnvironment = (typeof API_KEY_ENVIRONMENTS)[number]
