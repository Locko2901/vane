import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db'

export const settingsRouter = Router()

const DEFAULTS: Record<string, string> = {
  containerName: 'cloudflare-ddns',
  refreshInterval: '300',
  theme: 'dark',
  deleteRecordsOnRemoval: 'false',
  syncProxyStatus: 'true',
}

settingsRouter.get('/', async (_req, res) => {
  const rows = await prisma.setting.findMany()
  const merged = { ...DEFAULTS }
  for (const r of rows) merged[r.key] = r.value
  res.json(merged)
})

settingsRouter.put('/', async (req, res) => {
  const schema = z.record(z.string(), z.string())
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid settings payload.' })
    return
  }
  for (const [key, value] of Object.entries(parsed.data)) {
    await prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    })
  }
  res.json({ ok: true })
})
