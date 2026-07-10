declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void
      execute: (siteKey: string, options: { action: string }) => Promise<string>
    }
  }
}

let scriptPromise: Promise<void> | null = null

function loadRecaptchaScript(): Promise<void> {
  if (import.meta.server) return Promise.resolve()
  if (window.grecaptcha) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const siteKey = useRuntimeConfig().public.recaptchaSiteKey
    if (!siteKey) {
      resolve()
      return
    }
    const existing = document.querySelector('script[data-recaptcha]')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('reCAPTCHA script failed to load')))
      return
    }
    const script = document.createElement('script')
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`
    script.async = true
    script.defer = true
    script.dataset.recaptcha = 'true'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('reCAPTCHA script failed to load'))
    document.head.appendChild(script)
  })

  return scriptPromise
}

/**
 * Execute reCAPTCHA v3 for a named action. Returns empty string when the site
 * key is unset (local dev without keys) so auth calls still work.
 */
export async function executeRecaptcha(action: string): Promise<string> {
  if (import.meta.server) return ''
  const siteKey = useRuntimeConfig().public.recaptchaSiteKey
  if (!siteKey) return ''

  await loadRecaptchaScript()
  if (!window.grecaptcha) return ''

  return await new Promise((resolve, reject) => {
    window.grecaptcha!.ready(() => {
      window
        .grecaptcha!.execute(siteKey, { action })
        .then(resolve)
        .catch(reject)
    })
  })
}

export function useRecaptcha() {
  return { executeRecaptcha }
}
