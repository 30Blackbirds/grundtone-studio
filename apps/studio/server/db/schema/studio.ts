import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

// Identity (user / organization / member / invitation) lives in the CENTRAL
// auth service's database — studio no longer hosts those tables. Studio tables
// reference the central user id (= JWT `sub`) and org id (= JWT `org`/tenant)
// as plain text, and DENORMALIZE the actor's email at write-time so audit /
// member / key / version views survive without a cross-service join back to
// auth. The `*Email` columns are captured from event.context.auth when the row
// is written and are intentionally nullable for legacy rows written before this
// refactor.

export const project = pgTable(
  'project',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: text().notNull(),
    slug: text().notNull(),
    name: text().notNull(),
    // The caller's OWN id for this project, supplied when it is created through
    // a provisioning key (KH-964 AC-B). It is what makes creation idempotent:
    // a beachhead builder that retries after a timeout must get the same
    // project back, not a second one. Null for projects created in the UI,
    // which has a human to notice a duplicate.
    externalRef: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('project_org_slug_idx').on(t.organizationId, t.slug),
    // 🔴 THE IDEMPOTENCY IS THE DATABASE'S, NOT THE HANDLER'S (AC-B3). Two
    // concurrent calls with the same externalRef must leave exactly one
    // project. A read-then-write in the handler cannot promise that — both
    // reads can miss before either writes. This index is what makes the second
    // INSERT lose, and the handler then returns the winner's row.
    //
    // Partial, because NULL is not a value: without the WHERE, every UI-created
    // project would share the NULL "ref" and only the first would be allowed
    // in Postgres' eyes — no, worse: NULLs do not conflict in a unique index,
    // so the index would be inert for them and nobody would notice. Stating it
    // explicitly keeps the rule readable instead of resting on NULL semantics.
    uniqueIndex('project_org_external_ref_idx')
      .on(t.organizationId, t.externalRef)
      .where(sql`${t.externalRef} IS NOT NULL`),
  ],
)

// Org suspension mirror. Studio enforces it: the /k CDN route serves normally
// until cdnGraceUntil passes, then answers 410, and deleting the row resumes
// delivery at once. Studio has no writer of its own; a deployment that
// suspends orgs writes it from a layer.
export const orgSuspension = pgTable('org_suspension', {
  organizationId: text().primaryKey(),
  suspendedAt: timestamp({ withTimezone: true }).notNull(),
  cdnGraceUntil: timestamp({ withTimezone: true }).notNull(),
  // Who suspended the org and why, kept with the row for the audit trail.
  reason: text().notNull(),
  actor: text().notNull(),
})

// Font-licens-erklæringer (jura-ruling 2026-08-04, docs/legal/
// consent-tekster.md): kunden indestår for at have ret til at lade os
// VIDEREDISTRIBUERE en uploadet skrifttype til deres slutbrugere. Erklæringen
// er hele vores forsvar hvis en skriftproducent rejser krav, så den skal
// kunne fremvises for præcis den bestridte fil.
//
// Juras tre krav formet dette bord: (2) endpointet afviser uden erklæring —
// UI-gaten er bekvemmelighed; (3) rækken har INGEN foreign key til projektet
// og slettes ALDRIG med filen — det er erklæringen, ikke filen, der er
// dokumentationen. Derfor også denormaliseret bruger-email og fil-reference
// som ren tekst: sporet skal kunne læses år efter at alt andet er væk.
// Erklæringen genafgives pr. fil (jura: den knytter sig til den enkelte
// skrifttypes licens, ikke til kontoen), så der er bevidst INGEN unique
// constraint der ville kollapse gentagne uploads af samme vægt.
export const fontLicenceAttestation = pgTable(
  'font_licence_attestation',
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid().notNull(),
    organizationId: text().notNull(),
    slot: text().notNull(),
    file: text().notNull(),
    weight: integer().notNull(),
    family: text().notNull(),
    version: text().notNull(),
    acceptedAt: timestamp({ withTimezone: true }).notNull(),
    userId: text().notNull(),
    userEmail: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // Retention-uret (jura §16a): sættes når filen HOLDER OP med at blive
    // serveret, ryddes hvis leveringen genoptages (rollback), sættes igen ved
    // fornyet ophør. NULL = filen serveres stadig, og uret er ikke begyndt.
    // Rækken slettes ATTESTATION_RETENTION_YEARS efter værdien.
    //
    // Juras pointe om hvorfor ét felt er nok: ny publish, slot-skift,
    // projektsletning og org-ophør adskiller sig i ÅRSAG, ikke i VIRKNING —
    // juridisk tæller kun hvornår vi holdt op med at sprede filen. Og en font
    // serveret i 20 minutter får samme frist som en serveret i tre år, fordi
    // kravet opstår af den krænkende handling, ikke af dens varighed.
    servingEndedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('font_licence_attestation_project_idx').on(t.projectId, t.createdAt),
    // Sletningen scanner på uret — ikke på projektet.
    index('font_licence_attestation_serving_ended_idx').on(t.servingEndedAt),
  ],
)

