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

// Better Auth owns the `organization` and `member` tables via its plugin.
// We reference organization.id via text (Better Auth uses text IDs).

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
    createdBy: text().notNull(),
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
    userId: text().notNull(),
    role: text().notNull(),
    invitedBy: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('project_member_unique_idx').on(t.projectId, t.userId),
    index('project_member_user_idx').on(t.userId),
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
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('project_invitation_project_idx').on(t.projectId),
    index('project_invitation_email_idx').on(t.email),
  ],
)
