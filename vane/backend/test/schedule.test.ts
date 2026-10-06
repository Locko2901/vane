import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { overrideProperty, startTestServer, stubDocker, type StubContainer } from './helpers'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vane-backend-schedule-'))
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vane-backend-schedule-config-'))
process.env.DATA_DIR = dataDir
process.env.DDNS_CONFIG_DIR = configDir
process.env.DOCKER_SOCKET = path.join(dataDir, 'docker.sock')
delete process.env.DDNS_UPDATE_CRON

const modulesPromise = (async () => {
  const { prisma } = await import('../src/db')
  const { config } = await import('../src/config')
  const appModule = await import('../src/app')
  const configService = await import('../src/services/configService')
  const dockerService = await import('../src/services/dockerService')
  const scheduleService = await import('../src/services/scheduleService')
  const cryptoModule = await import('../src/crypto')
  return { prisma, config, appModule, configService, dockerService, scheduleService, cryptoModule }
})()

interface SetupOptions {
  settings?: Record<string, string>
  env?: string
  tokenIds?: number[]
}

async function setup(options: SetupOptions = {}) {
  const modules = await modulesPromise
  const { prisma, config, cryptoModule } = modules
  const settings = new Map(Object.entries({ syncProxyStatus: 'false', ...options.settings }))
  const history: string[] = []
  const hosts = (options.tokenIds ?? [11, 12]).map((id) => ({
    id, zone: 'example.com', hostname: `h${id}`, recordType: 'A', proxied: false, ttl: 1,
    description: null, enabled: true, tokenId: id,
    token: { id, name: `Token ${id}`, ciphertext: cryptoModule.encrypt(`token-${id}`) },
  }))
  interface Where { where: { key: string } }

  const restore = [
    overrideProperty(config, 'ddnsUpdateCron', options.env ?? ''),
    overrideProperty(prisma.host, 'findMany', (() => Promise.resolve(hosts)) as never),
    overrideProperty(prisma.srvRecord, 'findMany', (() => Promise.resolve([])) as never),
    overrideProperty(prisma.configHistory, 'create', (({ data }: { data: { content: string } }) => {
      history.push(data.content)
      return Promise.resolve(undefined)
    }) as never),
    overrideProperty(prisma.setting, 'findUnique', (({ where }: Where) => Promise.resolve(
      settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null,
    )) as never),
    overrideProperty(prisma.setting, 'findMany', (() => Promise.resolve(
      [...settings].map(([key, value]) => ({ key, value })),
    )) as never),
    overrideProperty(prisma.setting, 'upsert', (({ where, update }: Where & { update: { value: string } }) => {
      settings.set(where.key, update.value)
      return Promise.resolve(undefined)
    }) as never),
    overrideProperty(prisma.setting, 'deleteMany', (({ where }: Where) => {
      settings.delete(where.key)
      return Promise.resolve({ count: 1 })
    }) as never),
  ]
  return {
    ...modules,
    settings,
    history,
    restore: () => {
      for (const restoreOne of restore.reverse()) restoreOne()
    },
  }
}

interface ApiResponse {
  error?: string
  field?: string
  content?: string
  apply?: { ok: boolean; instances: number; message: string; warnings: string[] }
  [key: string]: unknown
}

async function api(baseUrl: string, method: string, pathname: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: await res.json() as ApiResponse }
}

void test('validateUpdateCron accepts @every minutes or hours and 5-field cron expressions', async () => {
  const { scheduleService } = await modulesPromise
  const accepted: Array<[string, string]> = [
    ['@every 1m', '@every 1m'],
    ['@every 2h', '@every 2h'],
    ['*/2 * * * *', '*/2 * * * *'],
    ['  @every   5m ', '@every 5m'],
    ['@every 01m', '@every 1m'],
    ['0 */6 * * MON-FRI', '0 */6 * * MON-FRI'],
    ['15,45 8-18 1 jan,jul ?', '15,45 8-18 1 jan,jul ?'],
    ['0 0 29 2 *', '0 0 29 2 *'],
  ]
  for (const [input, value] of accepted) {
    assert.deepEqual(scheduleService.validateUpdateCron(input), { ok: true, value }, input)
  }
})

void test('validateUpdateCron refuses anything favonia would not run every minute or more', async () => {
  const { scheduleService } = await modulesPromise
  const refused: Array<[string, RegExp]> = [
    ['@every 30s', /whole number of minutes or hours, at least 1 minute/],
    ['@once', /would stop favonia from updating/],
    ['@disabled', /would stop favonia from updating/],
    ['garbage', /"garbage" is not a schedule/],
    ['0 */2 * * * *', /has 5 fields .*; "0 \*\/2 \* \* \* \*" has 6/],
    ['@nevermore', /would stop favonia/],
    ['@every 0m', /shorter than the minimum of 1 minute/],
    ['@every 1h30m', /whole number of minutes or hours/],
    ['@hourly', /not supported/],
    ['61 * * * *', /minute field "61".*between 0 and 59/],
    ['*/0 * * * *', /step "0"/],
    ['5-1 * * * *', /runs backwards/],
    ['0 0 * * 7', /day-of-week field "7"/],
    ['0 0 30 2 *', /never runs/],
    ['0 0 31 4,6 *', /never runs/],
    ['', /empty/],
  ]
  for (const [input, error] of refused) {
    const check = scheduleService.validateUpdateCron(input)
    assert.equal(check.ok, false, input)
    assert.match((check as { error: string }).error, error, input)
  }
})

