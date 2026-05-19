import { describe, it, expect } from 'vitest'
import {
  localeFromCookieHeader,
  magicLinkEmail,
  orgInviteEmail,
  projectInviteEmail,
  verifyEmailEmail,
} from './email-templates'

describe('localeFromCookieHeader', () => {
  it('returns the locale stored in i18n_locale', () => {
    expect(localeFromCookieHeader('i18n_locale=en')).toBe('en')
    expect(localeFromCookieHeader('i18n_locale=da')).toBe('da')
  })

  it('survives other cookies in the same header', () => {
    expect(localeFromCookieHeader('session=abc; i18n_locale=en; gb_consent=true')).toBe('en')
  })

  it('falls back to da when the cookie is missing or unknown', () => {
    expect(localeFromCookieHeader(undefined)).toBe('da')
    expect(localeFromCookieHeader('')).toBe('da')
    expect(localeFromCookieHeader('i18n_locale=klingon')).toBe('da')
    expect(localeFromCookieHeader('other=1')).toBe('da')
  })
})

describe('magicLinkEmail', () => {
  const args = { url: 'https://studio.grundtone.io/magic/abc' }

  it('renders Danish by default', () => {
    const m = magicLinkEmail(args)
    expect(m.subject).toBe('Log ind på Grundtone Studio')
    expect(m.text).toContain(args.url)
    expect(m.html).toContain(`href="${args.url}"`)
  })

  it('renders English when locale is en', () => {
    const m = magicLinkEmail(args, 'en')
    expect(m.subject).toBe('Sign in to Grundtone Studio')
    expect(m.text).toContain(args.url)
  })
})

describe('orgInviteEmail', () => {
  it('escapes user-controlled strings in HTML', () => {
    const m = orgInviteEmail(
      {
        acceptUrl: 'https://studio.grundtone.io/invitations/1',
        orgName: 'Acme <script>alert(1)</script>',
        inviterDisplay: 'Bobby "Tables" Drop',
      },
      'en',
    )
    expect(m.html).not.toContain('<script>')
    expect(m.html).toContain('&lt;script&gt;')
    expect(m.html).toContain('&quot;Tables&quot;')
    // Subject stays plaintext — text-only context, no escape needed.
    expect(m.subject).toContain('Acme <script>')
  })
})

describe('verifyEmailEmail', () => {
  const args = { url: 'https://studio.grundtone.io/api/auth/verify-email?token=xyz' }

  it('renders Danish by default with personalized greeting when name is given', () => {
    const m = verifyEmailEmail({ ...args, name: 'Allan' })
    expect(m.subject).toBe('Bekræft din e-mail til Grundtone Studio')
    expect(m.text).toContain('Hej Allan,')
    expect(m.html).toContain(`href="${args.url}"`)
  })

  it('falls back to a generic greeting when name is missing', () => {
    const m = verifyEmailEmail(args)
    expect(m.text).toContain('Hej,')
    expect(m.text).not.toContain('Hej undefined')
  })

  it('renders English when locale is en', () => {
    const m = verifyEmailEmail({ ...args, name: 'Allan' }, 'en')
    expect(m.subject).toBe('Verify your email for Grundtone Studio')
    expect(m.text).toContain('Hi Allan,')
  })

  it('mentions the 1-hour expiry window in both locales', () => {
    expect(verifyEmailEmail(args, 'da').text).toContain('1 time')
    expect(verifyEmailEmail(args, 'en').text).toContain('1 hour')
  })

  it('escapes user-controlled name and url in HTML', () => {
    // Both fields are user-controlled at the boundary: name comes from the
    // signup form, url is constructed by Better Auth but contains a token
    // we don't validate. Treat both as untrusted in the HTML body.
    const unsafeUrl =
      'https://studio.grundtone.io/api/auth/verify-email?token=xyz&next=" onclick="alert(1)'
    const m = verifyEmailEmail({ url: unsafeUrl, name: 'Allan <script>alert(1)</script>' }, 'en')
    expect(m.html).not.toContain('<script>alert(1)</script>')
    expect(m.html).toContain('&lt;script&gt;')
    // The raw unsafe URL should never reach the href attribute verbatim;
    // the entities must be escaped.
    expect(m.html).not.toContain(`href="${unsafeUrl}"`)
    expect(m.html).toContain('&amp;next=')
    expect(m.html).toContain('&quot; onclick=&quot;')
    // Subject is plaintext — no HTML, no escape needed; should NOT contain
    // entities (we don't want users seeing '&lt;script&gt;' in their inbox).
    expect(m.subject).not.toContain('&lt;')
  })
})

describe('projectInviteEmail', () => {
  const args = {
    acceptUrl: 'https://studio.grundtone.io/invitations/project/1',
    projectName: 'Main',
    orgName: 'Acme',
    role: 'editor' as const,
    expiresInDays: 7,
  }

  it('localizes the role label per locale', () => {
    expect(projectInviteEmail(args, 'da').html).toContain('Redigerer')
    expect(projectInviteEmail(args, 'en').html).toContain('Editor')
  })

  it('mentions the expiry window in both locales', () => {
    expect(projectInviteEmail(args, 'da').text).toContain('7 dage')
    expect(projectInviteEmail(args, 'en').text).toContain('7 days')
  })
})