export const apiKey = pgTable(
  'api_key',
  {
    id: uuid().primaryKey().defaultRandom(),
    // 🔴 NULLABLE since KH-964, and the nullability is the whole point. A
    // provisioning key is ORG-scoped: it exists to CREATE projects, so it
    // cannot belong to one. `pk_`/`sk_` keys still carry a projectId; a
    // provisioning key carries an organizationId instead. Exactly one of the
    // two is set — enforced by the check constraint below, not by convention,
    // because a key belonging to both or to neither is a key nobody can reason
    // about.
    projectId: uuid().references(() => project.id, { onDelete: 'cascade' }),
    // Set only for provisioning keys. Orgs live in the central auth service, so
    // this is the same untyped id that `project.organizationId` carries — there
    // is no local table to reference.
    organizationId: text(),
    keyHash: text().notNull(),
    keyPrefix: text().notNull(),
    keyType: text().notNull().default('publishable'),
    environment: text().notNull().default('live'),
    allowedOrigins: jsonb()
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    rateLimit: integer().notNull().default(1000),
    lastUsedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    // Central user id (= JWT sub) of the creator, plus their email captured at
    // write-time so the keys list can attribute without an auth round-trip.
    createdBy: text().notNull(),
    createdByEmail: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('api_key_hash_idx').on(t.keyHash),
    // A key is scoped to exactly one thing. Without this, a provisioning key
    // with a stray projectId would be adjudicated as a project key by every
    // existing guard — the failure would look like a permission bug rather
    // than a data bug.
    check(
      'api_key_scope_exclusive',
      sql`(${t.projectId} IS NOT NULL AND ${t.organizationId} IS NULL)
          OR (${t.projectId} IS NULL AND ${t.organizationId} IS NOT NULL)`,
    ),
  ],
)

export const configVersion = pgTable(
  'config_version',
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    version: integer().notNull(),
    tokensJson: jsonb().$type<Record<string, unknown>>().notNull(),
    status: text().notNull().default('draft'),
    publishedAt: timestamp({ withTimezone: true }),
    publishedBy: text(),
    publishedByEmail: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('config_version_project_version_idx').on(t.projectId, t.version)],
)

export const activeVersion = pgTable('active_version', {
  projectId: uuid()
    .primaryKey()
    .references(() => project.id, { onDelete: 'cascade' }),
  configVersionId: uuid()
    .notNull()
    .references(() => configVersion.id, { onDelete: 'restrict' }),
  activatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  activatedBy: text().notNull(),
  activatedByEmail: text(),
})

// Per-project membership for users who shouldn't see the whole org but need
// access to specific projects (e.g. an external collaborator on one client
// brand). Effective role = max(org-role, project-role); org owners always win.
export const projectMember = pgTable(
  'project_member',
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    // Central user id (= JWT sub). Denormalized email/name captured when the
    // membership row is written (invite accept), so the members list renders
    // without joining auth's user table.
    userId: text().notNull(),
    memberEmail: text(),
    memberName: text(),
    role: text().notNull(),
    invitedBy: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('project_member_unique_idx').on(t.projectId, t.userId),
    index('project_member_user_idx').on(t.userId),
  ],
)

// Who holds which org role, recorded by studio itself. The JWT carries the org
// id but no role, and until now studio had no local record of org roles: they
// lived in auth and, mirrored by auth's hooks, in the permissions service.
//
// The studio routes for org membership write it in the same transaction as
// their audit row. The LOCAL authorizer (server/lib/local-authorizer.ts) reads
// it; with AUTHORIZER=pdp the permissions service decides and this table is
// not read for access.
//
// One role per (org, user): studio's own UI treats org roles as a single rank
// (ORG_ROLES), even though the permissions model could store several.
export const orgMember = pgTable(
  'org_member',
  {
    organizationId: text().notNull(),
    // Central user id (= JWT sub).
    userId: text().notNull(),
    role: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('org_member_unique_idx').on(t.organizationId, t.userId),
    index('org_member_user_idx').on(t.userId),
    // A role nothing knows would grant nothing and look like a permission bug;
    // refuse it at the write instead.
    check(
      'org_member_role_known',
      sql`${t.role} IN ('owner', 'manager', 'admin', 'member', 'billing')`,
    ),
  ],
)

