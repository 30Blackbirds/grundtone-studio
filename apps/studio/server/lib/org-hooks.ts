import { createHook } from './hook'

// Extension point: something that must hear when Studio has served an
// organization to a signed-in member (a successful, member-scoped org lookup).
// Studio itself does not care who listens; the hosted service announces the
// org to its account system on first use, a self-host install registers
// nothing.
//
// Fires on every successful lookup, not once per org: a listener that only
// cares about the first time keeps its own memory. Listeners are never awaited
// by the request, and one that is slow or throws must not fail the lookup.

export interface ServedOrg {
  id: string
  slug: string
  /** ISO timestamp of the organization row, when the source returns one. */
  createdAt?: string
}

export type OrgServedListener = (org: ServedOrg) => void | Promise<void>

const hook = createHook<ServedOrg>('org-hooks', (org) => `org ${org.id}`)

export const onOrgServed: (listener: OrgServedListener) => () => void = hook.on
export const notifyOrgServed: (org: ServedOrg) => void = hook.notify
