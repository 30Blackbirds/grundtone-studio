// Small retry helper for transient I/O. Used by email.send for Postmark
// hiccups; could also wrap S3/Bunny calls if they prove flaky.
//
// Design: keep it inline + synchronous-shaped. A persistent outbox queue
// (DB-backed worker, dead-letter inspection) is a separate, larger
// project — track it as a follow-up if real users start losing mail
// during longer Postmark outages.

export interface RetryOptions {
  attempts: number
  initialDelayMs: number
  factor: number
  // Tag for logs so a flaky destination is easy to spot.
  label?: string
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastErr: unknown
  let delay = opts.initialDelayMs
  for (let i = 0; i < opts.attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const isLast = i === opts.attempts - 1
      if (isLast) break
      console.warn(
        `[retry] attempt ${i + 1}/${opts.attempts} failed${opts.label ? ` for ${opts.label}` : ''}: ${
          (err as Error)?.message ?? String(err)
        } — retrying in ${delay}ms`,
      )
      await sleep(delay)
      delay *= opts.factor
    }
  }
  throw lastErr
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
