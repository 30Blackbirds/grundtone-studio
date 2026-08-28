import { describe, expect, it, afterEach } from 'vitest'
import { internalOrgCount, isInternalOrg } from './internal-orgs'

afterEach(() => {
  delete process.env.STUDIO_INTERNAL_ORG_IDS
})

describe('internalOrgCount (boot-loggens tal)', () => {
  it('er 0 når variablen ikke er sat', () => {
    expect(internalOrgCount()).toBe(0)
  })

  // 🔴 Kernen i [sikkerhed]s krav: en tom streng må give 0, ikke 1. Gav den 1,
  // ville boot-loggen melde en konfigureret undtagelse der ikke findes — og
  // så ville loggen bekræfte præcis den fejl, den er sat op for at afsløre.
  it('er 0 for tom og whitespace-streng, ikke 1', () => {
    process.env.STUDIO_INTERNAL_ORG_IDS = ''
    expect(internalOrgCount()).toBe(0)
    process.env.STUDIO_INTERNAL_ORG_IDS = '  ,  , '
    expect(internalOrgCount()).toBe(0)
  })

  it('tæller det den faktisk læste, whitespace trimmet', () => {
    process.env.STUDIO_INTERNAL_ORG_IDS = ' org-a , org-b '
    expect(internalOrgCount()).toBe(2)
    expect(isInternalOrg('org-a')).toBe(true)
    expect(isInternalOrg('org-b')).toBe(true)
  })

  // Tallet skal følge listen, ellers kan loggen melde grønt om en tom liste.
  it('matcher hvad isInternalOrg rent faktisk accepterer', () => {
    process.env.STUDIO_INTERNAL_ORG_IDS = 'org-a,org-a'
    expect(internalOrgCount()).toBe(1)
    expect(isInternalOrg('org-a')).toBe(true)
  })
})
