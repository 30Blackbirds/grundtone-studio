import type { H3Event } from 'h3'

// Server-side email templates, locale-aware. Lives in TypeScript instead of
// JSON/Vue-i18n because mails are rendered far from a Vue context — the
// fewer indirection layers, the fewer subtle escape/SSR bugs. When the
// template count grows past ~6, revisit (vue-email or mjml gives nicer HTML).

export type Locale = 'da' | 'en'
const DEFAULT_LOCALE: Locale = 'da'

function isLocale(value: string | null | undefined): value is Locale {
  return value === 'da' || value === 'en'
}

/** Extract the user's preferred locale from the cookie Nuxt-i18n sets. */
export function localeFromCookieHeader(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE
  const match = header.match(/(?:^|;\s*)i18n_locale=([^;]+)/)
  const v = match?.[1]
  return isLocale(v) ? v : DEFAULT_LOCALE
}

export function localeFromEvent(event: H3Event | undefined): Locale {
  if (!event) return DEFAULT_LOCALE
  return localeFromCookieHeader(getRequestHeader(event, 'cookie'))
}

export function localeFromRequest(request: Request | undefined): Locale {
  if (!request) return DEFAULT_LOCALE
  return localeFromCookieHeader(request.headers.get('cookie'))
}

/**
 * Better Auth passes a context object — not a raw Request — to its plugin
 * callbacks. The shape is unstable across BA versions, so we probe for the
 * cookie header in a few likely spots and fall back to the default locale.
 */
export function localeFromBetterAuthContext(ctx: unknown): Locale {
  if (!ctx || typeof ctx !== 'object') return DEFAULT_LOCALE
  const c = ctx as { request?: Request; headers?: Headers }
  const cookie = c.request?.headers.get('cookie') ?? c.headers?.get?.('cookie') ?? null
  return localeFromCookieHeader(cookie)
}

// HTML escape for any value that ends up inside an email body's html field.
// text bodies don't need escaping. Anything user-controlled — org names,
// project names, inviter names — flows through here before interpolation.
const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c] ?? c)
}

export interface RenderedEmail {
  subject: string
  text: string
  html: string
}

// ─── Templates ──────────────────────────────────────────────────────────

export interface MagicLinkArgs {
  url: string
}

export function magicLinkEmail(
  args: MagicLinkArgs,
  locale: Locale = DEFAULT_LOCALE,
): RenderedEmail {
  const url = args.url
  if (locale === 'da') {
    return {
      subject: 'Log ind på Grundtone Studio',
      text: [
        'Klik på linket nedenfor for at logge ind:',
        '',
        url,
        '',
        'Hvis du ikke har anmodet om dette, kan du ignorere e-mailen.',
      ].join('\n'),
      html: `<p>Klik på linket nedenfor for at logge ind:</p><p><a href="${esc(url)}">${esc(url)}</a></p><p>Hvis du ikke har anmodet om dette, kan du ignorere e-mailen.</p>`,
    }
  }
  return {
    subject: 'Sign in to Grundtone Studio',
    text: [
      'Click the link below to sign in:',
      '',
      url,
      '',
      `If you didn't request this, ignore this email.`,
    ].join('\n'),
    html: `<p>Click the link below to sign in:</p><p><a href="${esc(url)}">${esc(url)}</a></p><p>If you didn't request this, ignore this email.</p>`,
  }
}

export interface VerifyEmailArgs {
  url: string
  name?: string
}

export function verifyEmailEmail(
  args: VerifyEmailArgs,
  locale: Locale = DEFAULT_LOCALE,
): RenderedEmail {
  const { url, name } = args
  const greetingDa = name ? `Hej ${name},` : 'Hej,'
  const greetingEn = name ? `Hi ${name},` : 'Hi,'
  if (locale === 'da') {
    return {
      subject: 'Bekræft din e-mail til Grundtone Studio',
      text: [
        greetingDa,
        '',
        'Velkommen til Grundtone Studio. Bekræft din e-mailadresse ved at klikke på linket nedenfor:',
        '',
        url,
        '',
        'Linket udløber om 1 time. Hvis du ikke har oprettet en konto, kan du ignorere e-mailen.',
      ].join('\n'),
      html: `
        <p>${esc(greetingDa)}</p>
        <p>Velkommen til Grundtone Studio. Bekræft din e-mailadresse ved at klikke på linket nedenfor:</p>
        <p><a href="${esc(url)}">Bekræft min e-mail</a></p>
        <p>Linket udløber om 1 time. Hvis du ikke har oprettet en konto, kan du ignorere e-mailen.</p>
      `,
    }
  }
  return {
    subject: 'Verify your email for Grundtone Studio',
    text: [
      greetingEn,
      '',
      'Welcome to Grundtone Studio. Verify your email address by clicking the link below:',
      '',
      url,
      '',
      `The link expires in 1 hour. If you didn't create an account, ignore this email.`,
    ].join('\n'),
    html: `
      <p>${esc(greetingEn)}</p>
      <p>Welcome to Grundtone Studio. Verify your email address by clicking the link below:</p>
      <p><a href="${esc(url)}">Verify my email</a></p>
      <p>The link expires in 1 hour. If you didn't create an account, ignore this email.</p>
    `,
  }
}

