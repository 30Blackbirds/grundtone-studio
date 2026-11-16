import { batchCheckProjects } from '~~/server/lib/authorizer'
import type { ProjectRole } from '~~/server/lib/project-access'

// Returns the current user's effective project role, decided by the PDP. Used
// by the useProjectRole composable so client-side UI gates match what the
// server enforces. A single batch resolves all three relations in one round
// trip; the highest allowed wins.
defineRouteMeta({
  openAPI: {
    summary:
      'Returnerer brugerens effektive projektrolle (admin/editor/viewer) afgjort af PDP — driver UI-gates.',
    description:
      'Returnerer den signed-in brugers effektive projektrolle (admin/editor/viewer) afgjort af PDP. Bruges af useProjectRole til at gate UI.',
    tags: ['Projects'],
  },
})

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'projectId required' })
  if (!event.context.auth) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const [admin, edit, view] = await Promise.all([
    batchCheckProjects(event, [projectId], 'can_admin'),
    batchCheckProjects(event, [projectId], 'can_edit'),
    batchCheckProjects(event, [projectId], 'can_view'),
  ])

  // Any unanswered check → 503, not role:null. The client keeps its UI gates
  // closed either way; the difference is that an outage is reported as one
  // (riff iub38z651y7nr21bovn0683w).
  if ([admin, edit, view].some((r) => r[projectId] === 'unavailable')) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Permission service unavailable',
      data: { code: 'pdp_unavailable' },
    })
  }

  let role: ProjectRole | null = null
  if (admin[projectId] === 'allowed') role = 'admin'
  else if (edit[projectId] === 'allowed') role = 'editor'
  else if (view[projectId] === 'allowed') role = 'viewer'

  return { role }
})
