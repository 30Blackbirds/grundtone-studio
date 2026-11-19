import { createHook } from './hook'

// Extension point: something that must hear when an organization's number of
// active brands may have changed (a first publish or an activation created a
// brand). Studio itself does not care who listens; a deployment that bills
// per brand registers a listener, a self-host install registers none.
//
// Listeners run after the brand row is committed and are never awaited by the
// request: a listener that is slow or throws must not fail the publish. A
// missed notification is the listener's to repair (the billing deployment
// re-sends every count on a daily schedule).

export type BrandCountListener = (organizationId: string) => void | Promise<void>

const hook = createHook<string>('brand-hooks', (organizationId) => `org ${organizationId}`)

export const onBrandCountChanged: (listener: BrandCountListener) => () => void = hook.on
export const notifyBrandCountChanged: (organizationId: string) => void = hook.notify
