import type { AuthActor } from '../middleware/auth'
import type { ProvisioningPrincipal } from '../lib/provisioning-auth'

// server/middleware/auth.ts populates event.context.auth with the verified
// actor (or leaves it undefined for unauthenticated requests). Augment H3's
// context so every handler sees the typed shape.
declare module 'h3' {
  interface H3EventContext {
    auth?: AuthActor
    // 🔴 AN EXTRA MARKER, not a replacement for `auth` — and my first comment
    // here was wrong, so it is corrected rather than quietly rewritten.
    //
    // I wrote that folding this into `auth` would let every
    // `requireProjectAccess` call site see a provisioning key as an ordinary
    // actor, "which is precisely the authority it must NOT have". That reasoning
    // is the one C3 already corrected once in this riff: WHAT BOUNDS A MACHINE
    // KEY IS ITS GRANT, NOT WHICH CODE PATHS CAN SEE IT. A provisioning key is
    // deliberately also presented as `machine:{keyId}` in `auth`, so the
    // existing editor-gated endpoints work unchanged — and the PDP refuses it
    // everywhere it holds no tuple, which is every project it did not create
    // and every `project.admin` operation (AC-D2/AC-D4).
    //
    // This slot survives because two routes need to know the caller IS a
    // provisioning key rather than any machine: the org-match check (AC-D1) and
    // picking the keyId to grant on a newly created project.
    provisioning?: ProvisioningPrincipal
  }
}

export {}
