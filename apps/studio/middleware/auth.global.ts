export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const { authClient } = await import('~~/lib/auth-client')

  // Pre-auth routes: anyone can reach these without a session. Auth pages
  // (/login, /signup) get a special-case post-auth redirect to /dashboard.
  const authPaths = new Set(['/login', '/signup'])
  const publicPaths = new Set([
    ...authPaths,
    '/verify-email',
    '/privacy',
    '/dpa',
    '/sub-processors',
    '/docs/install',
  ])
  const isPublicPath =
    publicPaths.has(to.path) || to.path.startsWith('/invitations/') || to.path.startsWith('/docs/')

  const session = await authClient.getSession()
  const authed = Boolean(session.data?.session)

  if (!authed && !isPublicPath) {
    return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`)
  }

  if (authed && authPaths.has(to.path)) {
    return navigateTo('/dashboard')
  }
})
