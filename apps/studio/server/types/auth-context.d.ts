import type { AuthActor } from '../middleware/auth'

// server/middleware/auth.ts populates event.context.auth with the verified
// actor (or leaves it undefined for unauthenticated requests). Augment H3's
// context so every handler sees the typed shape.
declare module 'h3' {
  interface H3EventContext {
    auth?: AuthActor
  }
}

export {}
