import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { z } from 'zod'
import type { AuthOrg, MemberSource, OrgListing } from './org-member-sync'

// A MemberSource read from auth's one-time export file (D-E6 = B): Infra runs
// auth's reviewed export script against auth's database, and the backfill
// reads the file it wrote. Nothing here reaches auth over the network.
//
// 🔴 THE FILE IS REFUSED WHOLE, OR USED WHOLE. Any doubt about it (a digest
// that does not match, a format this code does not know, a count that does not
// match its list, a duplicate) throws before the backfill writes anything. A
// partly trusted export is how a backfill would grant from a truncated or
// edited file.
//
// 🔴 WHAT THE SECOND READ PROVES HERE: readOrg reads the file again and checks
// its digest again, so it confirms the SNAPSHOT, not auth as it is now. A
// member removed in auth after the export would still be in it. The backfill
// closes that for removals through studio: the listing carries `exportedAt`,
// and studio's audit since then decides (Sikkerhed C1 on #392).
//
// No CLI, task or route calls this: the backfill grants, and a run needs
// Allan's word.

export const ORG_MEMBERS_FORMAT = 'klanghaus.org-members/1'

/** Larger than any export studio expects; a bigger file is refused, not read. */
export const ORG_MEMBERS_MAX_BYTES = 64 * 1024 * 1024

export class OrgMemberFileRefused extends Error {
  override name = 'OrgMemberFileRefused'
}

// Ids carry no whitespace at all; auth's exporter refuses the same.
const id = z.string().regex(/^\S{1,256}$/)
const role = z.string().min(1).max(256)
const count = z.int().nonnegative()

// The format as agreed with auth (auth#222): `JSON.stringify(doc) + "\n"`, the
// sha256 over exactly those bytes, all counts taken in one snapshot.
const exportFile = z.strictObject({
  format: z.literal(ORG_MEMBERS_FORMAT),
  // The snapshot's now() in UTC, with microseconds.
  exportedAt: z.iso.datetime(),
  // From a separate count in auth, not the length of `orgs`.
  orgCount: count,
  // A separate count of ALL member rows, not the sum of the lists.
  memberTotal: count,
  orgs: z.array(
    z.strictObject({
      orgId: id,
      // From a separate count in auth, not the length of `members`.
      memberCount: count,
      members: z.array(z.strictObject({ userId: id, role })),
    }),
  ),
  // Written only after the export finished every org.
  complete: z.literal(true),
})

type ExportFile = z.infer<typeof exportFile>

const SHA256_HEX = /^[0-9a-f]{64}$/

/**
 * Parses and checks an export. Messages name positions and counts, never a
 * user id: they end up in logs.
 */
export function parseOrgMembersExport(bytes: Buffer, sha256: string): ExportFile {
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== sha256) {
    throw new OrgMemberFileRefused('the file does not match the expected sha256')
  }
  let json: unknown
  try {
    json = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new OrgMemberFileRefused('the file is not valid JSON')
  }
  const parsed = exportFile.safeParse(json)
  if (!parsed.success) {
    const where = parsed.error.issues.map((i) => i.path.join('.') || '(root)').slice(0, 5)
    throw new OrgMemberFileRefused(
      `the file does not have the expected shape at ${where.join(', ')}`,
    )
  }
  const file = parsed.data
  if (file.orgCount !== file.orgs.length) {
    throw new OrgMemberFileRefused(
      `orgCount is ${file.orgCount} but the file lists ${file.orgs.length} orgs`,
    )
  }
  const orgIds = new Set<string>()
  file.orgs.forEach((org, i) => {
    if (orgIds.has(org.orgId)) throw new OrgMemberFileRefused(`orgs.${i} repeats an orgId`)
    orgIds.add(org.orgId)
    if (org.memberCount !== org.members.length) {
      throw new OrgMemberFileRefused(
        `orgs.${i}: memberCount is ${org.memberCount} but it lists ${org.members.length} members`,
      )
    }
    if (new Set(org.members.map((m) => m.userId)).size !== org.members.length) {
      throw new OrgMemberFileRefused(`orgs.${i} lists a userId twice`)
    }
  })
  const listed = file.orgs.reduce((n, org) => n + org.members.length, 0)
  if (file.memberTotal !== listed) {
    throw new OrgMemberFileRefused(
      `memberTotal is ${file.memberTotal} but the orgs list ${listed} members`,
    )
  }
  return file
}

function toAuthOrg(org: ExportFile['orgs'][number]): AuthOrg {
  return {
    orgId: org.orgId,
    members: org.members.map((m) => ({ userId: m.userId, role: m.role })),
    // `complete` is literally true in every file that parses, and the count
    // matched the list above: the proof membersProven asks for.
    membersComplete: true,
    memberCount: org.memberCount,
  }
}

/**
 * A MemberSource over one export file. `sha256` is the digest Infra delivers
 * with the file, out of band; every read checks it again.
 */
export function fileMemberSource(opts: { path: string; sha256: string }): MemberSource {
  const sha256 = opts.sha256.toLowerCase()
  if (!SHA256_HEX.test(sha256)) {
    throw new OrgMemberFileRefused('sha256 must be 64 hex characters')
  }

  async function load(): Promise<ExportFile> {
    const { size } = await stat(opts.path)
    if (size > ORG_MEMBERS_MAX_BYTES) {
      throw new OrgMemberFileRefused(`the file is ${size} bytes, over ${ORG_MEMBERS_MAX_BYTES}`)
    }
    return parseOrgMembersExport(await readFile(opts.path), sha256)
  }

  return {
    async listOrgs(): Promise<OrgListing> {
      const file = await load()
      return {
        orgs: file.orgs.map(toAuthOrg),
        complete: true,
        expectedCount: file.orgCount,
        snapshotAt: file.exportedAt,
      }
    },
    async readOrg(orgId) {
      const org = (await load()).orgs.find((o) => o.orgId === orgId)
      return org ? toAuthOrg(org) : null
    },
  }
}
