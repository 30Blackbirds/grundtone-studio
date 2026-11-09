import type { H3Event } from 'h3'
import * as pdp from './pdp'
import type { OrgRelation, PdpVerdict, ProjectAction } from './pdp'
import { localAuthorizer } from './local-authorizer'
import { authorizerKind } from './runtime-flags'

// Every access decision in studio goes through this interface. Two
// implementations answer it:
//
//   pdp    the permissions service (pdp.ts, unchanged), today's production
//   local  studio's own Postgres (local-authorizer.ts)
//
// AUTHORIZER picks one per process (runtime-flags.ts). The exports below have
// the names and signatures pdp.ts has always had, so callers changed only their
// import path, and every test that mocks pdp.ts still mocks what runs under
// AUTHORIZER=pdp.

export type { OrgRelation, PdpVerdict, ProjectAction } from './pdp'
type ProjectRole = 'viewer' | 'editor' | 'admin'

export interface Authorizer {
  checkProject(event: H3Event, projectId: string, action: ProjectAction): Promise<PdpVerdict>
  checkOrg(event: H3Event, orgId: string, relation: OrgRelation): Promise<PdpVerdict>
  batchCheckProjects(
    event: H3Event,
    projectIds: string[],
    action: ProjectAction,
  ): Promise<Record<string, PdpVerdict>>
  grantProjectRole(
    event: H3Event,
    projectId: string,
    subject: string,
    role: ProjectRole,
  ): Promise<void>
  revokeProjectRole(
    event: H3Event,
    projectId: string,
    subject: string,
    role: ProjectRole,
  ): Promise<void>
  grantMachineProjectRole(
    event: H3Event,
    projectId: string,
    keyId: string,
    role: ProjectRole,
  ): Promise<void>
  revokeMachineProjectRole(
    event: H3Event,
    projectId: string,
    keyId: string,
    role: ProjectRole,
  ): Promise<void>
  linkProjectToOrg(event: H3Event, projectId: string, orgId: string): Promise<void>
}

// Read through the module namespace on every call, not copied at load time: a
// test's partial mock of pdp.ts must only fail on the function it left out.
export const pdpAuthorizer: Authorizer = {
  checkProject: (...a) => pdp.checkProject(...a),
  checkOrg: (...a) => pdp.checkOrg(...a),
  batchCheckProjects: (...a) => pdp.batchCheckProjects(...a),
  grantProjectRole: (...a) => pdp.grantProjectRole(...a),
  revokeProjectRole: (...a) => pdp.revokeProjectRole(...a),
  grantMachineProjectRole: (...a) => pdp.grantMachineProjectRole(...a),
  revokeMachineProjectRole: (...a) => pdp.revokeMachineProjectRole(...a),
  linkProjectToOrg: (...a) => pdp.linkProjectToOrg(...a),
}

/**
 * The authorizer this process was told to use. Throws RuntimeFlagError when
 * AUTHORIZER is missing or unknown, so a request is refused rather than decided
 * by an authorizer nobody chose (the boot plugin normally stops it earlier).
 */
export function authorizer(): Authorizer {
  return authorizerKind(process.env.AUTHORIZER) === 'local' ? localAuthorizer : pdpAuthorizer
}

export const checkProject: Authorizer['checkProject'] = (...a) => authorizer().checkProject(...a)
export const checkOrg: Authorizer['checkOrg'] = (...a) => authorizer().checkOrg(...a)
export const batchCheckProjects: Authorizer['batchCheckProjects'] = (...a) =>
  authorizer().batchCheckProjects(...a)
export const grantProjectRole: Authorizer['grantProjectRole'] = (...a) =>
  authorizer().grantProjectRole(...a)
export const revokeProjectRole: Authorizer['revokeProjectRole'] = (...a) =>
  authorizer().revokeProjectRole(...a)
export const grantMachineProjectRole: Authorizer['grantMachineProjectRole'] = (...a) =>
  authorizer().grantMachineProjectRole(...a)
export const revokeMachineProjectRole: Authorizer['revokeMachineProjectRole'] = (...a) =>
  authorizer().revokeMachineProjectRole(...a)
export const linkProjectToOrg: Authorizer['linkProjectToOrg'] = (...a) =>
  authorizer().linkProjectToOrg(...a)
