import type { AuthActor } from '../middleware/auth'
import type { ProvisioningPrincipal } from '../lib/provisioning-auth'

// server/middleware/auth.ts populates event.context.auth with the verified
// actor (or leaves it undefined for unauthenticated requests). Augment H3's
// context so every handler sees the typed shape.
declare module 'h3' {
  interface H3EventContext {
    auth?: AuthActor
    // 🔴 A SEPARATE SLOT, not a variant of `auth` (KH-964). A provisioning key
    // acts on an ORGANISATION; `auth` carries a user or a `machine:{keyId}`
    // principal scoped to a project. Folding them together would let every
    // existing `requireProjectAccess` call site see a provisioning key as an
    // ordinary actor, which is precisely the authority it must NOT have.
    provisioning?: ProvisioningPrincipal
  }
}

export {}
