import { Router } from 'express'
import { getHealth } from '../services/healthService'

export const dashboardRouter = Router()

dashboardRouter.get('/', async (_req, res) => {
  try {
    res.json(await getHealth())
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to build health report.' })
  }
})
