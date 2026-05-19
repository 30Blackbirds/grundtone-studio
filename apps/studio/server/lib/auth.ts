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
import { recordAuditEvent } from './audit'
import { email } from './email'
import {
  localeFromBetterAuthContext,
  magicLinkEmail,
  orgInviteEmail,
  verifyEmailEmail,
} from './email-templates'

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
    // Sign-in is blocked until the user clicks the verification link; the
    // verify endpoint redirects to /dashboard on success.
    requireEmailVerification: true,
  },
  emailVerification: {
    // Fire the verification email immediately on email/password signup so
    // the inbox check is the natural next step instead of a separate "send
    // verification email" click.
    sendOnSignUp: true,
    // After the user clicks the link, Better Auth verifies the token and
    // signs them in, then redirects to the callbackURL that was supplied
    // when the verification was triggered. We pass `/dashboard` on both
    // signUp.email() (in signup.vue) and authClient.sendVerificationEmail()
    // (the resend button in verify-email.vue), so the onboarding wizard's
    // empty-state catches the user immediately after verification.
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60, // 1 hour, matches the template's expiry copy.
    sendVerificationEmail: async ({ user, url }, request) => {
      const locale = localeFromBetterAuthContext(request)
      await email.send({
        to: user.email,
        ...verifyEmailEmail({ url, name: user.name }, locale),
      })
    },
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
      // Audit hooks. Better Auth doesn't expose the H3 event here, so we
      // record actor-from-hook and leave IP/user-agent null. The audit
      // helper still picks up actor on endpoint-side mutations via the
      // session, so non-Better-Auth actions stay fully attributed.
      organizationHooks: {
        afterAddMember: async ({ member, user, organization: org }) => {
          await recordAuditEvent(null, {
            organizationId: org.id,
            action: 'member.added',
            targetType: 'member',
            targetId: member.userId,
            targetLabel: user.email,
            after: { role: member.role },
          })
        },
        afterRemoveMember: async ({ member, user, organization: org }) => {
          await recordAuditEvent(null, {
            organizationId: org.id,
            action: 'member.removed',
            targetType: 'member',
            targetId: member.userId,
            targetLabel: user.email,
            before: { role: member.role },
          })
        },
        afterUpdateMemberRole: async ({ member, previousRole, user, organization: org }) => {
          await recordAuditEvent(null, {
            organizationId: org.id,
            action: 'member.role_changed',
            targetType: 'member',
            targetId: member.userId,
            targetLabel: user.email,
            before: { role: previousRole },
            after: { role: member.role },
          })
        },
        afterCreateInvitation: async ({ invitation, inviter, organization: org }) => {
          await recordAuditEvent(null, {
            organizationId: org.id,
            action: 'member.invited',
            targetType: 'invitation',
            targetId: invitation.id,
            targetLabel: invitation.email,
            after: { role: invitation.role },
            actorUserId: inviter.user.id,
            actorEmail: inviter.user.email,
          })
        },
      },
    }),
  ],
})

export type Auth = typeof auth
