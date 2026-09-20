import { getRequestURL, sendRedirect } from 'h3'
import { resolveAuthAction } from '~~/middleware/auth-decision'

// 🔴 THE SIGNED-IN VISITOR LEAVES /login ON THE SERVER, NOT AFTER HYDRATION
// (KH-1034 / KH-1123, found by [designer]).
//
// Until this ran, a direct load of /login by a signed-in user produced TWO
// defects from ONE cause, and the second one is the expensive one:
//
//   1. "Hydration completed but contains mismatches" — the server rendered the
//      auth shell, the client resolved the session and navigated to /dashboard
//      during the same hydration pass. Two different trees at one position.
//   2. The visitor landed on /onboarding — a wizard for people with no
//      organization — although they had one. MEASURED: /api/dashboard was
//      never requested at all on that path.
//
// (2) is not a race, and that matters because a race invites a `nextTick`
// patch. `useAsyncData` in nuxt 3.21.11 (dist/app/composables/asyncData.js:114)
// short-circuits when `fetchOnServer && nuxtApp.isHydrating && data.value !=
// null` — it marks the data `success` and NEVER CALLS THE HANDLER, because
// during hydration it assumes SSR already fetched. Redirecting INTO /dashboard
// while `isHydrating` is still true means that assumption is false. What made
// `data.value` non-null was the page's own `default: () => ({ orgs: [], ... })`
// — so the fallback value was also a valid normal outcome, and "zero orgs" was
// true of the default rather than of the user.
//
// Deciding on the server removes the class: nothing is rendered at /login, so
// there is no tree to disagree about, and /dashboard is reached as a fresh
// server render whose payload carries the real orgs. pages/dashboard.vue keeps
// a second, independent guard for any other route that redirects into it.
//
// THE DECISION IS THE SAME FUNCTION THE CLIENT USES — `resolveAuthAction` from
// middleware/auth-decision.ts — on purpose. Two copies of "where should this
// visitor go" would drift, and the drift would show up as exactly the mismatch
// this file exists to remove. A cell in auth-decision.test.ts pins the two
// call sites to the one function.
export default defineEventHandler(async (event) => {
  // Document navigations only. /api/* answers with data, never with a
  // redirect, and a 302 on an API route would be read as the endpoint's reply.
  if (event.method !== 'GET') return
  const url = getRequestURL(event)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_')) return

  const decision = resolveAuthAction({
    path: url.pathname,
    fullPath: url.pathname + url.search,
    authed: Boolean(event.context.auth),
  })

  // Only the authed-on-an-auth-path branch belongs on the server. The unauthed
  // branch stays client-side: server/middleware/auth.ts plus the per-endpoint
  // 401s are the DATA boundary, and moving the UX redirect here would put a
  // second, weaker copy of that boundary in front of it — measured empty
  // shells are the intended behaviour for an unauthed SSR render, not a leak.
  if (decision.type !== 'redirect' || decision.to !== '/dashboard') return

  await sendRedirect(event, decision.to, 302)
})
