/**
 * Connect-RPC service-definition for KlangHaus Permissions PDP.
 *
 * `PermissionsService` er et konstant service-definition-objekt der gives
 * til `createPromiseClient` (klient-side) eller `connectRouter.service`
 * (server-side). Genereret fra `proto/.../permissions.proto`.
 *
 * @example Klient
 * ```ts
 * import { createPromiseClient } from '@connectrpc/connect'
 * import { createConnectTransport } from '@connectrpc/connect-web'
 * import { PermissionsService } from '@klanghaus/permissions-client/connect'
 *
 * const transport = createConnectTransport({
 *   baseUrl: 'https://permissions.klanghaus.dk',
 *   useBinaryFormat: false,
 * })
 * const permissions = createPromiseClient(PermissionsService, transport)
 * const result = await permissions.check({
 *   subject: 'user-abc',
 *   action: 'read',
 *   resource: 'course:xyz',
 * })
 * ```
 *
 * @example Server (Connect-Node)
 * ```ts
 * import type { ConnectRouter } from '@connectrpc/connect'
 * import { PermissionsService } from '@klanghaus/permissions-client/connect'
 *
 * export function routes(router: ConnectRouter): void {
 *   router.service(PermissionsService, {
 *     async check(req, ctx) { ... },
 *     async batchCheck(req, ctx) { ... },
 *     async listMyAccess(req, ctx) { ... },
 *     async health() { return { ready: true, version: '0.1.0' } },
 *   })
 * }
 * ```
 */

export { PermissionsService } from '../gen/klanghaus/permissions/v1/permissions_connect.js'
