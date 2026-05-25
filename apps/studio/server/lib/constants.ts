// Cross-cutting status / enum tuples. Used as the single source of truth
// for `z.enum(...)` schemas and as the type backbone for query parameters
// — but call-sites still write the bare literal (`'draft'`, `'pending'`)
// because TypeScript already catches typos against the union type. The
// previous shape exposed an extra object map (`STATUS.DRAFT`) but it
// only added syntactic noise on a 2-3-value domain.

// ─── Config version lifecycle ────────────────────────────────────────────
// Draft = in-progress edit. Published = immutable archive.
export const CONFIG_VERSION_STATUSES = ['draft', 'published'] as const
export type ConfigVersionStatus = (typeof CONFIG_VERSION_STATUSES)[number]

// ─── Project invitation lifecycle ────────────────────────────────────────
// pending → accepted (recipient clicked link) or cancelled (inviter revoked).
export const PROJECT_INVITATION_STATUSES = ['pending', 'accepted', 'cancelled'] as const
export type ProjectInvitationStatus = (typeof PROJECT_INVITATION_STATUSES)[number]

// ─── API key environment ─────────────────────────────────────────────────
// Mirrors Stripe's pk_live_ / pk_test_ convention.
export const API_KEY_ENVIRONMENTS = ['live', 'test'] as const
export type ApiKeyEnvironment = (typeof API_KEY_ENVIRONMENTS)[number]
