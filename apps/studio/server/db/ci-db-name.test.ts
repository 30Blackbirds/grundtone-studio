import { describe, expect, it } from 'vitest'
import { ciDbName } from './ci-db-name'

// The name ci-db.ts creates and FORCE-drops. Two builds must never share one.

/** The formula before the hash suffix, kept here as the negative control. */
const oldName = (tag: string) =>
  `studio_${tag.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`.slice(0, 63)

const long = 'jenkins-grundtone-studio-PR-347-' + 'x'.repeat(60)
const collidingPairs: Array<[string, string]> = [
  // Differ only in characters the sanitiser maps to `_` or in case.
  ['jenkins-grundtone-studio-PR-347-4', 'jenkins_grundtone_studio_pr_347_4'],
  // Differ only past the 63-byte limit.
  [`${long}-1`, `${long}-2`],
]

describe('ciDbName', () => {
  it.each(collidingPairs)('negative control: the old formula collides for %s', (a, b) => {
    expect(oldName(a)).toBe(oldName(b))
  })

  it.each(collidingPairs)('🔴 different tags get different names: %s', (a, b) => {
    expect(ciDbName(a)).not.toBe(ciDbName(b))
  })

  it('the same tag always gets the same name, so a retry reclaims its own database', () => {
    expect(ciDbName('jenkins-grundtone-studio-PR-347-4')).toBe(
      ciDbName('jenkins-grundtone-studio-PR-347-4'),
    )
  })

  it.each(['jenkins-grundtone-studio-PR-347-4', long, 'local-allan', ''])(
    'is a valid postgres identifier with the studio_ prefix: %s',
    (tag) => {
      const name = ciDbName(tag)
      expect(name).toMatch(/^studio_[a-z0-9_]*_[0-9a-f]{12}$/)
      expect(Buffer.byteLength(name)).toBeLessThanOrEqual(63)
    },
  )
})
