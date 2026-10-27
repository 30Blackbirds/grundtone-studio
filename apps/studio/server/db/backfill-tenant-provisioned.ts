// Queues tenantProvisioned for every org Studio already has a trace of, so
// account gets a company + grundtone-studio membership for orgs that existed
// before the producer (server/lib/tenant-outbox.ts) went live. The scheduled
// `outbox:deliver` task sends the rows; this script only writes the outbox.
//
//   node --import tsx server/db/backfill-tenant-provisioned.ts --cutover <ISO> [--apply]
//
// 🔴 IT REFUSES WITHOUT `--cutover`, and refuses if any org would land on or
// after it. Account assigns the plan from provisioned_at (contract §3): before
// LEGACY_CUTOVER_BY_PORTAL['grundtone-studio'] ⇒ studio-legacy (unlimited),
// otherwise studio-free. Until account serves that value, EVERY event gets the
// free plan, and announcing an existing org would drop it to free limits.
// `--cutover` is the value the operator has READ from account's served
// revision — not the merged one, not a planned date. The script cannot read it
// itself; it can only refuse to run blind and refuse any org the value would
// not protect.
//
// Without `--apply` it is a dry run: it prints what it would queue and writes
// nothing.
import {
  enqueueTenantProvisioned,
  earliest,
  knownOrgIds,
  studioEvidence,
} from '../lib/tenant-outbox'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main(): Promise<number> {
  const raw = arg('--cutover')
  const cutover = raw ? new Date(raw) : null
  if (!cutover || Number.isNaN(cutover.getTime())) {
    console.error(
      'refused: --cutover <ISO> is required — the grundtone-studio cutover account SERVES ' +
        '(LEGACY_CUTOVER_BY_PORTAL). Without it every backfilled org would get studio-free.',
    )
    return 2
  }
  const apply = process.argv.includes('--apply')
  const now = new Date()

  const orgs = await knownOrgIds()
  const plan = await Promise.all(
    orgs.map(async (id) => ({ id, provisionedAt: earliest(await studioEvidence(id), now) })),
  )
  const unprotected = plan.filter((o) => o.provisionedAt.getTime() >= cutover.getTime())
  if (unprotected.length > 0) {
    console.error(
      `refused: ${unprotected.length} org(s) would be provisioned at or after the cutover and get studio-free:`,
    )
    for (const o of unprotected) console.error(`  ${o.id} ${o.provisionedAt.toISOString()}`)
    return 2
  }

  let queued = 0
  for (const o of plan) {
    const line = `${o.id} provisionedAt=${o.provisionedAt.toISOString()}`
    if (!apply) {
      console.info(`would queue ${line}`)
      continue
    }
    // The org's own evidence is already the earliest; no auth createdAt here
    // (no user session to ask auth with), so pass none.
    const created = await enqueueTenantProvisioned({ id: o.id, createdAt: o.provisionedAt }, now)
    if (created) queued++
    console.info(`${created ? 'queued' : 'already queued'} ${line}`)
  }
  console.info(
    `${apply ? 'applied' : 'dry run'}: ${orgs.length} org(s) known, ${apply ? queued : 0} newly queued, ` +
      `cutover ${cutover.toISOString()}`,
  )
  return 0
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error('backfill failed:', err)
    process.exit(1)
  },
)
