import fs from 'node:fs'
import { config } from './config'
import { createApp } from './app'
import { prisma } from './db'
import * as configService from './services/configService'
import * as dockerService from './services/dockerService'
import { getUpdateSchedule } from './services/scheduleService'

async function main(): Promise<void> {
  fs.mkdirSync(config.dataDir, { recursive: true })

  try {
    const result = await configService.importExistingIfNeeded()
    if (result.imported) console.log(`[init] ${result.detail}`)
  } catch (err) {
    console.warn('[init] Import skipped:', err instanceof Error ? err.message : err)
  }

  try {
    const enabledCount = await prisma.host.count({ where: { enabled: true } })
    if (enabledCount === 0) {
      const stopResult = await dockerService.stopAllManaged()
      if (stopResult.removed.length) console.log(`[init] ${stopResult.message}`)
    }
  } catch (err) {
    console.warn('[init] Could not check DDNS container state:', err instanceof Error ? err.message : err)
  }

  try {
    const schedule = await getUpdateSchedule()
    for (const warning of schedule.warnings) console.warn(`[init] ${warning}`)
    const from = { environment: ' (from DDNS_UPDATE_CRON)', setting: ' (from Settings)', default: '' }[schedule.source]
    console.log(`[init] Update schedule: ${schedule.effective ?? "favonia's default (every 5 minutes)"}${from}.`)
    const { recreated } = await configService.reconcileUpdateSchedule()
    for (const r of recreated) console.log(`[init] Update schedule changed: ${r.message}`)
  } catch (err) {
    console.warn('[init] Could not apply the update schedule:', err instanceof Error ? err.message : err)
  }

  const app = createApp()
  app.listen(config.port, () => {
    console.log(`[vane] listening on :${config.port}`)
  })
}

main().catch((err) => {
  console.error('Fatal startup error:', err)
  process.exit(1)
})