void test('generateConfig writes no UPDATE_CRON when no schedule is set', async () => {
  const env = await setup()
  try {
    const generated = await env.configService.generateConfig()
    assert.equal(generated.instances.length, 2)
    for (const inst of generated.instances) assert.equal('UPDATE_CRON' in inst.env, false)
    assert.doesNotMatch(generated.content, /UPDATE_CRON/)
    assert.deepEqual(generated.warnings, [])
  } finally {
    env.restore()
  }
})

void test('generateConfig gives every instance the saved schedule', async () => {
  const env = await setup({ settings: { updateCron: '@every 1m' } })
  try {
    const generated = await env.configService.generateConfig()
    assert.deepEqual(generated.instances.map((i) => i.env.UPDATE_CRON), ['@every 1m', '@every 1m'])
    assert.equal(generated.content.match(/^UPDATE_CRON=@every 1m$/gm)?.length, 2)
  } finally {
    env.restore()
  }
})

void test('DDNS_UPDATE_CRON wins over the setting and makes it read-only', async () => {
  const env = await setup({ env: '*/2 * * * *', settings: { updateCron: '@every 1m' } })
  try {
    const generated = await env.configService.generateConfig()
    assert.deepEqual(generated.instances.map((i) => i.env.UPDATE_CRON), ['*/2 * * * *', '*/2 * * * *'])
    const schedule = await env.scheduleService.getUpdateSchedule()
    assert.equal(schedule.source, 'environment')
    assert.equal(schedule.readOnly, true)
    assert.deepEqual(schedule.warnings, [])
  } finally {
    env.restore()
  }
})

void test('an invalid DDNS_UPDATE_CRON is ignored with a warning and never reaches favonia', async () => {
  const withSetting = await setup({ env: '@every 30s', settings: { updateCron: '@every 1m' } })
  try {
    const generated = await withSetting.configService.generateConfig()
    assert.deepEqual(generated.instances.map((i) => i.env.UPDATE_CRON), ['@every 1m', '@every 1m'])
    assert.match(generated.warnings[0], /^DDNS_UPDATE_CRON is ignored: "@every 30s"/)
    const schedule = await withSetting.scheduleService.getUpdateSchedule()
    assert.equal(schedule.source, 'setting')
    assert.equal(schedule.readOnly, false)
  } finally {
    withSetting.restore()
  }

  const alone = await setup({ env: '@once' })
  try {
    const generated = await alone.configService.generateConfig()
    for (const inst of generated.instances) assert.equal('UPDATE_CRON' in inst.env, false)
    assert.doesNotMatch(generated.content, /UPDATE_CRON/)
    assert.equal((await alone.scheduleService.getUpdateSchedule()).source, 'default')
  } finally {
    alone.restore()
  }
})

void test('PUT /api/settings refuses an invalid schedule with 422 and saves nothing', async () => {
  const env = await setup()
  const created: Array<{ name: string; env: string[] }> = []
  const restoreDocker = stubDocker([], created)
  const { baseUrl, close } = await startTestServer(env.appModule.createApp())
  try {
    for (const updateCron of ['garbage', '@every 30s', '@once', '0 0 * * * *']) {
      const res = await api(baseUrl, 'PUT', '/api/settings', { theme: 'light', updateCron })
      assert.equal(res.status, 422, updateCron)
      assert.equal(res.json.field, 'updateCron')
      assert.match(res.json.error ?? '', /^".+"|has 5 fields/)
    }
    assert.equal(env.settings.has('theme'), false)
    assert.equal(env.settings.has('updateCron'), false)
    assert.deepEqual(created, [])
  } finally {
    await close()
    restoreDocker()
    env.restore()
  }
})

