import { sql } from 'drizzle-orm'
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

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