export interface OrgInviteArgs {
  acceptUrl: string
  orgName: string
  inviterDisplay: string
}

export function orgInviteEmail(
  args: OrgInviteArgs,
  locale: Locale = DEFAULT_LOCALE,
): RenderedEmail {
  const { acceptUrl, orgName, inviterDisplay } = args
  if (locale === 'da') {
    return {
      subject: `Invitation til ${orgName} på Grundtone Studio`,
      text: [
        `${inviterDisplay} har inviteret dig til ${orgName} på Grundtone Studio.`,
        '',
        'Accepter invitationen:',
        acceptUrl,
        '',
        'Hvis du ikke forventede dette, kan du ignorere e-mailen.',
      ].join('\n'),
      html: `
        <p>${esc(inviterDisplay)} har inviteret dig til <strong>${esc(orgName)}</strong> på Grundtone Studio.</p>
        <p><a href="${esc(acceptUrl)}">Accepter invitationen</a></p>
        <p>Hvis du ikke forventede dette, kan du ignorere e-mailen.</p>
      `,
    }
  }
  return {
    subject: `Invitation to ${orgName} on Grundtone Studio`,
    text: [
      `${inviterDisplay} invited you to ${orgName} on Grundtone Studio.`,
      '',
      'Accept the invitation:',
      acceptUrl,
      '',
      `If you didn't expect this, ignore this email.`,
    ].join('\n'),
    html: `
      <p>${esc(inviterDisplay)} invited you to <strong>${esc(orgName)}</strong> on Grundtone Studio.</p>
      <p><a href="${esc(acceptUrl)}">Accept the invitation</a></p>
      <p>If you didn't expect this, ignore this email.</p>
    `,
  }
}

export interface ProjectInviteArgs {
  acceptUrl: string
  projectName: string
  orgName: string
  role: 'viewer' | 'editor' | 'admin'
  expiresInDays: number
}

const PROJECT_ROLE_LABEL: Record<Locale, Record<ProjectInviteArgs['role'], string>> = {
  da: { viewer: 'Læser', editor: 'Redigerer', admin: 'Administrator' },
  en: { viewer: 'Viewer', editor: 'Editor', admin: 'Admin' },
}

export interface ResetPasswordArgs {
  url: string
  name?: string
}

export function resetPasswordEmail(
  args: ResetPasswordArgs,
  locale: Locale = DEFAULT_LOCALE,
): RenderedEmail {
  const { url, name } = args
  const greetingDa = name ? `Hej ${name},` : 'Hej,'
  const greetingEn = name ? `Hi ${name},` : 'Hi,'
  if (locale === 'da') {
    return {
      subject: 'Nulstil din adgangskode til Grundtone Studio',
      text: [
        greetingDa,
        '',
        'Du har anmodet om at nulstille din adgangskode. Klik på linket nedenfor:',
        '',
        url,
        '',
        'Linket udløber om 1 time. Hvis du ikke har anmodet om dette, kan du ignorere e-mailen.',
      ].join('\n'),
      html: `
        <p>${esc(greetingDa)}</p>
        <p>Du har anmodet om at nulstille din adgangskode. Klik på linket nedenfor:</p>
        <p><a href="${esc(url)}">Nulstil adgangskode</a></p>
        <p>Linket udløber om 1 time. Hvis du ikke har anmodet om dette, kan du ignorere e-mailen.</p>
      `,
    }
  }
  return {
    subject: 'Reset your Grundtone Studio password',
    text: [
      greetingEn,
      '',
      'You requested a password reset. Click the link below:',
      '',
      url,
      '',
      `The link expires in 1 hour. If you didn't request this, ignore this email.`,
    ].join('\n'),
    html: `
      <p>${esc(greetingEn)}</p>
      <p>You requested a password reset. Click the link below:</p>
      <p><a href="${esc(url)}">Reset password</a></p>
      <p>The link expires in 1 hour. If you didn't request this, ignore this email.</p>
    `,
  }
}

export interface ChangeEmailConfirmationArgs {
  url: string
  newEmail: string
}

