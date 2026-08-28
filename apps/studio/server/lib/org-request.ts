import { createError, type H3Event } from 'h3'
import type { z } from 'zod'
import type { AuthActor } from '../middleware/auth'
import { lookupOrgBySlug, type FullOrg } from './org-lookup'
import { orgRoleHelpers, type OrgRole } from './project-access'

// Den fælles preamble for de org-scopede endepunkter: auth → validér input →
// slå org op → autorisér. Fem handlere skrev den ordret af hinanden, og
// SonarQubes "Duplicated Lines (%) on New Code" tæller dubletter i ÆNDREDE
// filer — så boilerplate fra 2026 gjorde gaten rød for den der rørte ét
// endepunkt i dag.
//
// 🔴 DELT I TO, ikke samlet i én. Checkout skal nå sit purchasable-tjek
// MELLEM parse og org-opslag; ville helperen gøre begge dele i ét kald,
// rykkede det tjek bagom opslaget, og en ukendt org + ikke-købbar plan
// skiftede svar fra 400 til 404. Rækkefølgen af fejl er observerbar adfærd,
// og en ekstraktion må ikke ændre den.

export interface AuthedRequest<T> {
  actor: AuthActor
  data: T
}

/**
 * 401 uden verificeret actor, 400 når input ikke matcher skemaet.
 *
 * Input sendes ind frem for at blive læst herinde, fordi kilden varierer:
 * `await readBody(event)` for POST, `getQuery(event)` for GET. At lade
 * helperen vælge ville kræve et flag, der kun findes for at skjule at
 * kalderen allerede ved svaret.
 */
export function requireAuthedRequest<S extends z.ZodType>(
  event: H3Event,
  schema: S,
  input: unknown,
): AuthedRequest<z.infer<S>> {
  const actor = event.context.auth
  if (!actor) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message })
  }

  return { actor, data: parsed.data }
}

/**
 * Hvor meget org-opslaget alene beviser — og hvad der derfor skal tjekkes
 * oveni. De tre er bevidst navngivet efter påstanden, ikke efter kaldestedet:
 *
 * · `lookup-only`  opslaget ER gaten. Auth-servicen scoper det til kalderens
 *                  medlemskaber, så et svar beviser medlemskab. Kun til
 *                  handlinger uden egen risiko ud over selve medlemskabet.
 * · `member`       kalderen skal desuden optræde i den opløste medlemsliste.
 * · `billing`      kalderen skal holde owner/billing (Sentry-agtig model:
 *                  admin/manager styrer mennesker, ikke betalingsforholdet).
 */
export type OrgGate = 'lookup-only' | 'member' | 'billing'

export async function requireOrg(
  event: H3Event,
  actor: AuthActor,
  organizationSlug: string,
  gate: OrgGate,
): Promise<FullOrg> {
  const org = await lookupOrgBySlug(event, organizationSlug)
  if (!org) throw createError({ statusCode: 404, statusMessage: 'Organization not found' })

  if (gate === 'member') {
    // 🔴 `?? false`, ikke `?? true` (SIK-003). Faldet rammer, når `org.members`
    // er undefined — altså når vi IKKE fik en medlemsliste at tjekke imod. Den
    // gamle default lod tvivlen komme kalderen til gode og gav dermed adgang
    // præcis i det tilfælde, hvor vi vidste mindst. Mangler listen, ved vi ikke,
    // om de er medlem, og så er svaret nej.
    const isMember = org.members?.some((m) => m.userId === actor.sub) ?? false
    if (!isMember) {
      throw createError({ statusCode: 403, statusMessage: 'Not a member of this organization' })
    }
  }

  if (gate === 'billing') {
    const role = org.members?.find((m) => m.userId === actor.sub)?.role
    if (!role || !orgRoleHelpers.canManageBilling(role as OrgRole)) {
      throw createError({ statusCode: 403, statusMessage: 'Requires the owner or billing role' })
    }
  }

  return org
}
