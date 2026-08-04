import { describe, expect, it } from 'vitest'
import {
  ATTESTATION_REGISTRY_LIVE_SINCE,
  ATTESTATION_RETENTION_YEARS,
  ATTESTATION_SWEEP_IMPLEMENTED,
} from '../lib/legal'

// Dødmandsknap for font-licens-registrets sletning ([jura] §16b).
//
// Vi har bygget uret (servingEndedAt) men ikke sweepet der sletter. Det var
// den rigtige prioritering — et forkert ur kan ikke repareres bagudrettet,
// et manglende sweep kan bygges når som helst — men den efterlader en
// forpligtelse der forfalder om ti år, hvor ingen husker aftalen.
//
// Denne test omdanner hukommelsesproblemet til et build-tids-signal: den
// fejler DEN DAG den første række teoretisk kan blive sletbar, hvis sweepet
// stadig ikke findes. Den kræver hverken database eller produktionsdata, og
// den følger automatisk med hvis fristen ændres (Allan har 10-vs-5-år til
// afgørelse), fordi datoen regnes ud fra konstanterne.

/** Ren beslutning, så dødmandsknappens ADFÆRD kan testes uden at vente ti år. */
export function sweepIsOverdue(opts: {
  liveSince: string
  retentionYears: number
  sweepImplemented: boolean
  now: number
}): boolean {
  const live = new Date(`${opts.liveSince}T00:00:00Z`)
  const due = new Date(live)
  due.setUTCFullYear(due.getUTCFullYear() + opts.retentionYears)
  return opts.now >= due.getTime() && !opts.sweepImplemented
}

function firstPossibleDeletionDate(): Date {
  const live = new Date(`${ATTESTATION_REGISTRY_LIVE_SINCE}T00:00:00Z`)
  const due = new Date(live)
  due.setUTCFullYear(due.getUTCFullYear() + ATTESTATION_RETENTION_YEARS)
  return due
}

describe('font licence registry — deletion dead-man switch', () => {
  it('has a sweep by the time the first row can become deletable', () => {
    const due = firstPossibleDeletionDate()
    const overdue = Date.now() >= due.getTime()

    if (overdue && !ATTESTATION_SWEEP_IMPLEMENTED) {
      throw new Error(
        [
          'FONT LICENCE REGISTRY: retention is now overdue and no sweep exists.',
          '',
          `The font_licence_attestation table has been live since ${ATTESTATION_REGISTRY_LIVE_SINCE}.`,
          `Jura's rule (§16a) is that a row is deleted ${ATTESTATION_RETENTION_YEARS} years after the`,
          'file it documents was LAST served (the servingEndedAt column). As of',
          `${due.toISOString().slice(0, 10)} the oldest possible row has passed that mark, so rows`,
          'may now be retained longer than the rule allows.',
          '',
          'The sweep was deliberately deferred in 2026: nothing became deletable for a',
          'decade, and the priority was getting the clock right. This test exists so the',
          'obligation surfaces as a build failure rather than depending on anyone',
          'remembering it. What to do now:',
          '',
          '  1. Build the sweep: delete rows where servingEndedAt is older than',
          '     ATTESTATION_RETENTION_YEARS. Rows with servingEndedAt = NULL are still',
          '     being served and must NOT be touched.',
          '  2. Set ATTESTATION_SWEEP_IMPLEMENTED = true in lib/legal.ts.',
          '  3. Check with [jura] whether the retention period still stands — it was',
          '     pending external counsel review when this was written.',
        ].join('\n'),
      )
    }

    expect(overdue && !ATTESTATION_SWEEP_IMPLEMENTED).toBe(false)
  })

  it('computes the deadline from the constants, so a changed period moves it', () => {
    // Pinner at dødmandsknappen ikke er hardcodet til 2036: ændrer Allan
    // fristen til 5 år, rykker deadline tilsvarende frem.
    const due = firstPossibleDeletionDate()
    expect(due.getUTCFullYear()).toBe(
      new Date(`${ATTESTATION_REGISTRY_LIVE_SINCE}T00:00:00Z`).getUTCFullYear() +
        ATTESTATION_RETENTION_YEARS,
    )
  })

  // En dødmandsknap der ikke KAN fejle er værdiløs — her bevises begge
  // retninger med simulerede datoer, så mekanismen er verificeret i dag og
  // ikke først den dag den skal virke.
  it('fires once the deadline passes without a sweep', () => {
    expect(
      sweepIsOverdue({
        liveSince: '2015-08-04',
        retentionYears: 10,
        sweepImplemented: false,
        now: Date.parse('2026-01-01T00:00:00Z'),
      }),
    ).toBe(true)
  })

  it('stays silent before the deadline, and after a sweep exists', () => {
    expect(
      sweepIsOverdue({
        liveSince: '2026-08-04',
        retentionYears: 10,
        sweepImplemented: false,
        now: Date.parse('2030-01-01T00:00:00Z'),
      }),
    ).toBe(false)
    expect(
      sweepIsOverdue({
        liveSince: '2015-08-04',
        retentionYears: 10,
        sweepImplemented: true,
        now: Date.parse('2026-01-01T00:00:00Z'),
      }),
    ).toBe(false)
  })
})
