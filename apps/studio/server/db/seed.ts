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
import { and, eq } from 'drizzle-orm'
import postgres from 'postgres'
import * as schema from './schema'
import { DEV_BYPASS_ORG, DEV_BYPASS_USER } from '../lib/dev-auth-bypass'
import { AUDIT_ACTIONS } from '../lib/audit'

const TEST_PROJECT = { name: 'Main', slug: 'main' }

const bypassSeed = process.env.STUDIO_DEV_AUTH_BYPASS === '1'

/** An audit action the app really knows, or a loud failure. See its use below. */
function assertAction(action: string): string {
  if (!(AUDIT_ACTIONS as readonly string[]).includes(action)) {
    throw new Error(
      `seed: '${action}' is not in AUDIT_ACTIONS — it would render as a raw i18n key. ` +
        `Known actions: ${AUDIT_ACTIONS.join(', ')}`,
    )
  }
  return action
}

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

// 🔴 THE LOCAL DESIGN-REVIEW PATH (server/lib/dev-auth-bypass.ts). With the
// bypass on, there is no central auth service to provision anything in, so the
// ids default to the bypass's own synthetic ones — and ONLY then. Without the
// bypass this stays exactly as strict as before: no ids, no seed.
//
// Note the deliberate coupling: importing the bypass module also runs its
// leak assertion, so `STUDIO_DEV_AUTH_BYPASS=1` without `NODE_ENV=development`
// stops the seed too, with the same message the server would give. The two
// variables travel together or not at all.
const organizationId = process.env.SEED_ORG_ID ?? (bypassSeed ? DEV_BYPASS_ORG.id : undefined)
const userId = process.env.SEED_USER_ID ?? (bypassSeed ? DEV_BYPASS_USER.id : undefined)
if (!organizationId) {
  throw new Error(
    'SEED_ORG_ID is not set — provision the org in the central auth service first ' +
      '(rockfaker / [infra]) and pass its id here. For a local design review, set ' +
      'NODE_ENV=development and STUDIO_DEV_AUTH_BYPASS=1 instead.',
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

// 🔴 ONLY FOR THE BYPASS PATH, and only synthetic rows. A design reviewer needs
// something to look at: an empty members table, an empty audit log and an empty
// key list all render as the same blank panel, and a reviewer cannot tell "no
// data" from "broken page". Every value below is obviously fictional
// (`localhost.invalid`, `dev-bypass-…`) so a seeded row can never be mistaken
// for a real one in a screenshot or a database.
//
// NOTHING IS COPIED FROM PRODUCTION. The key row carries a hash of a literal
// string that is not a usable key, and it is never printed.
async function seedDesignReviewRows(orgId: string, actorId: string, projectId: string) {
  const existing = await db
    .select()
    .from(schema.projectMember)
    .where(
      and(eq(schema.projectMember.projectId, projectId), eq(schema.projectMember.userId, actorId)),
    )
  if (existing.length === 0) {
    await db.insert(schema.projectMember).values({
      projectId,
      userId: actorId,
      memberEmail: DEV_BYPASS_USER.email,
      memberName: DEV_BYPASS_USER.name,
      role: 'admin',
    })
    console.log('✓ project membership (admin) for the local review user')
  }

  const audit = await db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.organizationId, orgId))
  if (audit.length === 0) {
    // 🔴 THE ACTION NAMES COME FROM AUDIT_ACTIONS, NOT FROM MEMORY, and this is
    // not defensive programming — it is a bug I made and saw on the rendered
    // page. My first version wrote 'apikey.created'; the real action is
    // 'api_key.created', so the dashboard showed
    // `audit.actions['apikey.created']` — a raw i18n key, indistinguishable
    // from the defect KH-1037 cured. A reviewer would have reported the page.
    // Seed data that a designer JUDGES has to be as correct as product data,
    // and `assertAction` makes a rename fail the seed instead of quietly
    // producing raw keys again.
    await db.insert(schema.auditLog).values(
      (
        [
          [assertAction('project.created'), 'project', TEST_PROJECT.name],
          [assertAction('config.published'), 'project', TEST_PROJECT.name],
          [assertAction('api_key.created'), 'api_key', 'gt_pub_devbypass'],
          [assertAction('member.invited'), 'member', 'bo@localhost.invalid'],
        ] as const
      ).map(([action, targetType, targetLabel], i) => ({
        organizationId: orgId,
        actorUserId: actorId,
        actorEmail: DEV_BYPASS_USER.email,
        action,
        targetType,
        targetLabel,
        createdAt: new Date(Date.now() - (i + 1) * 3_600_000),
      })),
    )
    console.log('✓ 4 audit rows, so the audit log has something to render')
  }

  // 🔴 A PROJECT WITH NO PUBLISHED CONFIG IS A STATE THE PRODUCT CANNOT REACH
  // ALONGSIDE THESE AUDIT ROWS, and [designer] spotted the contradiction before
  // I did: the card showed no token count, the stats said Published 0 and
  // "Since publish —", while the activity list said "Published configuration
  // 2 hr. ago". Measured in the code: tokenCount, status and the swatch colour
  // ALL come from the activeVersion -> configVersion join, and my first seed
  // created neither. The audit rows were written straight to the table, so they
  // described a project state that did not exist.
  //
  // Fixture data a designer JUDGES has to be internally consistent, or they
  // spend their attention deciding whether a contradiction is the product.
  const versions = await db
    .select()
    .from(schema.configVersion)
    .where(eq(schema.configVersion.projectId, projectId))
  if (versions.length === 0) {
    const publishedAt = new Date(Date.now() - 2 * 3_600_000) // matches the audit row
    const [version] = await db
      .insert(schema.configVersion)
      .values({
        projectId,
        version: 1,
        status: 'published',
        publishedAt,
        publishedBy: actorId,
        publishedByEmail: DEV_BYPASS_USER.email,
        tokensJson: {
          colors: {
            primary: '#3b5bdb',
            secondary: '#5c7cfa',
            background: '#ffffff',
            surface: '#f8f9fa',
            text: '#212529',
          },
          typography: { fontFamily: { base: 'IBM Plex Sans', mono: 'IBM Plex Mono' } },
          radius: { sm: '4px', md: '8px', lg: '12px' },
        },
      })
      .returning()
    if (version) {
      await db.insert(schema.activeVersion).values({
        projectId,
        configVersionId: version.id,
        activatedAt: publishedAt,
        activatedBy: actorId,
        activatedByEmail: DEV_BYPASS_USER.email,
      })
      console.log('✓ 1 published config version + active pointer')
    }
  }

  const keys = await db.select().from(schema.apiKey).where(eq(schema.apiKey.projectId, projectId))
  if (keys.length === 0) {
    await db.insert(schema.apiKey).values({
      projectId,
      // Not a usable key: a hash of a literal marker string, never printed.
      keyHash: 'dev-bypass-not-a-real-key-hash',
      keyPrefix: 'gt_pub_devbypass',
      createdBy: actorId,
      createdByEmail: DEV_BYPASS_USER.email,
    })
    console.log('✓ 1 api key row, so the keys list is not empty')
  }
}

async function main(orgId: string) {
  const p = await ensureProject(orgId)
  if (bypassSeed && p && userId) await seedDesignReviewRows(orgId, userId, p.id)
  console.log('')
  console.log('Studio project seeded.')
  console.log(`  Project: ${p.name} (${p.slug})  id=${p.id}  org=${orgId}`)
  console.log('')
  if (bypassSeed) {
    // The reminder below is wrong on this path and would send the reader to
    // another team for something they do not need.
    console.log('Local design review: start the server with NODE_ENV=development and')
    console.log('STUDIO_DEV_AUTH_BYPASS=1, and open it on localhost. No sign-in needed.')
  } else {
    console.log('Reminder: sign in via the CENTRAL auth service, and ensure the PDP has the')
    console.log('org→project parent tuple + your admin grant (rockfaker / [infra] writes these).')
  }
}

await main(organizationId)
await client.end()
