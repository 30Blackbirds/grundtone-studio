import { sql } from 'drizzle-orm'
import {
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
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('project_org_slug_idx').on(t.organizationId, t.slug)],
)

// Org suspension mirror (kontrakt §8a/§9 + ToS §10.2): account's
// TenantLifecycleCallbackService writes this via POST /api/lifecycle/
// tenant-state on suspend/reactivate. cdnGraceUntil comes FROM account
// (single source for the 14-day grace, Allan-approved 2026-08-02) — the
// /k CDN route serves normally until it passes, then 410s. Reactivation
// deletes the row → delivery resumes immediately.
export const orgSuspension = pgTable('org_suspension', {
  organizationId: text().primaryKey(),
  suspendedAt: timestamp({ withTimezone: true }).notNull(),
  cdnGraceUntil: timestamp({ withTimezone: true }).notNull(),
  // §9a: audit-kæden fra accounts kanoniske TenantLifecycleCallbackService —
  // fx actor=system:dunning m/ reason der bærer grace-udløbstidspunktet.
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
    projectId: uuid()
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
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
  (t) => [uniqueIndex('api_key_hash_idx').on(t.keyHash)],
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
