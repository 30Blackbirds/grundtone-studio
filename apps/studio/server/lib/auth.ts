import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink, organization } from 'better-auth/plugins'
import { db } from '../db'
import { email } from './email'
import { localeFromBetterAuthContext, magicLinkEmail, orgInviteEmail } from './email-templates'

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
