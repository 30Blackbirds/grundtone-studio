// Shared fixtures + fake-event helper for endpoint-handler tests.
//
// Each test file still has to declare its own `vi.mock(...)` blocks for the
// modules the handler under test imports — vi.mock is hoisted per-file and
// can't be re-exported. This file just hosts the fixture objects and the
// fake-event constructor used across the integration suite.

export interface FakeProject {
  id: string
  organizationId: string
  slug: string
  name: string
}

export interface FakeOrg {
  id: string
  slug: string
  name: string
}

export interface FakeSession {
  user: { id: string; email: string }
}

// Stable fake values reused across tests. Tests that need to mutate
// fields should spread into a fresh object (`{ ...PROJECT, name: '…' }`)
// rather than touching these constants directly.
export const ORG: FakeOrg = { id: 'org-1', slug: 'acme', name: 'Acme Corp' }
export const PROJECT: FakeProject = {
  id: '00000000-0000-0000-0000-000000000001',
  organizationId: ORG.id,
  slug: 'main',
  name: 'Main',
}
export const SESSION: FakeSession = {
  user: { id: 'user-1', email: 'admin@grundtone.local' },
}

// ─── Fake H3 event ────────────────────────────────────────────────────────
// Just enough surface for handlers to call:
//   - getRouterParam(event, 'name') → reads from params
//   - readBody(event) → reads from body
//   - getRequestHeader(event, 'x') / getRequestIP(event) → reads from headers
//   - createError(opts) → throws an Error with statusCode attached
//   - setHeader / setResponseStatus → no-ops capturing into state
//
// h3 itself is also mocked in each test file so the helpers above resolve.

export interface FakeAuthActor {
  sub: string
  tenant: string
  email: string
}

export interface FakeEvent {
  params: Record<string, string>
  // Query-string som handlers læser via getQuery — upload-endpoints bruger
  // den til metadata fordi body'en er reserveret til de binære bytes.
  query: Record<string, string>
  body: unknown
  headers: Record<string, string>
  // Mirrors H3EventContext; handlers read event.context.auth for the JWT actor.
  context: { auth?: FakeAuthActor }
  responseHeaders: Record<string, string>
  responseStatus?: number
}

export function fakeEvent(opts: Partial<FakeEvent> = {}): FakeEvent {
  return {
    params: { ...(opts.params ?? {}) },
    query: { ...(opts.query ?? {}) },
    body: opts.body ?? null,
    headers: { ...(opts.headers ?? {}) },
    context: opts.context ?? {
      auth: { sub: SESSION.user.id, tenant: ORG.id, email: SESSION.user.email },
    },
    responseHeaders: {},
    responseStatus: undefined,
  }
}

// Default h3 mock that matches our fakeEvent shape. Test files can call
// `vi.mock('h3', () => mockH3())` to get it.
export function mockH3() {
  return {
    defineEventHandler: (fn: unknown) => fn,
    getRouterParam: (event: FakeEvent, name: string) => event.params[name],
    readBody: (event: FakeEvent) => Promise.resolve(event.body),
    getQuery: (event: FakeEvent) => event.query,
    // readRawBody(event, false) giver Buffer — binære uploads (logo/font).
    readRawBody: (event: FakeEvent) => Promise.resolve(event.body),
    getRequestHeader: (event: FakeEvent, name: string) => event.headers[name.toLowerCase()] ?? null,
    getRequestIP: (event: FakeEvent) => event.headers['x-forwarded-for'] ?? null,
    setHeader: (event: FakeEvent, name: string, value: string | number) => {
      event.responseHeaders[name.toLowerCase()] = String(value)
    },
    setResponseStatus: (event: FakeEvent, status: number) => {
      event.responseStatus = status
    },
    // `data` bæres med, så tests kan assertere på fejl-koder (fx
    // quota_exceeded, licence_attestation_required) og ikke kun statuskoder.
    createError: (opts: { statusCode: number; statusMessage?: string; data?: unknown }) => {
      const err = new Error(opts.statusMessage ?? '') as Error & {
        statusCode: number
        data?: unknown
      }
      err.statusCode = opts.statusCode
      if (opts.data !== undefined) err.data = opts.data
      return err
    },
  }
}

// ─── In-memory table fixtures ─────────────────────────────────────────────
// Test files declare their own array per table and a vi.mock of '~~/server/db'
// that returns rows based on which schema reference comes through the
// `from(table)` call. This factory builds the standard mock — pass the rows
// objects and get back a `db` that handles select / insert / update /
// transaction / etc with reasonable defaults.

export interface MockTables {
  project?: FakeProject[]
  configVersion?: Array<{
    id: string
    projectId: string
    version: number
    tokensJson: Record<string, unknown>
    status: 'draft' | 'published'
    publishedAt: Date | null
    publishedBy: string | null
    createdAt: Date
  }>
  activeVersion?: Array<{
    projectId: string
    configVersionId: string
    activatedAt: Date
    activatedBy: string
  }>
  apiKey?: Array<{
    id: string
    projectId: string
    keyHash: string
    keyPrefix: string
    revokedAt: Date | null
    rateLimit: number
    allowedOrigins: string[]
    environment: string
  }>
  projectMember?: Array<{ projectId: string; userId: string; role: string }>
  member?: Array<{ organizationId: string; userId: string; role: string }>
  projectInvitation?: Array<{
    id: string
    projectId: string
    email: string
    role: string
    status: string
    invitedBy: string
    expiresAt: Date
  }>
  organization?: FakeOrg[]
  auditLog?: Array<Record<string, unknown>>
}

// Records emitted by writes — tests assert against these.
export interface MockSpies {
  inserts: Array<{ table: string; values: Record<string, unknown> | Record<string, unknown>[] }>
  updates: Array<{ table: string; set: Record<string, unknown> }>
  audit: Array<{ action: string; payload: Record<string, unknown> }>
  storage: Array<{ key: string; contentType: string; bodyPreview: string }>
  bunnyPurges: Array<string>
}

export function createSpies(): MockSpies {
  return { inserts: [], updates: [], audit: [], storage: [], bunnyPurges: [] }
}
