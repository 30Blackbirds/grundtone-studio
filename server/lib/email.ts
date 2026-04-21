import nodemailer, { type Transporter } from 'nodemailer'

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

    await transporter.sendMail({ from, to, subject, text, html })
  },
}