// Machine (per-project secret key) grants for the LOCAL authorizer: the
// counterpart of the permissions model's `editor: [user, machine]`. A key can
// only ever be editor, never admin, so a key cannot raise its own rights.
export const projectMachineGrant = pgTable(
  'project_machine_grant',
  {
    projectId: uuid()
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    apiKeyId: uuid()
      .notNull()
      .references(() => apiKey.id, { onDelete: 'cascade' }),
    role: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('project_machine_grant_unique_idx').on(t.projectId, t.apiKeyId),
    check('project_machine_grant_editor_only', sql`${t.role} = 'editor'`),
  ],
)

// Postmark delivery / bounce / spam-complaint events, captured via the
// /api/email/webhook receiver. Append-only — used to attribute hard bounces
// to a recipient and to flag spam complaints. The full webhook body is
// preserved in `payload` for forensics if Postmark's structured fields don't
// cover a future event type.
export const emailEvent = pgTable(
  'email_event',
  {
    id: uuid().primaryKey().defaultRandom(),
    // Postmark's MessageID from the original send. Pairs the event back to
    // the outbound message even when the recipient address has been
    // suppressed since.
    messageId: text(),
    recipient: text().notNull(),
    // Delivery | Bounce | SpamComplaint | Open | Click | SubscriptionChange.
    // Stored verbatim from Postmark's RecordType field.
    eventType: text().notNull(),
    // Set on Bounce events: HardBounce | SoftBounce | Transient | Blocked …
    // Empty for Delivery/SpamComplaint/Open/Click.
    bounceType: text(),
    description: text(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('email_event_recipient_idx').on(t.recipient),
    index('email_event_message_idx').on(t.messageId),
    index('email_event_received_idx').on(t.receivedAt),
  ],
)

// Append-only audit log for org-level actions. Never delete rows. Captures
// who did what, on which target, before/after state, IP, and timestamp.
// The viewer at /orgs/[slug]/audit reads from this; mutations write via the
// recordAuditEvent helper in server/lib/audit.ts.
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: text().notNull(),
    actorUserId: text(),
    // Denormalized so audit rows survive user deletion. Captured at write-time
    // from the actor's session and stays put forever.
    actorEmail: text(),
    action: text().notNull(),
    targetType: text(),
    targetId: text(),
    // Human-readable label captured at write-time (e.g. project name or
    // member email at the moment of the action). Denormalized for the same
    // reason as actorEmail.
    targetLabel: text(),
    before: jsonb().$type<Record<string, unknown>>(),
    after: jsonb().$type<Record<string, unknown>>(),
    ipAddress: text(),
    userAgent: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_org_created_idx').on(t.organizationId, t.createdAt),
    index('audit_log_actor_idx').on(t.actorUserId),
    index('audit_log_action_idx').on(t.action),
  ],
)

export const projectInvitation = pgTable(
  'project_invitation',
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    email: text().notNull(),
    role: text().notNull(),
    status: text().notNull().default('pending'),
    invitedBy: text().notNull(),
    invitedByEmail: text(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('project_invitation_project_idx').on(t.projectId),
    index('project_invitation_email_idx').on(t.email),
  ],
)

