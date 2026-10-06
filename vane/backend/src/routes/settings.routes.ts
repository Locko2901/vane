import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db'
import * as configService from '../services/configService'
import { getUpdateSchedule, UPDATE_CRON_ENV, UPDATE_CRON_KEY, validateUpdateCron } from '../services/scheduleService'

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

settingsRouter.get('/update-schedule', async (_req, res) => {
  res.json(await getUpdateSchedule())
})

settingsRouter.put('/', async (req, res) => {
  const schema = z.record(z.string(), z.string())
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid settings payload.' })
    return
  }
  const updates = parsed.data

  const scheduleSent = Object.prototype.hasOwnProperty.call(updates, UPDATE_CRON_KEY)
  let scheduleBefore: string | null = null
  if (scheduleSent) {
    const schedule = await getUpdateSchedule()
    if (schedule.readOnly) {
      res.status(409).json({
        error: `The update schedule is set by the container's environment (${UPDATE_CRON_ENV}) and can't be changed here.`,
        field: UPDATE_CRON_KEY,
      })
      return
    }
    const raw = updates[UPDATE_CRON_KEY].trim()
    if (raw !== '') {
      const check = validateUpdateCron(raw)
      if (!check.ok) {
        res.status(422).json({ error: check.error, field: UPDATE_CRON_KEY })
        return
      }
      updates[UPDATE_CRON_KEY] = check.value
    } else {
      updates[UPDATE_CRON_KEY] = ''
    }
    scheduleBefore = schedule.effective
  }

  for (const [key, value] of Object.entries(updates)) {
    if (key === UPDATE_CRON_KEY && value === '') {
      await prisma.setting.deleteMany({ where: { key } })
      continue
    }
    await prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    })
  }

  if (!scheduleSent || (await getUpdateSchedule()).effective === scheduleBefore) {
    res.json({ ok: true })
    return
  }

  try {
    const result = await configService.applyAndRestart('Update schedule changed')
    res.json({
      ok: true,
      apply: {
        ok: result.instances.length === 0 || result.recreated,
        instances: result.instances.length,
        message: result.message,
        warnings: result.warnings,
      },
    })
  } catch (err) {
    res.json({
      ok: true,
      apply: {
        ok: false,
        instances: 0,
        message: `Saved, but applying the new schedule failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        warnings: [],
      },
    })
  }
})
