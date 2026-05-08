export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const { authClient } = await import('~~/lib/auth-client')
  const publicPaths = new Set(['/login', '/signup'])
  const isPublicPath = publicPaths.has(to.path) || to.path.startsWith('/invitations/')

  const session = await authClient.getSession()
  const authed = Boolean(session.data?.session)

  if (!authed && !isPublicPath) {
    return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`)
  }

  if (authed && publicPaths.has(to.path)) {
    return navigateTo('/dashboard')
  }
})
