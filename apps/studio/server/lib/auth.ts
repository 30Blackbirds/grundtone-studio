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
      async sendInvitationEmail({ email: to, organization: org, invitation, inviter }) {
        const baseUrl = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'
        const acceptUrl = `${baseUrl}/invitations/${invitation.id}`
        const subject = `Invitation to join ${org.name} on Grundtone Studio`
        const text = [
          `${inviter.user.name ?? inviter.user.email} invited you to join ${org.name} on Grundtone Studio.`,
          '',
          `Accept the invitation:`,
          acceptUrl,
          '',
          `If you didn't expect this, ignore this email.`,
        ].join('\n')
        const html = `
          <p>${inviter.user.name ?? inviter.user.email} invited you to join <strong>${org.name}</strong> on Grundtone Studio.</p>
          <p><a href="${acceptUrl}">Accept the invitation</a></p>
          <p>If you didn't expect this, ignore this email.</p>
        `
        await email.send({ to, subject, text, html })
      },
    }),
  ],
})

export type Auth = typeof auth
