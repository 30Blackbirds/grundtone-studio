import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  fileMemberSource,
  OrgMemberFileRefused,
  ORG_MEMBERS_FORMAT,
  parseOrgMembersExport,
} from './org-member-file-source'

// The export file's checks, without a database. Every fixture is synthetic.
// Each cell starts from the GREEN file and changes one thing.

type Json = Record<string, unknown>

function green(): Json {
  return {
    format: ORG_MEMBERS_FORMAT,
    exportedAt: '2026-11-10T21:05:57.123456Z',
    orgCount: 2,
    memberTotal: 2,
    orgs: [
      {
        orgId: 'org-a',
        memberCount: 2,
        members: [
          { userId: 'user-1', role: 'owner' },
          { userId: 'user-2', role: 'billing,member' },
        ],
      },
      { orgId: 'org-b', memberCount: 0, members: [] },
    ],
    complete: true,
  }
}

// As auth writes it: one line of JSON and a newline the sha256 covers.
const bytesOf = (j: Json) => Buffer.from(JSON.stringify(j) + '\n')
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

function parse(j: Json) {
  const b = bytesOf(j)
  return parseOrgMembersExport(b, sha(b))
}

function refused(j: Json) {
  return expect(() => parse(j)).toThrow(OrgMemberFileRefused)
}

describe('org-member export file', () => {
  it('GREEN: a complete file whose counts match parses, unchanged', () => {
    const file = parse(green())
    expect(file.exportedAt).toBe('2026-11-10T21:05:57.123456Z')
    expect(file.memberTotal).toBe(2)
    expect(file.orgCount).toBe(2)
    expect(file.orgs.map((o) => [o.orgId, o.members.length])).toEqual([
      ['org-a', 2],
      ['org-b', 0],
    ])
    expect(file.orgs[0]!.members[1]).toEqual({ userId: 'user-2', role: 'billing,member' })
  })

  it('a digest that does not match is refused', () => {
    const b = bytesOf(green())
    expect(() => parseOrgMembersExport(b, sha(Buffer.from('other')))).toThrow(
      'does not match the expected sha256',
    )
  })

  it('a truncated file is refused, even with its own digest', () => {
    const b = bytesOf(green()).subarray(0, 120)
    expect(() => parseOrgMembersExport(b, sha(b))).toThrow('not valid JSON')
  })

  it.each([
    ['complete=false', (j: Json) => (j.complete = false)],
    ['complete missing', (j: Json) => delete j.complete],
    ['an unknown format', (j: Json) => (j.format = 'klanghaus.org-members/2')],
    ['an extra top-level key', (j: Json) => (j.note = 'x')],
    ['orgCount missing', (j: Json) => delete j.orgCount],
    ['memberTotal missing', (j: Json) => delete j.memberTotal],
    ['orgCount not an integer', (j: Json) => (j.orgCount = 2.5)],
    ['exportedAt not a timestamp', (j: Json) => (j.exportedAt = 'yesterday')],
    ['an empty userId', (j: Json) => (orgA(j).members[0]!.userId = '')],
    ['a userId with whitespace', (j: Json) => (orgA(j).members[0]!.userId = 'user 1')],
    ['a userId that is not a string', (j: Json) => (orgA(j).members[0]!.userId = 42)],
    ['an empty role', (j: Json) => (orgA(j).members[0]!.role = '')],
    ['an extra key on a member', (j: Json) => (orgA(j).members[0]!.email = 'x@example.test')],
  ])('%s is refused', (_, flip) => {
    const j = green()
    flip(j)
    refused(j)
  })

  it('orgCount that does not match the list is refused', () => {
    const j = green()
    j.orgCount = 3
    expect(() => parse(j)).toThrow('orgCount is 3 but the file lists 2 orgs')
  })

  it('a memberCount that does not match the list is refused', () => {
    const j = green()
    orgA(j).memberCount = 3
    expect(() => parse(j)).toThrow('orgs.0: memberCount is 3 but it lists 2 members')
  })

  it('a memberTotal that does not match the lists is refused', () => {
    const j = green()
    j.memberTotal = 3
    expect(() => parse(j)).toThrow('memberTotal is 3 but the orgs list 2 members')
  })

  it('a repeated orgId is refused', () => {
    const j = green()
    ;(j.orgs as Json[])[1]!.orgId = 'org-a'
    expect(() => parse(j)).toThrow('orgs.1 repeats an orgId')
  })

  it('a userId listed twice in one org is refused', () => {
    const j = green()
    orgA(j).members[1]!.userId = 'user-1'
    expect(() => parse(j)).toThrow('orgs.0 lists a userId twice')
  })

  it('a refusal names positions and counts, never a user id', () => {
    const j = green()
    orgA(j).members[1]!.userId = 'user-1'
    orgA(j).memberCount = 9
    try {
      parse(j)
      expect.unreachable()
    } catch (err) {
      expect(String(err)).not.toContain('user-1')
    }
  })

  it('a sha256 that is not 64 hex characters is refused before any read', () => {
    expect(() => fileMemberSource({ path: '/nonexistent', sha256: 'abc' })).toThrow(
      OrgMemberFileRefused,
    )
  })
})

function orgA(j: Json) {
  return (j.orgs as Array<{ memberCount: unknown; members: Array<Record<string, unknown>> }>)[0]!
}
