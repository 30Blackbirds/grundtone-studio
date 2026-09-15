import { createError, defineEventHandler, getRouterParam, readRawBody } from 'h3'
import { validateLogoUpload } from '~~/server/lib/asset-upload'
import { recordAuditEvent } from '~~/server/lib/audit'
import { requireProjectAccess } from '~~/server/lib/project-access'
import { paths, putObject } from '~~/server/lib/storage'

// Logo-upload til draft-laget (brand-assets, forlæg redesign-brand-assets.html).
// Rå binær body (ikke multipart) — én fil, ét formål, og klienten sætter bare
// filens bytes som body. Validering på magic bytes + 512KB-cap; SVG saniteres
// FØR lagring. Endpointet skriver KUN draft-blobben og returnerer referencen —
// selve tokens-JSON'en opdaterer klienten via config-endpointet, hvor schemaet
// håndhæver referencens form. Publish promoverer draft → v{n}/ + current/.

defineRouteMeta({
  openAPI: {
    summary: 'Uploader logo (SVG/PNG, maks. 512KB) til projektets draft-lag; kræver editor.',
    tags: ['Assets'],
  },
})

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'projectId required' })

  const access = await requireProjectAccess(event, projectId, 'editor')

  const raw = await readRawBody(event, false)
  if (!raw || raw.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Empty body' })
  }

  const validated = validateLogoUpload(Buffer.isBuffer(raw) ? raw : Buffer.from(raw))
  if (!validated.ok) {
    throw createError({
      statusCode: 400,
      statusMessage: validated.error === 'too_large' ? 'File too large' : 'Unsupported format',
      data: { code: validated.error },
    })
  }

  const file = `logo.${validated.type}`
  await putObject(paths(projectId).draftAsset(file), validated.body, {
    contentType: validated.contentType,
    cacheControl: 'no-store',
  })

  // Audited after the file is stored (riff mfhvuk8515gubxh30puab9ch); never its bytes.
  await recordAuditEvent(event, {
    organizationId: access.organization.id,
    action: 'asset.logo_uploaded',
    targetType: 'project',
    targetId: projectId,
    targetLabel: access.project.name,
    after: { file, type: validated.type },
  })
  return { file, type: validated.type }
})
