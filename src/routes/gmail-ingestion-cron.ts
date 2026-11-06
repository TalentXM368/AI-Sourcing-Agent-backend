import { timingSafeEqual } from 'crypto'
import { Router, Request, Response } from 'express'
import { pollEnabledGmailInboxes } from '../services/gmail-resume-ingestion.js'

export const gmailIngestionCronRouter = Router()

gmailIngestionCronRouter.get('/', async (req: Request, res: Response) => {
  const cronSecret = process.env.CRON_SECRET
  const authorization = req.header('authorization') || ''
  const expected = cronSecret ? `Bearer ${cronSecret}` : ''
  const suppliedBuffer = Buffer.from(authorization)
  const expectedBuffer = Buffer.from(expected)

  if (!cronSecret || suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    res.json(await pollEnabledGmailInboxes())
  } catch (error) {
    console.error('[Gmail Resume Ingestion] Scheduled polling failed:', error)
    res.status(500).json({ error: 'Scheduled Gmail inbox polling failed' })
  }
})
