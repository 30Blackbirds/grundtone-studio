import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Ajv, type ErrorObject } from 'ajv'
import addFormatsModule from 'ajv-formats'
import { FORMAT_SCHEMA_URL, RESOLVER_SCHEMA_URL } from '../export'

// Validates documents against the OFFICIAL DTCG 2025.10 JSON schemas, vendored
// unchanged in vendor/dtcg-community-group (see SOURCE.md there). Nothing is
// fetched over the network (E4): every split schema file is registered by its
// own $id, so the cross-file $refs resolve locally.

export const VENDOR_DIR = join(import.meta.dirname, '../../vendor/dtcg-community-group')

function jsonFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? jsonFiles(full) : entry.endsWith('.json') ? [full] : []
  })
}

// ajv-formats is CommonJS; its default export arrives wrapped under ESM.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as (ajv: Ajv) => Ajv

let ajv: Ajv | null = null
function instance(): Ajv {
  if (ajv) return ajv
  ajv = new Ajv({ strict: true, allErrors: true })
  addFormats(ajv)
  for (const file of jsonFiles(join(VENDOR_DIR, 'schemas/2025.10'))) {
    ajv.addSchema(JSON.parse(readFileSync(file, 'utf8')))
  }
  return ajv
}

export interface SchemaResult {
  valid: boolean
  errors: string[]
}

export function validateAgainst(schemaId: string, document: unknown): SchemaResult {
  const validate = instance().getSchema(schemaId)
  if (!validate) throw new Error(`schema ${schemaId} is not in the vendored set`)
  const valid = validate(document) as boolean
  const errors = (validate.errors ?? []).map(
    (e: ErrorObject) => `${e.instancePath || '(root)'} ${e.message ?? ''}`,
  )
  return { valid, errors }
}

export const validateTokensFile = (document: unknown) =>
  validateAgainst(FORMAT_SCHEMA_URL, document)
export const validateResolverFile = (document: unknown) =>
  validateAgainst(RESOLVER_SCHEMA_URL, document)
