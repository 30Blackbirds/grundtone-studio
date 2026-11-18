import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acceptInvitation,
  changeMemberRole,
  createInvitation,
  createOrganization,
  deleteOrganization,
  getOrganization,
  INVITATION_TTL_MS,
  leaveOrganization,
  listInvitations,
  listMembers,
  listOrganizations,
  LocalOrgError,
  MAX_PENDING_INVITATIONS,
  removeMember,
  revokeInvitation,
  type Actor,
} from './local-orgs'
import type { OrgRole } from './project-access'

// Studio-owned organisations against a REAL Postgres. Denials and tenant
// isolation come first: they are what this module exists to guarantee.
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL && process.env.CI) {
  throw new Error('DATABASE_URL is not visible to the test process in CI')
}

type Db = typeof import('~~/server/db').db
let db: Db
let schema: typeof import('~~/server/db/schema')

const userIds: string[] = []
const orgIds: string[] = []

async function code(p: Promise<unknown>): Promise<string> {
  return p.then(
    () => 'ok',
    (e: unknown) => (e instanceof LocalOrgError ? e.code : `other:${String(e)}`),
  )
}

describe.skipIf(!DATABASE_URL)('local organisations (real Postgres)', () => {
  beforeAll(async () => {
    ;({ db } = await import('~~/server/db'))
    schema = await import('~~/server/db/schema')
  })

  afterAll(async () => {
    if (!db) return
    if (orgIds.length) {
      await db.delete(schema.auditLog).where(inArray(schema.auditLog.organizationId, orgIds))
      await db.delete(schema.project).where(inArray(schema.project.organizationId, orgIds))
      await db.delete(schema.orgMember).where(inArray(schema.orgMember.organizationId, orgIds))
      await db.delete(schema.organization).where(inArray(schema.organization.id, orgIds))
    }
    if (userIds.length) await db.delete(schema.appUser).where(inArray(schema.appUser.id, userIds))
    await db.$client.end()
  })

  async function user(email = `u-${randomUUID()}@example.com`): Promise<Actor> {
    const id = randomUUID()
    userIds.push(id)
    await db.insert(schema.appUser).values({ id, email, emailVerified: true })
    return { id, email }
  }

  /** An org with an owner and one member per extra role. */
  async function org(roles: OrgRole[] = []) {
    const owner = await user()
    const o = await createOrganization(db, owner, {
      name: 'Acme',
      slug: `acme-${randomUUID().slice(0, 8)}`,
    })
    orgIds.push(o.id)
    const members: Record<string, Actor> = {}
    for (const role of roles) {
      const u = await user()
      await db.insert(schema.orgMember).values({ organizationId: o.id, userId: u.id, role })
      members[role] = u
    }
    return { org: o, owner, members }
  }

  const roleOf = async (orgId: string, userId: string) =>
    (await listMembers(db, { id: userId }, orgId).catch(() => [])).find((m) => m.userId === userId)
      ?.role

  describe('tenant isolation', () => {
    it('answers an outsider exactly as for an organisation that does not exist', async () => {
      const a = await org()
      const outsider = await user()
      const ghost = randomUUID()
      for (const orgId of [a.org.id, ghost]) {
        expect(await code(listMembers(db, outsider, orgId))).toBe('not_found')
        expect(await code(changeMemberRole(db, outsider, orgId, a.owner.id, 'member'))).toBe(
          'not_found',
        )
        expect(await code(removeMember(db, outsider, orgId, a.owner.id))).toBe('not_found')
        expect(await code(leaveOrganization(db, outsider, orgId))).toBe('not_found')
        expect(await code(deleteOrganization(db, outsider, orgId))).toBe('not_found')
        expect(
          await code(
            createInvitation(db, outsider, orgId, { email: 'x@example.com', role: 'member' }),
          ),
        ).toBe('not_found')
        expect(await code(listInvitations(db, outsider, orgId))).toBe('not_found')
      }
      expect(await getOrganization(db, outsider.id, { id: a.org.id })).toBeNull()
      expect(await getOrganization(db, outsider.id, { slug: a.org.slug })).toBeNull()
      expect(await listOrganizations(db, outsider.id)).toEqual([])
    })

    it("an owner of org A has no power in org B, even naming B's members", async () => {
      const a = await org()
      const b = await org(['member'])
      expect(await code(removeMember(db, a.owner, b.org.id, b.members.member!.id))).toBe(
        'not_found',
      )
      expect(await code(changeMemberRole(db, a.owner, b.org.id, b.owner.id, 'member'))).toBe(
        'not_found',
      )
      expect(await code(deleteOrganization(db, a.owner, b.org.id))).toBe('not_found')
      expect(await roleOf(b.org.id, b.owner.id)).toBe('owner')
      expect(await roleOf(b.org.id, b.members.member!.id)).toBe('member')
    })

    it('a member of org A cannot be reached through org B', async () => {
      const a = await org(['member'])
      const b = await org()
      expect(await code(removeMember(db, b.owner, b.org.id, a.members.member!.id))).toBe(
        'not_found',
      )
      expect(
        await code(changeMemberRole(db, b.owner, b.org.id, a.members.member!.id, 'admin')),
      ).toBe('not_found')
      expect(await roleOf(a.org.id, a.members.member!.id)).toBe('member')
    })

    it('an invitation of org B cannot be listed, revoked or found through org A', async () => {
      const a = await org()
      const b = await org()
      const inv = await createInvitation(db, b.owner, b.org.id, {
        email: 'x@example.com',
        role: 'member',
      })
      expect(await code(revokeInvitation(db, a.owner, a.org.id, inv.id))).toBe('not_found')
      expect((await listInvitations(db, a.owner, a.org.id)).map((i) => i.id)).not.toContain(inv.id)
      expect((await listInvitations(db, b.owner, b.org.id)).map((i) => i.id)).toContain(inv.id)
    })

    it("lists only the caller's own organisations and their own members", async () => {
      const a = await org(['member'])
      const b = await org(['admin'])
      expect((await listOrganizations(db, a.owner.id)).map((o) => o.id)).toEqual([a.org.id])
      const ids = (await listMembers(db, a.owner, a.org.id)).map((m) => m.userId)
      expect(ids.sort()).toEqual([a.owner.id, a.members.member!.id].sort())
      expect(ids).not.toContain(b.members.admin!.id)
    })

    it('accepting an invitation to B grants nothing in A', async () => {
      const a = await org()
      const b = await org()
      const u = await user('who@example.com')
      const inv = await createInvitation(db, b.owner, b.org.id, {
        email: 'who@example.com',
        role: 'admin',
      })
      await acceptInvitation(
        db,
        { ...u, emailVerified: true, email: 'who@example.com' },
        inv.token,
        {
          requireEmailVerified: true,
        },
      )
      expect(await roleOf(b.org.id, u.id)).toBe('admin')
      expect(await roleOf(a.org.id, u.id)).toBeUndefined()
    })
  })

  describe('who may change roles', () => {
    it.each(['member', 'admin', 'billing'] as OrgRole[])(
      'a %s may not manage members',
      async (role) => {
        const o = await org([role, 'member'])
        const actor = o.members[role]!
        const target = role === 'member' ? o.owner : o.members.member!
        expect(await code(changeMemberRole(db, actor, o.org.id, target.id, 'billing'))).toBe(
          'forbidden',
        )
        expect(await code(removeMember(db, actor, o.org.id, target.id))).toBe('forbidden')
        expect(
          await code(
            createInvitation(db, actor, o.org.id, { email: 'x@example.com', role: 'billing' }),
          ),
        ).toBe('forbidden')
        expect(await code(listInvitations(db, actor, o.org.id))).toBe('forbidden')
        expect(await code(deleteOrganization(db, actor, o.org.id))).toBe('forbidden')
      },
    )

    it('a manager cannot touch an owner or a peer manager, nor grant manager or owner', async () => {
      const o = await org(['manager', 'manager', 'member'])
      const manager = o.members.manager!
      const peer = await user()
      await db
        .insert(schema.orgMember)
        .values({ organizationId: o.org.id, userId: peer.id, role: 'manager' })
      expect(await code(changeMemberRole(db, manager, o.org.id, o.owner.id, 'member'))).toBe(
        'forbidden',
      )
      expect(await code(removeMember(db, manager, o.org.id, o.owner.id))).toBe('forbidden')
      expect(await code(changeMemberRole(db, manager, o.org.id, peer.id, 'member'))).toBe(
        'forbidden',
      )
      expect(
        await code(changeMemberRole(db, manager, o.org.id, o.members.member!.id, 'manager')),
      ).toBe('forbidden')
      expect(
        await code(changeMemberRole(db, manager, o.org.id, o.members.member!.id, 'owner')),
      ).toBe('forbidden')
      expect(
        await code(
          createInvitation(db, manager, o.org.id, { email: 'x@example.com', role: 'owner' }),
        ),
      ).toBe('forbidden')
      expect(await roleOf(o.org.id, o.owner.id)).toBe('owner')
    })

    it('a manager can manage below their rank', async () => {
      const o = await org(['manager', 'member'])
      const manager = o.members.manager!
      await changeMemberRole(db, manager, o.org.id, o.members.member!.id, 'admin')
      expect(await roleOf(o.org.id, o.members.member!.id)).toBe('admin')
      await removeMember(db, manager, o.org.id, o.members.member!.id)
      expect(await roleOf(o.org.id, o.members.member!.id)).toBeUndefined()
    })

    it('an owner can promote another owner and demote one (decision 2)', async () => {
      const o = await org(['member'])
      await changeMemberRole(db, o.owner, o.org.id, o.members.member!.id, 'owner')
      expect(await roleOf(o.org.id, o.members.member!.id)).toBe('owner')
      await changeMemberRole(db, o.members.member!, o.org.id, o.owner.id, 'member')
      expect(await roleOf(o.org.id, o.owner.id)).toBe('member')
    })

    it('refuses an unknown role and an unknown target', async () => {
      const o = await org()
      expect(
        await code(changeMemberRole(db, o.owner, o.org.id, o.owner.id, 'god' as OrgRole)),
      ).toBe('invalid_input')
      expect(await code(changeMemberRole(db, o.owner, o.org.id, randomUUID(), 'member'))).toBe(
        'not_found',
      )
      expect(await code(removeMember(db, o.owner, o.org.id, randomUUID()))).toBe('not_found')
    })

    it('writes an audit row for each change, scoped to the org', async () => {
      const o = await org(['member'])
      await changeMemberRole(db, o.owner, o.org.id, o.members.member!.id, 'admin')
      await removeMember(db, o.owner, o.org.id, o.members.member!.id)
      const rows = await db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.organizationId, o.org.id))
      expect(rows.map((r) => r.action).sort()).toEqual([
        'member.removed',
        'member.role_changed',
        'organization.created',
      ])
      expect(rows.every((r) => r.actorUserId === o.owner.id)).toBe(true)
    })
  })

  describe('last-owner protection', () => {
    it('refuses to demote, remove or leave as the only owner', async () => {
      const o = await org(['member'])
      expect(await code(changeMemberRole(db, o.owner, o.org.id, o.owner.id, 'manager'))).toBe(
        'last_owner',
      )
      expect(await code(removeMember(db, o.owner, o.org.id, o.owner.id))).toBe('last_owner')
      expect(await code(leaveOrganization(db, o.owner, o.org.id))).toBe('last_owner')
      expect(await roleOf(o.org.id, o.owner.id)).toBe('owner')
    })

    it('allows it once another owner exists, and then protects the new last one', async () => {
      const o = await org(['member'])
      const second = o.members.member!
      await changeMemberRole(db, o.owner, o.org.id, second.id, 'owner')
      await leaveOrganization(db, o.owner, o.org.id)
      expect(await code(leaveOrganization(db, second, o.org.id))).toBe('last_owner')
    })

    it('does not count a disabled owner', async () => {
      const o = await org(['member'])
      const second = o.members.member!
      await changeMemberRole(db, o.owner, o.org.id, second.id, 'owner')
      await db
        .update(schema.appUser)
        .set({ disabledAt: new Date() })
        .where(eq(schema.appUser.id, second.id))
      // The only ENABLED owner is o.owner: they cannot go.
      expect(await code(leaveOrganization(db, o.owner, o.org.id))).toBe('last_owner')
      expect(await code(changeMemberRole(db, o.owner, o.org.id, o.owner.id, 'member'))).toBe(
        'last_owner',
      )
    })

    it('two owners demoting each other at the same time leave exactly one owner', async () => {
      const o = await org(['member'])
      const second = o.members.member!
      await changeMemberRole(db, o.owner, o.org.id, second.id, 'owner')
      const results = await Promise.all([
        code(changeMemberRole(db, o.owner, o.org.id, second.id, 'member')),
        code(changeMemberRole(db, second, o.org.id, o.owner.id, 'member')),
      ])
      expect(results.filter((r) => r === 'ok')).toHaveLength(1)
      // The loser is refused either because the winner already demoted them
      // (forbidden) or because they would be the last owner; never ok.
      expect(results.filter((r) => r === 'last_owner' || r === 'forbidden')).toHaveLength(1)
      const owners = (
        await listMembers(db, o.owner, o.org.id).catch(() => listMembers(db, second, o.org.id))
      ).filter((m) => m.role === 'owner')
      expect(owners).toHaveLength(1)
    })

    it('two owners leaving at the same time leave one owner', async () => {
      const o = await org(['member'])
      const second = o.members.member!
      await changeMemberRole(db, o.owner, o.org.id, second.id, 'owner')
      const results = await Promise.all([
        code(leaveOrganization(db, o.owner, o.org.id)),
        code(leaveOrganization(db, second, o.org.id)),
      ])
      expect(results.sort()).toEqual(['last_owner', 'ok'])
    })

    it('a non-owner leaving is never blocked', async () => {
      const o = await org(['member'])
      await leaveOrganization(db, o.members.member!, o.org.id)
      expect(await roleOf(o.org.id, o.members.member!.id)).toBeUndefined()
    })
  })

  describe('organisations', () => {
    it('makes the creator the owner and refuses a taken or malformed slug', async () => {
      const o = await org()
      expect((await getOrganization(db, o.owner.id, { id: o.org.id }))!.role).toBe('owner')
      expect(await code(createOrganization(db, o.owner, { name: 'X', slug: o.org.slug }))).toBe(
        'slug_taken',
      )
      for (const slug of ['', 'Has Space', 'UPPER', 'a/b', 'x'.repeat(101)]) {
        expect(await code(createOrganization(db, o.owner, { name: 'X', slug }))).toBe(
          'invalid_input',
        )
      }
      expect(await code(createOrganization(db, o.owner, { name: '  ', slug: 'ok-slug-1' }))).toBe(
        'invalid_input',
      )
    })

    it('two creations with one slug at once make one organisation', async () => {
      const a = await user()
      const b = await user()
      const slug = `race-${randomUUID().slice(0, 8)}`
      const results = await Promise.all([
        createOrganization(db, a, { name: 'A', slug }).then(
          (x) => (orgIds.push(x.id), 'ok'),
          (e: LocalOrgError) => e.code,
        ),
        createOrganization(db, b, { name: 'B', slug }).then(
          (x) => (orgIds.push(x.id), 'ok'),
          (e: LocalOrgError) => e.code,
        ),
      ])
      expect(results.sort()).toEqual(['ok', 'slug_taken'])
    })

    it('deleting needs an owner, refuses while projects exist, then removes members', async () => {
      const o = await org(['manager'])
      expect(await code(deleteOrganization(db, o.members.manager!, o.org.id))).toBe('forbidden')
      await db.insert(schema.project).values({ organizationId: o.org.id, slug: 'p', name: 'P' })
      expect(await code(deleteOrganization(db, o.owner, o.org.id))).toBe('org_not_empty')
      await db.delete(schema.project).where(eq(schema.project.organizationId, o.org.id))
      await deleteOrganization(db, o.owner, o.org.id)
      expect(await getOrganization(db, o.owner.id, { id: o.org.id })).toBeNull()
      expect(
        await db
          .select()
          .from(schema.orgMember)
          .where(eq(schema.orgMember.organizationId, o.org.id)),
      ).toEqual([])
    })
  })

  describe('invitations', () => {
    const verified = (u: Actor) => ({ id: u.id, email: u.email ?? null, emailVerified: true })
    const strict = { requireEmailVerified: true }

    it('grants exactly the invited role, to the invited address only', async () => {
      const o = await org()
      const u = await user('Invitee@Example.com')
      const inv = await createInvitation(db, o.owner, o.org.id, {
        email: ' invitee@example.COM ',
        role: 'admin',
      })
      const out = await acceptInvitation(db, verified(u), inv.token, strict)
      expect(out).toEqual({ organizationId: o.org.id, role: 'admin' })
      expect(await roleOf(o.org.id, u.id)).toBe('admin')
    })

    it('stores only a hash of the token', async () => {
      const o = await org()
      const inv = await createInvitation(db, o.owner, o.org.id, {
        email: 'x@example.com',
        role: 'member',
      })
      const [row] = await db
        .select()
        .from(schema.orgInvitation)
        .where(eq(schema.orgInvitation.id, inv.id))
      expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/)
      expect(row!.tokenHash).not.toContain(inv.token)
    })

    it("refuses another person's address, with the same answer as a wrong token", async () => {
      const o = await org()
      const thief = await user('thief@example.com')
      const inv = await createInvitation(db, o.owner, o.org.id, {
        email: 'victim@example.com',
        role: 'admin',
      })
      expect(await code(acceptInvitation(db, verified(thief), inv.token, strict))).toBe(
        'invitation_invalid',
      )
      expect(await code(acceptInvitation(db, verified(thief), 'not-a-token', strict))).toBe(
        'invitation_invalid',
      )
      expect(
        await code(
          acceptInvitation(
            db,
            { id: thief.id, email: null, emailVerified: true },
            inv.token,
            strict,
          ),
        ),
      ).toBe('invitation_invalid')
      expect(await roleOf(o.org.id, thief.id)).toBeUndefined()
    })

    it('needs a verified address when required, and not when the operator turned it off', async () => {
      const o = await org()
      const u = await user('who@example.com')
      const inv = await createInvitation(db, o.owner, o.org.id, {
        email: 'who@example.com',
        role: 'member',
      })
      const unverified = { id: u.id, email: 'who@example.com', emailVerified: false }
      expect(await code(acceptInvitation(db, unverified, inv.token, strict))).toBe(
        'email_unverified',
      )
      expect(await roleOf(o.org.id, u.id)).toBeUndefined()
      await acceptInvitation(db, unverified, inv.token, { requireEmailVerified: false })
      expect(await roleOf(o.org.id, u.id)).toBe('member')
    })

    it('can be used once, even by two requests at the same time', async () => {
      const o = await org()
      const u = await user('once@example.com')
      const v = await user('once@example.com')
      const inv = await createInvitation(db, o.owner, o.org.id, {
        email: 'once@example.com',
        role: 'member',
      })
      const results = await Promise.all([
        code(acceptInvitation(db, verified(u), inv.token, strict)),
        code(acceptInvitation(db, verified(v), inv.token, strict)),
      ])
      expect(results.sort()).toEqual(['invitation_invalid', 'ok'])
    })

    it('refuses an expired, revoked or replaced invitation', async () => {
      const o = await org()
      const u = await user('late@example.com')
      const old = await createInvitation(db, o.owner, o.org.id, {
        email: 'late@example.com',
        role: 'member',
      })
      const later = new Date(Date.now() + INVITATION_TTL_MS + 1000)
      expect(await code(acceptInvitation(db, verified(u), old.token, strict, later))).toBe(
        'invitation_invalid',
      )

      const replaced = await createInvitation(db, o.owner, o.org.id, {
        email: 'late@example.com',
        role: 'admin',
      })
      expect(await code(acceptInvitation(db, verified(u), old.token, strict))).toBe(
        'invitation_invalid',
      )
      await revokeInvitation(db, o.owner, o.org.id, replaced.id)
      expect(await code(acceptInvitation(db, verified(u), replaced.token, strict))).toBe(
        'invitation_invalid',
      )
      expect(await roleOf(o.org.id, u.id)).toBeUndefined()
    })

    it('never lowers an existing member, and raises one to the invited role', async () => {
      const o = await org(['admin'])
      const admin = o.members.admin!
      const down = await createInvitation(db, o.owner, o.org.id, {
        email: admin.email!,
        role: 'billing',
      })
      await acceptInvitation(db, verified(admin), down.token, strict)
      expect(await roleOf(o.org.id, admin.id)).toBe('admin')
      const up = await createInvitation(db, o.owner, o.org.id, {
        email: admin.email!,
        role: 'manager',
      })
      await acceptInvitation(db, verified(admin), up.token, strict)
      expect(await roleOf(o.org.id, admin.id)).toBe('manager')
    })

    it('a manager cannot invite or withdraw an invitation above their rank', async () => {
      const o = await org(['manager'])
      expect(
        await code(
          createInvitation(db, o.members.manager!, o.org.id, {
            email: 'x@example.com',
            role: 'manager',
          }),
        ),
      ).toBe('forbidden')
      const inv = await createInvitation(db, o.owner, o.org.id, {
        email: 'x@example.com',
        role: 'manager',
      })
      expect(await code(revokeInvitation(db, o.members.manager!, o.org.id, inv.id))).toBe(
        'forbidden',
      )
    })

    it('rejects a malformed address and caps pending invitations', async () => {
      const o = await org()
      for (const email of ['', 'no-at', 'a@b', 'a b@c.d']) {
        expect(await code(createInvitation(db, o.owner, o.org.id, { email, role: 'member' }))).toBe(
          'invalid_input',
        )
      }
      const now = new Date()
      await db.insert(schema.orgInvitation).values(
        Array.from({ length: MAX_PENDING_INVITATIONS }, (_, i) => ({
          organizationId: o.org.id,
          email: `bulk${i}@example.com`,
          role: 'member',
          tokenHash: `h-${randomUUID()}`,
          expiresAt: new Date(now.getTime() + 3600_000),
        })),
      )
      expect(
        await code(
          createInvitation(db, o.owner, o.org.id, { email: 'extra@example.com', role: 'member' }),
        ),
      ).toBe('too_many_invitations')
    })

    it('lists pending invitations without their tokens', async () => {
      const o = await org()
      await createInvitation(db, o.owner, o.org.id, { email: 'p@example.com', role: 'member' })
      const list = await listInvitations(db, o.owner, o.org.id)
      expect(list).toHaveLength(1)
      expect(Object.keys(list[0]!).sort()).toEqual([
        'createdAt',
        'email',
        'expiresAt',
        'id',
        'role',
      ])
    })
  })
})
