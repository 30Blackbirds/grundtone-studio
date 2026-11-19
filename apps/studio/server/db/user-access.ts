// Operator command: disable or enable a user in AUTH_MODE=oidc.
//
//   pnpm --filter @grundtone-studio/studio user:disable -- --sub <idp-subject> [--issuer <url>]
//   pnpm --filter @grundtone-studio/studio user:enable  -- --id <user id>
//
// The user is named by --sub (with --issuer, default OIDC_ISSUER), --id, or
// --email (refused when several users share the address). Disabling ends every
// session at once and refuses the person at every request and login; their
// roles are kept, so enabling gives them back after a new sign-in. The last
// enabled owner of an organisation cannot be disabled.
import { inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { LastOwnerError } from '../lib/oidc/sessions'
import { setUserAccess, UserAccessError, type UserRef } from '../lib/oidc/user-access'
import * as schema from './schema'

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}

const USAGE =
  'usage: user-access (disable | enable) (--sub <idp-subject> [--issuer <url>] | --id <user id> | --email <address>)'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')
const action = process.argv[2]
const sub = flag('sub')
const id = flag('id')
const email = flag('email')
const given = [sub, id, email].filter((v) => v !== undefined).length
if ((action !== 'disable' && action !== 'enable') || given !== 1) {
  console.error(USAGE)
  process.exit(2)
}

const ref: UserRef = sub
  ? { sub, issuer: flag('issuer') ?? process.env.OIDC_ISSUER ?? '' }
  : id
    ? { id }
    : { email: email! }

const client = postgres(url, { max: 1, prepare: false })
try {
  const db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Parameters<
    typeof setUserAccess
  >[0]
  const r = await setUserAccess(db, ref, action)
  const verb = action === 'disable' ? 'disabled' : 'enabled'
  const after =
    action === 'disable' ? 'their sessions are ended' : 'they sign in anew to get their roles back'
  console.log(
    r.changed
      ? `${verb} user ${r.userId}; ${after}.`
      : `user ${r.userId} was already ${verb}; any open sessions are ended.`,
  )
} catch (err) {
  if (err instanceof LastOwnerError) {
    const orgs = await drizzle(client, { schema, casing: 'snake_case' })
      .select({ slug: schema.organization.slug })
      .from(schema.organization)
      .where(inArray(schema.organization.id, err.organizationIds))
    console.error(
      `refused: the user is the only enabled owner of ${orgs.map((o) => `"${o.slug}"`).join(', ')}. Make someone else owner first.`,
    )
    process.exitCode = 1
  } else if (err instanceof UserAccessError) {
    console.error(err.message)
    process.exitCode = 1
  } else throw err
} finally {
  await client.end()
}
