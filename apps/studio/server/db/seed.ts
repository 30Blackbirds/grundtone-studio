// Local dev seed — creates a studio project for fast onboarding.
//
// IMPORTANT (Phase 2 refactor): studio no longer runs Better Auth, so it can no
// longer sign up a user / create an org locally. Identity (user + org +
// membership) is provisioned in the CENTRAL auth service — by rockfaker, run by
// [infra]. This seed only creates studio-owned rows (the project), keyed to a
// user id (= JWT sub) and org id (= JWT org/tenant) that already exist in
// central auth.
//
// Provide those ids via env so the seed stays decoupled from auth:
//   SEED_USER_ID  — central auth user id of the test user (becomes project admin)
//   SEED_ORG_ID   — central auth organization id the project belongs to
//
// The project's PDP membership (org→project parent tuple + creator admin grant)
// is NOT written here — it's an authenticated RPC against the PDP. [infra]'s
// rockfaker seed is the right place to write those tuples alongside the auth/org
// provisioning. See the report handed to [infra].
//
// Run with: pnpm --filter @grundtone-studio/studio db:seed

import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import postgres from 'postgres'
import * as schema from './schema'

const TEST_PROJECT = { name: 'Main', slug: 'main' }

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

const organizationId = process.env.SEED_ORG_ID
if (!organizationId) {
  throw new Error(
    'SEED_ORG_ID is not set — provision the org in the central auth service first ' +
      '(rockfaker / [infra]) and pass its id here.',
  )
}

const client = postgres(url, { max: 1, prepare: false })
const db = drizzle(client, { schema, casing: 'snake_case' })

async function ensureProject(orgId: string) {
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
      organizationId: orgId,
      name: TEST_PROJECT.name,
      slug: TEST_PROJECT.slug,
    })
    .returning()
  console.log(`✓ created project: ${TEST_PROJECT.slug} (org = ${orgId})`)
  return row
}

async function main(orgId: string) {
  const p = await ensureProject(orgId)
  console.log('')
  console.log('Studio project seeded.')
  console.log(`  Project: ${p.name} (${p.slug})  id=${p.id}  org=${orgId}`)
  console.log('')
  console.log('Reminder: sign in via the CENTRAL auth service, and ensure the PDP has the')
  console.log('org→project parent tuple + your admin grant (rockfaker / [infra] writes these).')
}

await main(organizationId)
await client.end()
