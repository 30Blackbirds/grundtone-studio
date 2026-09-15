import type { Interceptor } from '@connectrpc/connect'
import type { H3Event } from 'h3'
// Eksplicit frem for Nuxts auto-import: uden den kan modulet ikke unit-testes
// (auto-imports findes kun i Nuxt-runtime), og SIK-003's fail-closed-sti er
// netop det, der skal kunne testes.
import { createError } from 'h3'
import { Code, ConnectError, createPromiseClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-node'
import { PermissionsService } from '@klanghaus/permissions-client/connect'
import { recordPdpUnavailable } from './metrics'

// Central Permissions PDP client (Beslutning O/W). Studio asks the PDP for every
// authz decision instead of querying membership tables locally. The PDP derives
// the tenant from the JWT `org` claim — we never send a tenant in the body.
//
// Three outcomes, never two (riff iub38z651y7nr21bovn0683w). A read helper
// answers `allowed`, `denied` or `unavailable`:
//   - denied      the PDP said no, there is no actor/session, or the PDP rejected
//                 our identity (Unauthenticated / PermissionDenied, HTTP 401/403)
//   - unavailable the question could not be answered: transport failure,
//                 timeout, outage, misconfiguration
// Both still fail CLOSED — callers never grant on `unavailable` — but they must
// be distinguishable, otherwise an outage looks like "you have no access" to the
// user, to support and to monitoring. Callers in project-access.ts map denied to
// 401/403 and unavailable to 503 `pdp_unavailable`.

export type PdpVerdict = 'allowed' | 'denied' | 'unavailable'

// Project relations the PDP understands. The OpenFGA model implements
// can_view/can_edit/can_admin as max(orgRole, projectRole); studio passes the
// action and the PDP maps action→relation.
export type ProjectAction = 'can_view' | 'can_edit' | 'can_admin'

// Organization relations.
export type OrgRelation = 'owner' | 'admin' | 'manager' | 'member' | 'billing'

export function projectResource(projectId: string): string {
  return `project:${projectId}`
}

export function orgResource(orgId: string): string {
  return `organization:${orgId}`
}

// Write-path tuple subjects are type-prefixed OpenFGA users (`user:<sub>`),
// matching the org/project role tuples the model stores. Check subjects stay
// bare per the PDP's action→relation convention.
function userSubject(sub: string): string {
  return `user:${sub}`
}

// Machine (per-project secret key) tuple subjects use the PDP's dedicated
// `machine:` type (permissions #63) — distinct from `user:` so a customer-issued
// key never inherits platform-service authority. The keyId is the tuple subject.
function machineSubject(keyId: string): string {
  return `machine:${keyId}`
}

function getActor(event: H3Event) {
  return event.context.auth ?? null
}

function bearerInterceptor(token: string): Interceptor {
  return (next) => (req) => {
    req.header.set('Authorization', `Bearer ${token}`)
    return next(req)
  }
}

async function getToken(event: H3Event): Promise<string | null> {
  // Machine-key requests have no session cookie — the machine-auth middleware
  // has already exchanged the `sk_` key for a short-lived `machine:{keyId}` JWT
  // and stashed it here. Prefer it so the PDP call is authenticated as the
  // machine principal (its editor tuple is what gets adjudicated).
  const stashed = event.context.authToken as string | undefined
  if (stashed) return stashed

  // Re-exchange the forwarded session cookie for a fresh JWT to attach to the
  // PDP call. The auth middleware already verified the session for this request,
  // but the PDP needs the raw bearer token (it re-verifies + reads the org
  // claim), so we fetch it here rather than smuggling it through context.
  // Server-side → container-intern auth-adresse (AUTH_INTERNAL_URL), ikke den
  // browser-vendte AUTH_ISSUER (localhost:3002 er ikke nåbar fra containeren).
  const authUrl = process.env.AUTH_INTERNAL_URL ?? process.env.AUTH_ISSUER
  const cookieHeader = event.node.req.headers.cookie
  // No session to exchange → nothing to ask with → denied (null).
  if (!cookieHeader) return null
  // A missing auth address is misconfiguration, not a denial: throw so the
  // caller classifies it as unavailable. Likewise a failed exchange throws.
  if (!authUrl) throw new Error('AUTH_INTERNAL_URL or AUTH_ISSUER must be set')
  const res = await $fetch<{ token?: string }>(`${authUrl}/api/auth/token`, {
    headers: { cookie: cookieHeader },
  })
  return res.token ?? null
}

/**
 * Classify a thrown read-path failure. Only an explicit identity rejection is a
 * denial; everything else (Unavailable, DeadlineExceeded, Internal, Aborted,
 * network errors, missing config) means the question went unanswered.
 */
export function classifyPdpFailure(err: unknown): 'denied' | 'unavailable' {
  if (err instanceof ConnectError) {
    return err.code === Code.Unauthenticated || err.code === Code.PermissionDenied
      ? 'denied'
      : 'unavailable'
  }
  const e = err as { statusCode?: unknown; status?: unknown } | null
  const status = e?.statusCode ?? e?.status
  if (status === 401 || status === 403) return 'denied'
  return 'unavailable'
}

function failureVerdict(err: unknown, helper: string): 'denied' | 'unavailable' {
  const outcome = classifyPdpFailure(err)
  if (outcome === 'unavailable') {
    const reason = err instanceof ConnectError ? (Code[err.code] ?? 'connect') : 'transport'
    recordPdpUnavailable(reason)
    console.error(
      `[pdp] ${helper} could not be answered (${reason}):`,
      (err as Error)?.message ?? err,
    )
  }
  return outcome
}

// ─── SIK-003: skrive-stier bruger en TJENESTE-identitet ─────────────────────
//
// Fase 2 i permissions (#90) allowlister hvem der maa skrive tupler, og den
// matcher paa `sub = service:studio`. Skrivningerne herunder er PLATFORM-
// handlinger — studio skriver dem paa systemets vegne, ikke paa brugerens —
// saa de skal baere tjeneste-identiteten.
//
// 🔴 LAES-STIERNE SKAL BLIVE PAA BRUGERENS TOKEN. Det er ikke en detalje:
// `check`/`batchCheck`/`listMyAccess` afgoer, hvad DENNE bruger maa, og PDP'en
// laeser subject fra tokenet. Skiftes de med, spoerger vi i praksis "maa
// service:studio det her?" — og svaret ville vaere ja for alt.
//
// Manglende token er FAIL-CLOSED, bevidst. En fallback til brugerens token
// ville stille genindfoere praecis den tilstand, fase 2 fjerner, og den ville
// SE UD som om alt virker. Det koster os desuden ingenting: i deploy-kaeden
// mintes tokenet i trin 2, foer dette skifte gaar ud i trin 4, saa der findes
// ikke et vindue med tomt token.
//
// Egen env-var (ikke ACCOUNT_S2S_TOKEN): tokenet har en anden audience, og at
// dele én vaerdi mellem to modtagere goer en kompromittering bredere end noedigt.
//
// 🔴 `aud` = `klanghaus-pdp`. Vi laeser og saetter den IKKE her — tokenet baerer
// den fra mintningen, og #90 asserterer ikke paa den. Vaerdien staar alligevel
// skrevet, fordi konsekvensen af at gaette forkert er ubehagelig: mintes med én
// vaerdi og asserteres senere paa en anden, fejler ALLE skrivninger paa én gang,
// og fejlen vil ligne en TOKEN-fejl frem for en KONFIGURATIONS-fejl. Praecis som
// issuer-asymmetrien mod staging: en 401, der saa ud som et daarligt token, men
// var en forkert `iss`. Skal nogen en dag assertere audience, er det denne.
function serviceClient() {
  const baseUrl = process.env.PERMISSIONS_URL
  if (!baseUrl) throw new Error('PERMISSIONS_URL must be set')
  const token = process.env.PDP_S2S_TOKEN
  if (!token) {
    throw createError({
      statusCode: 503,
      statusMessage:
        'PDP_S2S_TOKEN is not configured — refusing to write permission tuples as the end user',
    })
  }
  const transport = createConnectTransport({
    baseUrl,
    httpVersion: '2',
    interceptors: [bearerInterceptor(token)],
  })
  return createPromiseClient(PermissionsService, transport)
}

async function clientFor(event: H3Event) {
  const baseUrl = process.env.PERMISSIONS_URL
  if (!baseUrl) throw new Error('PERMISSIONS_URL must be set')
  const token = await getToken(event)
  if (!token) return null

  const transport = createConnectTransport({
    baseUrl,
    httpVersion: '2',
    interceptors: [bearerInterceptor(token)],
  })
  return createPromiseClient(PermissionsService, transport)
}

/**
 * Check whether the current actor may perform `action` on a project.
 * `unavailable` when the PDP could not answer; never `allowed` on failure.
 */
export async function checkProject(
  event: H3Event,
  projectId: string,
  action: ProjectAction,
): Promise<PdpVerdict> {
  const actor = getActor(event)
  if (!actor) return 'denied'
  try {
    const client = await clientFor(event)
    if (!client) return 'denied'
    const res = await client.check({
      subject: actor.sub,
      action,
      resource: projectResource(projectId),
    })
    return res.allow ? 'allowed' : 'denied'
  } catch (err) {
    return failureVerdict(err, 'checkProject')
  }
}

/**
 * Check whether the current actor holds `relation` on an organization.
 * `unavailable` when the PDP could not answer; never `allowed` on failure.
 */
export async function checkOrg(
  event: H3Event,
  orgId: string,
  relation: OrgRelation,
): Promise<PdpVerdict> {
  const actor = getActor(event)
  if (!actor) return 'denied'
  try {
    const client = await clientFor(event)
    if (!client) return 'denied'
    const res = await client.check({
      subject: actor.sub,
      action: relation,
      resource: orgResource(orgId),
    })
    return res.allow ? 'allowed' : 'denied'
  } catch (err) {
    return failureVerdict(err, 'checkOrg')
  }
}

/**
 * Batch project checks in one round-trip. Returns projectId→verdict. A failure
 * marks the whole batch with the failure verdict (never `allowed`).
 */
export async function batchCheckProjects(
  event: H3Event,
  projectIds: string[],
  action: ProjectAction,
): Promise<Record<string, PdpVerdict>> {
  const actor = getActor(event)
  const result: Record<string, PdpVerdict> = {}
  for (const id of projectIds) result[id] = 'denied'
  if (!actor || projectIds.length === 0) return result
  try {
    const client = await clientFor(event)
    if (!client) return result
    const res = await client.batchCheck({
      checks: projectIds.map((id) => ({
        subject: actor.sub,
        action,
        resource: projectResource(id),
      })),
    })
    res.results.forEach((r, i) => {
      const id = projectIds[i]
      if (id) result[id] = r.allow ? 'allowed' : 'denied'
    })
    return result
  } catch (err) {
    const outcome = failureVerdict(err, 'batchCheckProjects')
    for (const id of projectIds) result[id] = outcome
    return result
  }
}

/**
 * Grant a project role to a subject (membership write). Used on project create
 * (creator → admin) and direct project-member invites. Throws on failure so the
 * caller can surface a 5xx rather than silently dropping the grant.
 */
export async function grantProjectRole(
  event: H3Event,
  projectId: string,
  subject: string,
  role: 'viewer' | 'editor' | 'admin',
): Promise<void> {
  const client = serviceClient()
  await client.grantRole({
    subject: userSubject(subject),
    role,
    resource: projectResource(projectId),
  })
}

/**
 * Revoke a previously granted project role. Throws on failure.
 */
export async function revokeProjectRole(
  event: H3Event,
  projectId: string,
  subject: string,
  role: 'viewer' | 'editor' | 'admin',
): Promise<void> {
  const client = serviceClient()
  await client.revokeRole({
    subject: userSubject(subject),
    role,
    resource: projectResource(projectId),
  })
}

/**
 * Grant a machine (secret-key) principal a project role. Called at key-creation
 * on the admin's browser context (tenant derived server-side from the admin's
 * JWT org claim — never from the request body, per Beslutning K). Throws on
 * failure so key-creation rolls back if the tuple can't be written.
 */
export async function grantMachineProjectRole(
  event: H3Event,
  projectId: string,
  keyId: string,
  role: 'viewer' | 'editor' | 'admin',
): Promise<void> {
  const client = serviceClient()
  await client.grantRole({
    subject: machineSubject(keyId),
    role,
    resource: projectResource(projectId),
  })
}

/**
 * Revoke a machine principal's project role. Called at key-delete so revocation
 * is a single PDP tuple-delete (permissions owns the source of truth).
 */
export async function revokeMachineProjectRole(
  event: H3Event,
  projectId: string,
  keyId: string,
  role: 'viewer' | 'editor' | 'admin',
): Promise<void> {
  const client = serviceClient()
  await client.revokeRole({
    subject: machineSubject(keyId),
    role,
    resource: projectResource(projectId),
  })
}

/**
 * Link a project to its parent organization so org roles cascade onto the
 * project (the model's max(orgRole, projectRole)). Called once on project
 * create. Throws on failure.
 */
export async function linkProjectToOrg(
  event: H3Event,
  projectId: string,
  orgId: string,
): Promise<void> {
  const client = serviceClient()
  await client.writeTuple({
    user: orgResource(orgId),
    relation: 'parent',
    object: projectResource(projectId),
  })
}
