import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// The editor binding must name the same Sonar project CI analyses.
//
// 🔴 WHY A CELL AND NOT A COMMENT (riff KH-915).
// `.sonarlint/connectedMode.json` is meant to be copied from repo to repo, and
// the copy carries the PREVIOUS repo's `projectKey`. The result looks
// configured and binds the editor to another project: findings appear, they
// are just someone else's. A warning in a README reaches whoever READS the
// README, not whoever copies the file, so the comparison is computed here.
//
// The same cell exists in grundtone (scripts/lib/sonarlint-binding.test.mjs).
// Two repos, one failure class: the template is owned by [quality], and the
// sweep found 10 of 10 local repos with sonar-project.properties and no
// .sonarlint/.

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const read = (rel: string) => readFileSync(repoRoot + rel, 'utf8')

/** `sonar.projectKey=…` from a Sonar properties file. */
function propertyKey(properties: string): string | undefined {
  const line = properties
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('sonar.projectKey='))
  return line?.slice('sonar.projectKey='.length).trim()
}

describe('the SonarQube for IDE binding', () => {
  it('names the same project as sonar-project.properties', () => {
    const binding = JSON.parse(read('.sonarlint/connectedMode.json'))
    const fromProperties = propertyKey(read('sonar-project.properties'))

    // Denominator: a parser that silently returned undefined would let the
    // comparison below pass whenever BOTH sides are undefined.
    expect(fromProperties, 'sonar-project.properties has no projectKey').toBeTruthy()
    expect(binding.projectKey, 'the binding has no projectKey').toBeTruthy()

    expect(binding.projectKey).toBe(fromProperties)
  })

  it('points at our self-hosted server over https', () => {
    const binding = JSON.parse(read('.sonarlint/connectedMode.json'))
    expect(binding.sonarQubeUri).toBe('https://sonar.klanghaus.dk')
  })

  // 🔴 The binding is committed, so it must never carry a credential. Each
  // developer signs in with their own; that is what makes the file shareable.
  it('carries no token or other secret', () => {
    const raw = read('.sonarlint/connectedMode.json')
    expect(raw).not.toMatch(/token|password|secret/i)
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['projectKey', 'sonarQubeUri'])
  })

  // The parser itself, so the cells above cannot pass on a bug in it.
  it('reads the key from a properties file, ignoring comments and blanks', () => {
    expect(propertyKey('# sonar.projectKey=wrong\n\nsonar.projectKey=right\n')).toBe('right')
    expect(propertyKey('sonar.projectName=x\n')).toBeUndefined()
  })
})
