 
// Local dev seed — creates a test user, org, project for fast onboarding.
// Run with: pnpm --filter @grundtone-studio/studio db:seed

import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import postgres from 'postgres'
import { auth } from '../lib/auth'
import * as schema from './schema'

const TEST_USER = {
  email: 'admin@grundtone.local',
  password: 'grundtone-dev-1234',
  name: 'Studio Admin',
}
const TEST_ORG = { name: 'Acme Corp', slug: 'acme' }
const TEST_PROJECT = { name: 'Main', slug: 'main' }

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

const client = postgres(url, { max: 1, prepare: false })
const db = drizzle(client, { schema })

async function ensureUser() {
  const existing = await db.select().from(schema.user).where(eq(schema.user.email, TEST_USER.email))
  if (existing.length > 0) {
    console.log(`✓ user already exists: ${TEST_USER.email}`)
    return existing[0]
  }
  const res = await auth.api.signUpEmail({
    body: {
      email: TEST_USER.email,
      password: TEST_USER.password,
      name: TEST_USER.name,
    },
  })
  console.log(`✓ created user: ${TEST_USER.email}`)
  return res.user
}

async function ensureOrg(userId: string) {
  const existing = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.slug, TEST_ORG.slug))
  if (existing.length > 0) {
    console.log(`✓ org already exists: ${TEST_ORG.slug}`)
    return existing[0]
  }
  const id = crypto.randomUUID()
  await db.insert(schema.organization).values({
    id,
    name: TEST_ORG.name,
    slug: TEST_ORG.slug,
    createdAt: new Date(),
  })
  await db.insert(schema.member).values({
    id: crypto.randomUUID(),
    organizationId: id,
    userId,
    role: 'owner',
    createdAt: new Date(),
  })
  console.log(`✓ created org: ${TEST_ORG.slug} (owner = ${userId})`)
  return { id, name: TEST_ORG.name, slug: TEST_ORG.slug }
}

async function ensureProject(organizationId: string) {
  const existing = await db
    .select()
    .from(schema.project)
    .where(eq(schema.project.slug, TEST_PROJECT.slug))
  if (existing.length > 0) {
    console.log(`✓ project already exists: ${TEST_PROJECT.slug}`)
    return existing[0]
  }
  const [row] = await db
    .insert(schema.project)
    .values({
      organizationId,
      name: TEST_PROJECT.name,
      slug: TEST_PROJECT.slug,
    })
    .returning()
  console.log(`✓ created project: ${TEST_PROJECT.slug}`)
  return row
}

async function main() {
  const u = await ensureUser()
  const o = await ensureOrg(u.id)
  await ensureProject(o.id)
  console.log('')
  console.log('Login at http://localhost:3000/login')
  console.log(`  Email:    ${TEST_USER.email}`)
  console.log(`  Password: ${TEST_USER.password}`)
  console.log(`  Org URL:  http://localhost:3000/orgs/${TEST_ORG.slug}`)
}

await main()
await client.end()
