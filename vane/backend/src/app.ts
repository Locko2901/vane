import path from 'node:path'
import fs from 'node:fs'
import express from 'express'
import helmet from 'helmet'
import { tokensRouter } from './routes/tokens.routes'
import { hostsRouter } from './routes/hosts.routes'
import { dashboardRouter } from './routes/dashboard.routes'
import { logsRouter } from './routes/logs.routes'
import { settingsRouter } from './routes/settings.routes'
import { configRouter } from './routes/config.routes'
import { backupRouter } from './routes/backup.routes'

export function createApp(): express.Express {
  const app = express()

  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  )
  app.use(express.json({ limit: '2mb' }))

  app.use('/api/tokens', tokensRouter)
  app.use('/api/hosts', hostsRouter)
  app.use('/api/dashboard', dashboardRouter)
  app.use('/api/logs', logsRouter)
  app.use('/api/settings', settingsRouter)
  app.use('/api/config', configRouter)
  app.use('/api/backup', backupRouter)

  app.get('/api/health', (_req, res) => res.json({ ok: true }))

  const staticDir = path.resolve(__dirname, '../public')
  if (fs.existsSync(staticDir)) {
    app.use(express.static(staticDir))
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next()
      res.sendFile(path.join(staticDir, 'index.html'))
    })
  }

  return app
}
