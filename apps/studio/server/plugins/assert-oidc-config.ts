import { authMode, readOidcConfig } from '~~/server/lib/oidc/config'

// AUTH_MODE=oidc with a missing or invalid setting refuses to start, rather than
// answering every login with an error. better-auth mode (the default) reads
// nothing here.
export default defineNitroPlugin(() => {
  if (authMode() === 'oidc') readOidcConfig()
})
