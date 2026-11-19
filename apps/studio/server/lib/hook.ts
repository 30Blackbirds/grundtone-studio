// A minimal in-process hook: extension points (brand-hooks.ts, org-hooks.ts)
// let a deployment add behaviour without the core knowing who listens.
// Listeners are never awaited by the caller, and a listener that is slow or
// throws must not fail the request that fired the hook.

export type Listener<T> = (arg: T) => void | Promise<void>

export interface Hook<T> {
  /** Registers a listener; returns a function that removes it. */
  on(listener: Listener<T>): () => void
  /** Tells every listener, without waiting for them. Never throws. */
  notify(arg: T): void
}

/** `tag` and `subject` only shape the log line of a failing listener. */
export function createHook<T>(tag: string, subject: (arg: T) => string): Hook<T> {
  const listeners = new Set<Listener<T>>()
  return {
    on(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    notify(arg) {
      for (const listener of listeners) {
        void Promise.resolve()
          .then(() => listener(arg))
          .catch((err: unknown) => {
            console.error(`[${tag}] listener failed for ${subject(arg)}:`, err)
          })
      }
    },
  }
}