export function changeEmailConfirmationEmail(
  args: ChangeEmailConfirmationArgs,
  locale: Locale = DEFAULT_LOCALE,
): RenderedEmail {
  const { url, newEmail } = args
  if (locale === 'da') {
    return {
      subject: 'Bekræft skift af e-mail på Grundtone Studio',
      text: [
        'Du har anmodet om at ændre din e-mailadresse til:',
        newEmail,
        '',
        'Bekræft ændringen ved at klikke på linket nedenfor:',
        '',
        url,
        '',
        'Hvis du ikke har anmodet om dette, kan du ignorere e-mailen.',
      ].join('\n'),
      html: `
        <p>Du har anmodet om at ændre din e-mailadresse til <strong>${esc(newEmail)}</strong>.</p>
        <p>Bekræft ændringen ved at klikke på linket nedenfor:</p>
        <p><a href="${esc(url)}">Bekræft e-mailskift</a></p>
        <p>Hvis du ikke har anmodet om dette, kan du ignorere e-mailen.</p>
      `,
    }
  }
  return {
    subject: 'Confirm your Grundtone Studio email change',
    text: [
      'You requested to change your email address to:',
      newEmail,
      '',
      'Confirm the change by clicking the link below:',
      '',
      url,
      '',
      `If you didn't request this, ignore this email.`,
    ].join('\n'),
    html: `
      <p>You requested to change your email address to <strong>${esc(newEmail)}</strong>.</p>
      <p>Confirm the change by clicking the link below:</p>
      <p><a href="${esc(url)}">Confirm email change</a></p>
      <p>If you didn't request this, ignore this email.</p>
    `,
  }
}

export interface DeleteAccountVerificationArgs {
  url: string
  name?: string
}

export function deleteAccountVerificationEmail(
  args: DeleteAccountVerificationArgs,
  locale: Locale = DEFAULT_LOCALE,
): RenderedEmail {
  const { url, name } = args
  const greetingDa = name ? `Hej ${name},` : 'Hej,'
  const greetingEn = name ? `Hi ${name},` : 'Hi,'
  if (locale === 'da') {
    return {
      subject: 'Bekræft sletning af din Grundtone Studio-konto',
      text: [
        greetingDa,
        '',
        'Du har anmodet om at slette din konto. Bekræft ved at klikke på linket nedenfor:',
        '',
        url,
        '',
        'Linket udløber om 1 time. Hvis du ikke har anmodet om dette, kan du ignorere e-mailen.',
      ].join('\n'),
      html: `
        <p>${esc(greetingDa)}</p>
        <p>Du har anmodet om at slette din konto. Bekræft ved at klikke på linket nedenfor:</p>
        <p><a href="${esc(url)}">Bekræft kontosletning</a></p>
        <p>Linket udløber om 1 time. Hvis du ikke har anmodet om dette, kan du ignorere e-mailen.</p>
      `,
    }
  }
  return {
    subject: 'Confirm deletion of your Grundtone Studio account',
    text: [
      greetingEn,
      '',
      'You requested to delete your account. Confirm by clicking the link below:',
      '',
      url,
      '',
      `The link expires in 1 hour. If you didn't request this, ignore this email.`,
    ].join('\n'),
    html: `
      <p>${esc(greetingEn)}</p>
      <p>You requested to delete your account. Confirm by clicking the link below:</p>
      <p><a href="${esc(url)}">Confirm account deletion</a></p>
      <p>The link expires in 1 hour. If you didn't request this, ignore this email.</p>
    `,
  }
}

export function projectInviteEmail(
  args: ProjectInviteArgs,
  locale: Locale = DEFAULT_LOCALE,
): RenderedEmail {
  const { acceptUrl, projectName, orgName, role, expiresInDays } = args
  const roleLabel = PROJECT_ROLE_LABEL[locale][role]
  if (locale === 'da') {
    return {
      subject: `Invitation til projektet ${projectName} (${orgName})`,
      text: [
        `Du er inviteret til projektet "${projectName}" i ${orgName} som ${roleLabel}.`,
        '',
        'Accepter invitationen:',
        acceptUrl,
        '',
        `Linket udløber om ${expiresInDays} dage. Hvis du ikke forventede dette, kan du ignorere e-mailen.`,
      ].join('\n'),
      html: `
        <p>Du er inviteret til projektet <strong>${esc(projectName)}</strong> i ${esc(orgName)} som <code>${esc(roleLabel)}</code>.</p>
        <p><a href="${esc(acceptUrl)}">Accepter invitationen</a></p>
        <p>Linket udløber om ${expiresInDays} dage. Hvis du ikke forventede dette, kan du ignorere e-mailen.</p>
      `,
    }
  }
  return {
    subject: `Invitation to ${projectName} (${orgName}) on Grundtone Studio`,
    text: [
      `You've been invited to the project "${projectName}" in ${orgName} as ${roleLabel}.`,
      '',
      'Accept the invitation:',
      acceptUrl,
      '',
      `Link expires in ${expiresInDays} days. If you didn't expect this, ignore this email.`,
    ].join('\n'),
    html: `
      <p>You've been invited to the project <strong>${esc(projectName)}</strong> in ${esc(orgName)} as <code>${esc(roleLabel)}</code>.</p>
      <p><a href="${esc(acceptUrl)}">Accept the invitation</a></p>
      <p>Link expires in ${expiresInDays} days. If you didn't expect this, ignore this email.</p>
    `,
  }
}
