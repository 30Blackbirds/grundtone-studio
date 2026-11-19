#!/usr/bin/env node
// Checks a running Studio built with contract/layer at apps/studio/layers/contract
// (see contract/README.md). Usage: node contract/check.mjs <base-url>
//
// Each check names the extension point it guards. The script stops at the
// first broken promise and exits non-zero; it prints one line per check.

const base = (process.argv[2] ?? '').replace(/\/$/, '')
if (!base) {
  console.error('usage: node contract/check.mjs <base-url>')
  process.exit(2)
}

let failed = false
function check(name, ok, detail) {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${detail}`}`)
  if (!ok) failed = true
}

async function get(path, as = 'json') {
  const res = await fetch(base + path, { signal: AbortSignal.timeout(15_000) })
  const body = as === 'json' ? await res.json().catch(() => null) : await res.text()
  return { status: res.status, body }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const features = await get('/api/features')
check(
  'feature registry: a layer turns `billing` on (/api/features)',
  features.status === 200 && features.body?.billing === true,
  `got ${features.status} ${JSON.stringify(features.body)}`,
)

const state = await get('/api/_contract')
if (state.status !== 200 || !state.body) {
  check('layer server route is served (/api/_contract)', false, `got ${state.status}`)
  process.exit(1)
}
const s = state.body
check(
  'entitlements provider: the installed provider is the one in force',
  s.providerInstalled === true && s.entitlementsPlanKey === 'contract-plan',
  `installed=${s.providerInstalled} planKey=${s.entitlementsPlanKey}`,
)
check(
  'brand-count hook: a layer listener hears notifyBrandCountChanged',
  s.heard?.brandCount?.includes('contract-org'),
  JSON.stringify(s.heard),
)
check(
  'org-served hook: a layer listener hears notifyOrgServed',
  s.heard?.orgServed?.includes('contract-org'),
  JSON.stringify(s.heard),
)
check('Nitro task from a layer runs', s.task === 'pong', `got ${JSON.stringify(s.task)}`)

const studio = s.appConfig ?? {}
check(
  'app.config: the layer org link is appended to Studio’s',
  Array.isArray(studio.orgNav) && studio.orgNav.at(-1)?.id === 'contract',
  JSON.stringify(studio.orgNav),
)
check(
  'app.config: the layer upgrade path takes effect (Studio leaves it unset)',
  studio.upgradePath === '/contract-upgrade',
  JSON.stringify(studio.upgradePath),
)
check(
  'app.config: the layer processor follows Studio’s five',
  same(studio.legalProcessors, [
    'upcloud',
    'bunny',
    'postmark',
    'sentry',
    'proton',
    'contractVendor',
  ]),
  JSON.stringify(studio.legalProcessors),
)

const legal = await get('/sub-processors', 'text')
check(
  'processor table renders a layer row from the layer’s own locale file',
  legal.status === 200 && legal.body.includes('Contract Fixture Vendor'),
  `status ${legal.status}`,
)

const page = await get('/contract', 'text')
check(
  'a layer page is served with its own locale string',
  page.status === 200 && page.body.includes('Contract fixture page'),
  `status ${page.status}`,
)

process.exit(failed ? 1 : 0)
