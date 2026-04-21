import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink, organization } from 'better-auth/plugins'
import { db } from '../db'
import { email } from './email'

const secret = process.env.BETTER_AUTH_SECRET
if (!secret) {
  throw new Error('BETTER_AUTH_SECRET is not set')
}

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  secret,
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  trustedOrigins: [
    process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email: to, url }) => {
        await email.send({
          to,
          subject: 'Sign in to Grundtone Studio',
          text: `Click the link below to sign in:\n\n${url}\n\nIf you didn't request this, ignore this email.`,
          html: `<p>Click the link below to sign in:</p><p><a href="${url}">${url}</a></p><p>If you didn't request this, ignore this email.</p>`,
        })
      },
    }),
    organization({
      allowUserToCreateOrganization: true,
    }),
  ],
})

export type Auth = typeof auth
