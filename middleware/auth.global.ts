export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const { authClient } = await import('~~/lib/auth-client')
  const publicRoutes = new Set(['/login', '/signup'])

  const session = await authClient.getSession()
  const authed = Boolean(session.data?.session)

  if (!authed && !publicRoutes.has(to.path)) {
    return navigateTo('/login')
  }

  if (authed && publicRoutes.has(to.path)) {
    return navigateTo('/dashboard')
  }
})
