import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import da from '../i18n/locales/da.json'
import en from '../i18n/locales/en.json'
import { datetimeFormats } from '../i18n/datetime-formats'
import { auditActionKey } from '../utils/audit-action-label'

// Real vue-i18n with the real locale files: the two failures this guards
// rendered silently (an empty date, a raw key), so only a real resolver shows
// them. vue-i18n is resolved through @nuxtjs/i18n (studio's direct dependency),
// i.e. the copy the app runs on, not a separately pinned one.
const nuxtI18n = createRequire(import.meta.url).resolve('@nuxtjs/i18n/package.json')
const { createI18n } = (await import(
  createRequire(nuxtI18n).resolve('vue-i18n')
)) as typeof import('vue-i18n')
// server/lib/audit imports the db module, which requires a URL at import time;
// postgres.js does not connect until a query runs, and none does here.
process.env.DATABASE_URL ??= 'postgres://unused@127.0.0.1:1/unused'
const { AUDIT_ACTIONS } = await import('../server/lib/audit')

const i18nFor = (locale: 'da' | 'en') =>
  createI18n({
    legacy: false,
    locale,
    missingWarn: false,
    fallbackWarn: false,
    messages: { da, en },
    datetimeFormats,
  }).global

describe.each(['da', 'en'] as const)('%s', (locale) => {
  const { t, d } = i18nFor(locale)

  it('translates every audit action label (keys contain dots)', () => {
    expect(AUDIT_ACTIONS.length).toBeGreaterThan(0)
    for (const action of [...AUDIT_ACTIONS, 'all']) {
      const label = t(auditActionKey(action))
      expect(label, action).not.toContain('audit.actions')
      expect(label.length, action).toBeGreaterThan(0)
    }
  })

  it('the plain dotted path is the failure mode (control)', () => {
    expect(t('audit.actions.config.published')).toBe('audit.actions.config.published')
  })

  it('renders every named date format non-empty', () => {
    const date = new Date('2026-09-17T08:30:00Z')
    for (const name of Object.keys(datetimeFormats[locale])) {
      expect(d(date, name), name).not.toBe('')
    }
  })
})

describe('date format names used in the app', () => {
  const root = join(__dirname, '..')
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (full.endsWith('.vue')) files.push(full)
    }
  }
  for (const dir of ['pages', 'components', 'layouts']) walk(join(root, dir))

  const used = new Set<string>()
  for (const file of files) {
    for (const m of readFileSync(file, 'utf8').matchAll(
      /\bd\([^()]*(?:\([^()]*\)[^()]*)*,\s*'([a-zA-Z]+)'\s*\)/g,
    )) {
      used.add(m[1]!)
    }
  }

  it('finds the d(…, name) calls it is supposed to check', () => {
    expect([...used].length).toBeGreaterThan(0)
  })

  it.each(['da', 'en'] as const)('every used format exists in %s', (locale) => {
    expect([...used].filter((name) => !(name in datetimeFormats[locale]))).toEqual([])
  })
})

// 🔴 THE SUBTITLE COUNTS PLURALISE, AND IN DANISH THE ADJECTIVE AGREES.
// Measured on the served R7 page (KH-1023): with one key the subtitle read
// "1 aktive nøgler" — plural adjective, plural noun, singular count. The R5
// members subtitle had the same latent fault; the seeded fixture has three
// members, so it only ever rendered the plural and nobody saw it. The count
// is passed as vue-i18n's plural selector (third argument), as
// dashboard.tokenCount already does.
describe('subtitle counts pluralise', () => {
  const t = (locale: 'da' | 'en', key: string, n: number) => i18nFor(locale).t(key, { n }, n)

  it.each([
    ['da', 'apiKeys.subtitleActive', 1, '1 aktiv nøgle'],
    ['da', 'apiKeys.subtitleActive', 2, '2 aktive nøgler'],
    ['en', 'apiKeys.subtitleActive', 1, '1 active key'],
    ['en', 'apiKeys.subtitleActive', 2, '2 active keys'],
    ['da', 'members.subtitleActive', 1, '1 aktiv'],
    ['da', 'members.subtitleActive', 3, '3 aktive'],
  ] as const)('%s %s n=%i -> %s', (locale, key, n, expected) => {
    expect(t(locale, key, n)).toBe(expected)
  })
})
