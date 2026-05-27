import { resolveAuthAction } from './auth-decision'

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const { authClient } = await import('~~/lib/auth-client')
  const session = await authClient.getSession()
  const authed = Boolean(session.data?.session)

  const decision = resolveAuthAction({
    path: to.path,
    fullPath: to.fullPath,
    authed,
  })

  if (decision.type === 'redirect') {
    return navigateTo(decision.to)
  }
})
