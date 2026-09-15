import { createServer, type AddressInfo, type Server } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Sends through the real nodemailer against a minimal local SMTP server, so a
// nodemailer upgrade that breaks createTransport or sendMail turns red here.
// Other tests mock ~~/server/lib/email entirely and cannot see that.

interface FakeSmtp {
  port: number
  lines: string[]
  close: () => Promise<void>
}

async function startFakeSmtp(): Promise<FakeSmtp> {
  const lines: string[] = []
  const server: Server = createServer((socket) => {
    let inData = false
    let buffer = ''
    socket.write('220 fake.test ESMTP\r\n')
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let end: number
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        lines.push(line)
        if (inData) {
          if (line === '.') {
            inData = false
            socket.write('250 2.0.0 queued\r\n')
          }
          continue
        }
        const command = line.slice(0, 4).toUpperCase()
        if (command === 'EHLO' || command === 'HELO') socket.write('250 fake.test\r\n')
        else if (['MAIL', 'RCPT', 'RSET', 'NOOP'].includes(command))
          socket.write('250 2.1.0 OK\r\n')
        else if (command === 'DATA') {
          inData = true
          socket.write('354 end with <CRLF>.<CRLF>\r\n')
        } else if (command === 'QUIT') {
          socket.write('221 bye\r\n')
          socket.end()
        } else socket.write('502 5.5.2 not implemented\r\n')
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: (server.address() as AddressInfo).port,
    lines,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

async function loadEmail() {
  vi.resetModules()
  return (await import('./email')).email
}

let smtp: FakeSmtp | undefined

beforeEach(() => {
  vi.stubEnv('EMAIL_FROM', 'Studio Test <sender@example.test>')
  vi.stubEnv('SMTP_SECURE', 'false')
  vi.stubEnv('SMTP_USER', '')
  vi.stubEnv('SMTP_PASSWORD', '')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await smtp?.close()
  smtp = undefined
})

describe('email.send through real nodemailer', () => {
  it('delivers envelope and message to the SMTP server', async () => {
    smtp = await startFakeSmtp()
    vi.stubEnv('SMTP_HOST', '127.0.0.1')
    vi.stubEnv('SMTP_PORT', String(smtp.port))
    const email = await loadEmail()

    await email.send({
      to: 'recipient@example.test',
      subject: 'Invitation to Grundtone Studio',
      text: 'Plain body line',
    })

    expect(smtp.lines).toContain('MAIL FROM:<sender@example.test>')
    expect(smtp.lines).toContain('RCPT TO:<recipient@example.test>')
    expect(smtp.lines).toContain('Subject: Invitation to Grundtone Studio')
    expect(smtp.lines).toContain('Plain body line')
  })

  it('logs instead of sending when SMTP_HOST is not set', async () => {
    vi.stubEnv('SMTP_HOST', '')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const email = await loadEmail()

    await expect(
      email.send({ to: 'dev@example.test', subject: 'Dev only', text: 'body' }),
    ).resolves.toBeUndefined()
    expect(info).toHaveBeenCalledWith(expect.stringContaining('to=dev@example.test'))
  })

  it('surfaces a delivery failure after the retries', async () => {
    const closed = await startFakeSmtp()
    const port = closed.port
    await closed.close()
    vi.stubEnv('SMTP_HOST', '127.0.0.1')
    vi.stubEnv('SMTP_PORT', String(port))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const email = await loadEmail()

    await expect(
      email.send({ to: 'recipient@example.test', subject: 'Unreachable', text: 'body' }),
    ).rejects.toThrow(/ECONNREFUSED|connect/i)
  })
})
