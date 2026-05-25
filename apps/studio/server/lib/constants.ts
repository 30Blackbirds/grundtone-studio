// Cross-cutting status / enum constants. Single source of truth for values
// that appear in zod schemas, Drizzle queries, audit-log payloads, and UI
// gates. Bare string literals in any of those places should import from
// here instead — that's what makes a rename safe.
//
// Each domain exposes two shapes:
//   - `*_STATUSES` / `*_ENVIRONMENTS` — a readonly tuple for zod (`z.enum(...)`)
//     and for iteration when the UI lists all possible values
//   - `*_STATUS` / `*_ENVIRONMENT` — an object map for individual references
//     so code reads `CONFIG_VERSION_STATUS.DRAFT` instead of the bare 'draft'

// ─── Config version lifecycle ────────────────────────────────────────────
// Draft = the in-progress edit. Published = immutable archive (linked from
// active_version when current). A version can only move draft → published;
// rollback is achieved by activating a different published version, not by
// flipping status backwards.
export const CONFIG_VERSION_STATUSES = ['draft', 'published'] as const
export type ConfigVersionStatus = (typeof CONFIG_VERSION_STATUSES)[number]
export const CONFIG_VERSION_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
} as const satisfies Record<string, ConfigVersionStatus>

// ─── Project invitation lifecycle ────────────────────────────────────────
// pending  — sent, awaiting recipient action
// accepted — recipient clicked the accept link; project_member row exists
// cancelled — inviter (or admin) revoked the invite before acceptance
// (No 'expired' here yet; we rely on a cron sweep against expires_at and
// either cancel the row or let it sit. Add to this union if we ever
// introduce a distinct expired state in the schema.)
export const PROJECT_INVITATION_STATUSES = ['pending', 'accepted', 'cancelled'] as const
export type ProjectInvitationStatus = (typeof PROJECT_INVITATION_STATUSES)[number]
export const PROJECT_INVITATION_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  CANCELLED: 'cancelled',
} as const satisfies Record<string, ProjectInvitationStatus>

// ─── API key environment ─────────────────────────────────────────────────
// Mirrors Stripe's pk_live_ / pk_test_ convention. Live keys belong on
// production frontends; test keys are intended for dev / staging surfaces
// that need a working CDN flow without burning real customer quotas.
export const API_KEY_ENVIRONMENTS = ['live', 'test'] as const
export type ApiKeyEnvironment = (typeof API_KEY_ENVIRONMENTS)[number]
export const API_KEY_ENVIRONMENT = {
  LIVE: 'live',
  TEST: 'test',
} as const satisfies Record<string, ApiKeyEnvironment>
