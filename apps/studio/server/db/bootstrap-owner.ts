// Operator command: make an e-mail address the owner of an organisation.
//
//   pnpm --filter @grundtone-studio/studio bootstrap:owner -- \
//     --email you@example.com --org acme [--name "Acme"]
//
// Creates the organisation when `--name` is given and it does not exist. If the
// address already has a Studio user it becomes owner now; otherwise a one-use
// invitation link is printed (once) for that address to accept after signing in.
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { bootstrapOwner, BootstrapError } from '../lib/oidc/bootstrap'
import * as schema from './schema'

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')
const email = flag('email')
const orgSlug = flag('org')
if (!email || !orgSlug) {
  console.error(
    'usage: bootstrap:owner --email <address> --org <slug> [--name <organisation name>]',
  )
  process.exit(2)
}

const client = postgres(url, { max: 1, prepare: false })
try {
  const db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Parameters<
    typeof bootstrapOwner
  >[0]
  const orgName = flag('name')
  const res = await bootstrapOwner(db, { email, orgSlug, ...(orgName ? { orgName } : {}) })
  const org = res.created ? 'created organisation and ' : ''
  if (res.kind === 'member') {
    console.log(`${org}made ${email} owner of "${orgSlug}".`)
  } else {
    const base = (process.env.NUXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
    console.log(
      `${org}created an owner invitation for ${email} (valid until ${res.expiresAt.toISOString()}).`,
    )
    console.log(`Send them this link; it is shown once:\n${base}/invitations/${res.token}`)
  }
} catch (err) {
  if (err instanceof BootstrapError) {
    console.error(err.message)
    process.exitCode = 1
  } else throw err
} finally {
  await client.end()
}
