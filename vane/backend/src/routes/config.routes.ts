import { Router } from 'express'
import { prisma } from '../db'
import * as configService from '../services/configService'
import * as dockerService from '../services/dockerService'

export const configRouter = Router()

configRouter.get('/preview', async (_req, res) => {
  const generated = await configService.generateConfig()
  res.json({ content: generated.content, warnings: generated.warnings })
})

configRouter.post('/apply', async (req, res) => {
  const note = typeof req.body?.note === 'string' ? req.body.note : undefined
  try {
    const result = await configService.applyAndRestart(note)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to apply configuration.' })
  }
})

configRouter.post('/restart', async (_req, res) => {
  try {
    const count = await dockerService.restartAllManaged()
    res.json({ ok: true, restarted: count })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Restart failed.' })
  }
})

configRouter.get('/history', async (_req, res) => {
  const items = await prisma.configHistory.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  res.json(items)
})
