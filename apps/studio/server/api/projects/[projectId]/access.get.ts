import { batchCheckProjects } from '~~/server/lib/pdp'
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

  let role: ProjectRole | null = null
  if (admin[projectId]) role = 'admin'
  else if (edit[projectId]) role = 'editor'
  else if (view[projectId]) role = 'viewer'

  return { role }
})
