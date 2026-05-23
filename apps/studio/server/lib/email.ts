import nodemailer, { type Transporter } from 'nodemailer'
import { withRetry } from './retry'

export type SendEmailArgs = {
  to: string
  subject: string
  text: string
  html?: string
}

type EmailService = {
  send(args: SendEmailArgs): Promise<void>
}

function buildTransporter(): Transporter | null {
  const host = process.env.SMTP_HOST
  if (!host) return null

  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASSWORD
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
  })
}

let transporter: Transporter | null | undefined
const from = process.env.EMAIL_FROM ?? 'Grundtone Studio <no-reply@localhost>'

export const email: EmailService = {
  async send({ to, subject, text, html }) {
    if (transporter === undefined) transporter = buildTransporter()

    if (!transporter) {
      console.info(`[email:dev] to=${to} subject="${subject}"\n${text}`)
      return
    }

    // Postmark + STARTTLS occasionally fails on transient network blips
    // (DNS resync, connection reset). 3 attempts with exponential backoff
    // adds 100ms + 200ms = 300ms of delay between retries — long enough
    // for brief hiccups, short enough that the user's request doesn't
    // hang. Permanent failures (auth, sender-signature) still bubble up
    // to the caller after the last attempt.
    await withRetry(
      () => {
        // `transporter` is non-null inside this branch; capture it locally
        // so the closure doesn't have to re-narrow on every retry.
        const t = transporter!
        return t.sendMail({ from, to, subject, text, html })
      },
      { attempts: 3, initialDelayMs: 100, factor: 2, label: `email:${to}` },
    )
  },
}