// Outbox for events Studio publishes to account's AccountIngestService
// (eventcontract v1, at-least-once). The row id IS the event's idempotency_key:
// stable across retries, so account's inbox answers `duplicate` on a replay.
//
// Today it carries one event type, `tenantProvisioned`: the first time Studio
// serves an org, account learns the org is a grundtone-studio tenant (company +
// membership). The partial unique index makes that at most once per org, so a
// second touch, a second replica or the backfill all collapse into the same row.
//
// Delivered rows are kept: they are the record of what Studio told account.
// A row account rejected as malformed (400) is parked, never retried — the
// contract says a 400 is permanent and resending it would hammer forever.
export const tenantEventOutbox = pgTable(
  'tenant_event_outbox',
  {
    id: uuid().primaryKey(),
    eventType: text().notNull(),
    organizationId: text().notNull(),
    // The full proto-JSON `Event` as sent, idempotencyKey included.
    event: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastError: text(),
    deliveredAt: timestamp({ withTimezone: true }),
    parkedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('tenant_event_outbox_provisioned_once_idx')
      .on(t.organizationId)
      .where(sql`${t.eventType} = 'tenantProvisioned'`),
    index('tenant_event_outbox_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.deliveredAt} IS NULL AND ${t.parkedAt} IS NULL`),
  ],
)

// ─── Standalone OIDC login (AUTH_MODE=oidc) ───────────────────────────────
// See docs/design/standalone-oidc.md. These tables are only written in oidc
// mode; better-auth mode never touches them.

// A person known to Studio. `id` is Studio's own key. It is deliberately NOT the
// IdP subject: the (issuer, subject) pair lives in user_identity, so one IdP
// subject can never be confused with another IdP's.
export const appUser = pgTable('app_user', {
  id: text().primaryKey(),
  email: text(),
  emailVerified: boolean().notNull().default(false),
  name: text(),
  // Set by the instance operator. A disabled user is refused at login and (once
  // sessions exist) at every request.
  disabledAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp({ withTimezone: true }),
})

// (issuer, subject) -> user. Two identities are never merged because their
// e-mail addresses match.
export const userIdentity = pgTable(
  'user_identity',
  {
    issuer: text().notNull(),
    subject: text().notNull(),
    userId: text()
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_identity_unique_idx').on(t.issuer, t.subject),
    index('user_identity_user_idx').on(t.userId),
  ],
)

// One row per login attempt in flight. The browser holds only the random state
// (in a cookie); the PKCE verifier and nonce stay here, and the row is deleted
// when the callback consumes it, so a callback URL can be used once.
export const oidcLogin = pgTable(
  'oidc_login',
  {
    // SHA-256 of the state value.
    stateHash: text().primaryKey(),
    codeVerifier: text().notNull(),
    nonce: text().notNull(),
    // Same-origin relative path to return to after login.
    next: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [index('oidc_login_expires_idx').on(t.expiresAt)],
)

// Browser sessions in AUTH_MODE=oidc. The cookie holds a random token; only its
// SHA-256 is stored, so a leaked table cannot be replayed as cookies. Disabling
// a user deletes their rows, and every lookup re-reads the user, so a disabled
// user is out on the next request, not when a token expires.
export const appSession = pgTable(
  'app_session',
  {
    tokenHash: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    // Chosen inside Studio (the JWT "org" claim does not exist in oidc mode).
    activeOrganizationId: text(),
    // Kept server-side only, as the id_token_hint of RP-initiated logout.
    idToken: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // Absolute end of life; idle timeout is checked against lastSeenAt.
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    index('app_session_user_idx').on(t.userId),
    index('app_session_expires_idx').on(t.expiresAt),
  ],
)

// ─── Studio-owned organisations (AUTH_MODE=oidc) ──────────────────────────
// In better-auth mode organisations live in the auth service and these two
// tables stay empty. org_member (above) is shared: its organizationId is this
// table's id in oidc mode, the auth service's in better-auth mode, which is why
// it carries no foreign key.

export const organization = pgTable(
  'organization',
  {
    id: text().primaryKey(),
    name: text().notNull(),
    slug: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('organization_slug_unique_idx').on(t.slug)],
)

// Marks an org_member row as granted by the IdP role claim (OIDC_ROLE_MAP), so
// the next login can update or withdraw it. A row WITHOUT a marker was assigned
// in Studio and the claim never touches it; any change made in Studio removes
// the marker. org_member itself keeps its shape.
export const orgMemberClaim = pgTable(
  'org_member_claim',
  {
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('org_member_claim_unique_idx').on(t.organizationId, t.userId)],
)

// An invitation changes no role until it is accepted. Only the SHA-256 of the
// token is stored; the plaintext goes out once, in the link.
export const orgInvitation = pgTable(
  'org_invitation',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    // Lower-cased.
    email: text().notNull(),
    role: text().notNull(),
    tokenHash: text().notNull(),
    invitedBy: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('org_invitation_token_idx').on(t.tokenHash),
    index('org_invitation_org_idx').on(t.organizationId),
    check(
      'org_invitation_role_known',
      sql`${t.role} IN ('owner', 'manager', 'admin', 'member', 'billing')`,
    ),
  ],
)