void test('PUT /api/settings refuses the schedule while DDNS_UPDATE_CRON is set', async () => {
  const env = await setup({ env: '@every 1m' })
  const created: Array<{ name: string; env: string[] }> = []
  const restoreDocker = stubDocker([], created)
  const { baseUrl, close } = await startTestServer(env.appModule.createApp())
  try {
    const status = await api(baseUrl, 'GET', '/api/settings/update-schedule')
    assert.deepEqual(status.json, {
      effective: '@every 1m',
      source: 'environment',
      setting: null,
      environment: '@every 1m',
      readOnly: true,
      warnings: [],
    })

    const refused = await api(baseUrl, 'PUT', '/api/settings', { updateCron: '@every 2m' })
    assert.equal(refused.status, 409)
    assert.match(refused.json.error ?? '', /set by the container's environment \(DDNS_UPDATE_CRON\)/)
    assert.equal(env.settings.has('updateCron'), false)

    const others = await api(baseUrl, 'PUT', '/api/settings', { theme: 'light' })
    assert.deepEqual(others, { status: 200, json: { ok: true } })
    assert.equal(env.settings.get('theme'), 'light')
    assert.deepEqual(created, [])
  } finally {
    await close()
    restoreDocker()
    env.restore()
  }
})

void test('saving a new schedule recreates the instances, and an unchanged one does not', async () => {
  const env = await setup()
  const created: Array<{ name: string; env: string[] }> = []
  const restoreDocker = stubDocker([], created)
  const { baseUrl, close } = await startTestServer(env.appModule.createApp())
  try {
    const saved = await api(baseUrl, 'PUT', '/api/settings', { updateCron: ' @every  1m ' })
    assert.equal(saved.status, 200)
    assert.equal(saved.json.apply?.ok, true)
    assert.equal(saved.json.apply?.instances, 2)
    assert.equal(env.settings.get('updateCron'), '@every 1m')
    assert.deepEqual(created.map((c) => c.name), ['cloudflare-ddns-t11', 'cloudflare-ddns-t12'])
    for (const c of created) assert.ok(c.env.includes('UPDATE_CRON=@every 1m'))
    assert.match(fs.readFileSync(path.join(configDir, 'ddns.env'), 'utf8'), /^UPDATE_CRON=@every 1m$/m)

    const preview = await api(baseUrl, 'GET', '/api/config/preview')
    assert.match(preview.json.content ?? '', /^UPDATE_CRON=@every 1m$/m)

    const again = await api(baseUrl, 'PUT', '/api/settings', { updateCron: '@every 1m', theme: 'dark' })
    assert.deepEqual(again, { status: 200, json: { ok: true } })
    assert.equal(created.length, 2)

    const cleared = await api(baseUrl, 'PUT', '/api/settings', { updateCron: '' })
    assert.equal(cleared.json.apply?.ok, true)
    assert.equal(env.settings.has('updateCron'), false)
    assert.equal(created.length, 4)
    for (const c of created.slice(2)) assert.ok(!c.env.some((e) => e.startsWith('UPDATE_CRON=')))
  } finally {
    await close()
    restoreDocker()
    env.restore()
  }
})

void test('start-up recreates only the instances whose UPDATE_CRON differs', async () => {
  const env = await setup({ settings: { updateCron: '@every 1m' }, tokenIds: [11, 12, 13] })
  const name = env.dockerService.containerNameForToken
  const containers: StubContainer[] = [
    { name: name(11), state: 'running', status: 'Up', env: ['CLOUDFLARE_API_TOKEN=token-11', 'UPDATE_CRON=@every 1m'] },
    { name: name(12), state: 'running', status: 'Up', env: ['CLOUDFLARE_API_TOKEN=token-12'] },
  ]
  const created: Array<{ name: string; env: string[] }> = []
  const restoreDocker = stubDocker(containers, created)
  try {
    const { recreated } = await env.configService.reconcileUpdateSchedule()
    assert.deepEqual(recreated.map((r) => [r.name, r.recreated]), [[name(12), true]])
    assert.deepEqual(created.map((c) => c.name), [name(12)])
    assert.ok(created[0].env.includes('UPDATE_CRON=@every 1m'))
    assert.equal(env.history.length, 1)
  } finally {
    restoreDocker()
    env.restore()
  }
})

void test('start-up leaves matching instances alone and drops a schedule that was cleared', async () => {
  const matching = await setup({ settings: { updateCron: '*/2 * * * *' } })
  const name = matching.dockerService.containerNameForToken
  const created: Array<{ name: string; env: string[] }> = []
  let restoreDocker = stubDocker([11, 12].map((id) => ({
    name: name(id), state: 'running', status: 'Up', env: [`CLOUDFLARE_API_TOKEN=token-${id}`, 'UPDATE_CRON=*/2 * * * *'],
  })), created)
  try {
    assert.deepEqual((await matching.configService.reconcileUpdateSchedule()).recreated, [])
    assert.equal(created.length, 0)
    assert.equal(matching.history.length, 0)
  } finally {
    restoreDocker()
    matching.restore()
  }

  const cleared = await setup({ tokenIds: [11] })
  restoreDocker = stubDocker([{
    name: name(11), state: 'running', status: 'Up', env: ['CLOUDFLARE_API_TOKEN=token-11', 'UPDATE_CRON=@every 1m'],
  }], created)
  try {
    const { recreated } = await cleared.configService.reconcileUpdateSchedule()
    assert.deepEqual(recreated.map((r) => r.name), [name(11)])
    assert.ok(!created[0].env.some((e) => e.startsWith('UPDATE_CRON=')))
  } finally {
    restoreDocker()
    cleared.restore()
  }
})
