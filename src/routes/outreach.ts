import { Router, Request, Response } from 'express'
import { z } from 'zod'
import nodemailer from 'nodemailer'
import { db } from '../db/index.js'
import { getEmailConnection } from '../services/email-settings.js'

export const outreachRouter = Router()

const SendEmailSchema = z.object({
  candidate_id: z.string().uuid(),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(50_000),
})

outreachRouter.post('/send', async (req: Request, res: Response) => {
  try {
    const input = SendEmailSchema.parse(req.body)
    const connection = await getEmailConnection(req.auth!.organizationId)
    if (!connection) {
      return res.status(400).json({ error: 'Configure an email connection in Settings before sending messages.' })
    }

    const candidate = await db.selectFrom('candidates')
      .select(['id', 'name', 'email'])
      .where('id', '=', input.candidate_id)
      .where('created_by_id', '=', req.auth!.id)
      .executeTakeFirst()

    if (!candidate) return res.status(404).json({ error: 'Candidate not found' })
    if (!candidate.email) return res.status(400).json({ error: 'Candidate does not have an email address' })

    const transporter = nodemailer.createTransport({
      host: connection.host,
      port: connection.port,
      secure: connection.port === 465,
      auth: { user: connection.username, pass: connection.password },
    })

    const from = connection.fromName
      ? `${connection.fromName} <${connection.fromEmail}>`
      : connection.fromEmail

    const info = await transporter.sendMail({
      from,
      to: candidate.email,
      replyTo: connection.fromEmail,
      subject: input.subject,
      text: input.body,
    })

    res.json({ message: 'Email sent', message_id: info.messageId, recipient: candidate.email })
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid email request', details: error.errors })
    console.error('[Outreach] Email send failed:', error)
    res.status(502).json({ error: 'Email could not be sent. Check the SMTP connection in Settings.' })
  }
})
