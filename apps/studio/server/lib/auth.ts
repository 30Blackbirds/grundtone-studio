import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink, organization } from 'better-auth/plugins'
import { createAccessControl } from 'better-auth/plugins/access'
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from 'better-auth/plugins/organization/access'
import { db } from '../db'
import { email } from './email'
import { localeFromBetterAuthContext, magicLinkEmail, orgInviteEmail } from './email-templates'

// Sentry-style 5-tier org roles. Better Auth ships with owner/admin/member;
// we add `billing` and `manager` so the invite/update endpoints don't reject
// them. Real access enforcement happens in server/lib/project-access.ts via
// requireOrgRole — these AC permissions are placeholders to satisfy Better
// Auth's built-in role validator (validStaticRoles check at invite time).
const orgAc = createAccessControl(defaultStatements)
const billingAc = orgAc.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: [],
})
const managerAc = orgAc.newRole({
  organization: ['update'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  team: ['create', 'update', 'delete'],
  ac: ['create', 'read', 'update', 'delete'],
})

const secret = process.env.BETTER_AUTH_SECRET
if (!secret) {
  throw new Error('BETTER_AUTH_SECRET is not set')
}

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  secret,
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  // Production locks down to BETTER_AUTH_URL. Dev accepts any localhost port
  // because Nuxt falls back to 3001/3002/3003/... when an orphaned dev server
  // is holding 3000, and we shouldn't have to chase the port each time.
  trustedOrigins:
    process.env.NODE_ENV === 'production'
      ? [process.env.BETTER_AUTH_URL ?? '']
      : [
          process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
          ...Array.from({ length: 20 }, (_, i) => `http://localhost:${3000 + i}`),
          ...Array.from({ length: 20 }, (_, i) => `http://127.0.0.1:${3000 + i}`),
        ],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email: to, url }, request) => {
        const locale = localeFromBetterAuthContext(request)
        await email.send({ to, ...magicLinkEmail({ url }, locale) })
      },
    }),
    organization({
      allowUserToCreateOrganization: true,
      // The user who creates an org gets 'owner'. Sentry-equivalent: unrestricted.
      creatorRole: 'owner',
      ac: orgAc,
      roles: {
        owner: ownerAc,
        manager: managerAc,
        admin: adminAc,
        member: memberAc,
        billing: billingAc,
      },
      async sendInvitationEmail({ email: to, organization: org, invitation, inviter }, request) {
        const locale = localeFromBetterAuthContext(request)
        const baseUrl = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'
        const acceptUrl = `${baseUrl}/invitations/${invitation.id}`
        await email.send({
          to,
          ...orgInviteEmail(
            {
              acceptUrl,
              orgName: org.name,
              inviterDisplay: inviter.user.name ?? inviter.user.email,
            },
            locale,
          ),
        })
      },
    }),
  ],
})

export type Auth = typeof auth
