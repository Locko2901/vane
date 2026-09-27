import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { overrideProperty, startTestServer, stubDocker } from './helpers'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vane-backend-srv-'))
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vane-backend-srv-config-'))
process.env.DATA_DIR = dataDir
process.env.DDNS_CONFIG_DIR = configDir
process.env.DOCKER_SOCKET = path.join(dataDir, 'docker.sock')

const modulesPromise = (async () => {
  const appModule = await import('../src/app')
  const { prisma } = await import('../src/db')
  const configService = await import('../src/services/configService')
  const srvService = await import('../src/services/srvService')
  const healthService = await import('../src/services/healthService')
  const cryptoModule = await import('../src/crypto')
  const backupCrypto = await import('../src/backupCrypto')
  return { appModule, prisma, configService, srvService, healthService, cryptoModule, backupCrypto }
})()

const NAME = '_minecraft._tcp.skyblock.lockoo.dev'
const ZONE_ID = 'zone-lockoo.dev'

interface Row {
  id: number
  zone: string
  hostname: string
  service: string
  proto: string
  priority: number
  weight: number
  port: number
  target: string
  ttl: number
  description: string | null
  enabled: boolean
  tokenId: number
  cfRecordId: string | null
  syncState: string
  lastError: string | null
  lastSyncedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

interface Token {
  id: number
  name: string
  ciphertext: string
}

function srvRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 12,
    zone: 'lockoo.dev',
    hostname: 'skyblock',
    service: 'minecraft',
    proto: 'tcp',
    priority: 0,
    weight: 0,
    port: 25566,
    target: 'skyblock.lockoo.dev',
    ttl: 1,
    description: null,
    enabled: true,
    tokenId: 4,
    cfRecordId: null,
    syncState: 'pending',
    lastError: null,
    lastSyncedAt: null,
    createdAt: new Date('2026-09-27T10:00:00.000Z'),
    updatedAt: new Date('2026-09-27T10:00:00.000Z'),
    ...overrides,
  }
}

type Where = Partial<Record<keyof Row, unknown>>
type OrderBy = Partial<Record<keyof Row, 'asc' | 'desc'>>

function fakeTable(
  prisma: Awaited<typeof modulesPromise>['prisma'],
  seed: Row[],
  tokens: Token[],
  settings: Record<string, string>,
) {
  const rows = seed.map((r) => ({ ...r }))
  let nextId = Math.max(0, ...rows.map((r) => r.id)) + 1
  const matches = (r: Row, where: Where = {}) => Object.entries(where).every(([k, v]) => r[k as keyof Row] === v)
  const shape = (r: Row, include?: { token?: boolean }) =>
    include?.token ? { ...r, token: tokens.find((t) => t.id === r.tokenId) } : { ...r }
  const byId = (id: unknown) => rows.find((r) => r.id === id)
  const sortBy = (orderBy: OrderBy | OrderBy[] = { id: 'asc' }) => (a: Row, b: Row) => {
    for (const o of [orderBy].flat()) {
      const [key, dir] = Object.entries(o)[0] as [keyof Row, 'asc' | 'desc']
      const cmp = String(a[key]).localeCompare(String(b[key]))
      if (cmp) return dir === 'asc' ? cmp : -cmp
    }
    return 0
  }
  const uniqueClash = (candidate: Row) => rows.some((r) =>
    r.id !== candidate.id && r.zone === candidate.zone && r.hostname === candidate.hostname
    && r.service === candidate.service && r.proto === candidate.proto)
  const p2002 = () => Promise.reject(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }))

  const restore = [
    overrideProperty(prisma.srvRecord, 'findMany', ((args: { where?: Where; include?: { token?: boolean }; orderBy?: OrderBy | OrderBy[] } = {}) =>
      Promise.resolve(rows.filter((r) => matches(r, args.where)).sort(sortBy(args.orderBy)).map((r) => shape(r, args.include)))) as never),
    overrideProperty(prisma.srvRecord, 'findUnique', (({ where, include }: { where: { id: number }; include?: { token?: boolean } }) => {
      const row = byId(where.id)
      return Promise.resolve(row ? shape(row, include) : null)
    }) as never),
    overrideProperty(prisma.srvRecord, 'create', (({ data }: { data: Partial<Row> }) => {
      const row = srvRow({ description: null, cfRecordId: null, syncState: 'pending', ...data, id: nextId })
      if (uniqueClash(row)) return p2002()
      nextId += 1
      rows.push(row)
      return Promise.resolve({ ...row })
    }) as never),
    overrideProperty(prisma.srvRecord, 'update', (({ where, data }: { where: { id: number }; data: Partial<Row> }) => {
      const row = byId(where.id)
      if (!row) return Promise.reject(Object.assign(new Error('Record to update not found.'), { code: 'P2025' }))
      if (uniqueClash({ ...row, ...data })) return p2002()
      Object.assign(row, data)
      return Promise.resolve({ ...row })
    }) as never),
    overrideProperty(prisma.srvRecord, 'updateMany', (({ where, data }: { where: Where; data: Partial<Row> }) => {
      const hit = rows.filter((r) => matches(r, where))
      for (const r of hit) Object.assign(r, data)
      return Promise.resolve({ count: hit.length })
    }) as never),
    overrideProperty(prisma.srvRecord, 'delete', (({ where }: { where: { id: number } }) => {
      const idx = rows.findIndex((r) => r.id === where.id)
      return Promise.resolve(idx >= 0 ? rows.splice(idx, 1)[0] : null)
    }) as never),
    overrideProperty(prisma.apiToken, 'findUnique', (({ where }: { where: { id: number } }) =>
      Promise.resolve(tokens.find((t) => t.id === where.id) ?? null)) as never),
    overrideProperty(prisma.setting, 'findUnique', (({ where }: { where: { key: string } }) =>
      Promise.resolve(where.key in settings ? { key: where.key, value: settings[where.key] } : null)) as never),
  ]
  return { rows, byId, restore }
}

interface FakeRecord {
  id: string
  zoneId: string
  type: string
  name: string
  ttl: number
  proxied: boolean
  content: string
  data?: { priority: number; weight: number; port: number; target: string }
  comment?: string
}

interface Call {
  method: string
  url: URL
  body: Record<string, unknown> | undefined
}

type FailMode = 'network' | 'auth' | 'rateLimit' | 'serverError' | 'notJson'

function cfSrv(overrides: Partial<Omit<FakeRecord, 'data'>> & { data?: Partial<NonNullable<FakeRecord['data']>> } = {}): FakeRecord {
  const data = { priority: 0, weight: 0, port: 25566, target: 'skyblock.lockoo.dev', ...overrides.data }
  return {
    id: 'cf-1',
    zoneId: ZONE_ID,
    type: 'SRV',
    name: NAME,
    ttl: 1,
    proxied: false,
    ...overrides,
    data,
    content: `${data.weight} ${data.port} ${data.target}`,
  }
}

const FAILURES: Record<FailMode, () => Promise<Response>> = {
  network: () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })),
  auth: () => reply(403, { success: false, errors: [{ code: 10000, message: 'Authentication error' }], result: null }),
  rateLimit: () => reply(429, { success: false, errors: [{ code: 971, message: 'Please wait and consider throttling your request speed' }], result: null }),
  serverError: () => reply(500, { success: false, errors: [{ code: 10001, message: 'Internal error' }], result: null }),
  notJson: () => Promise.resolve({ status: 502, json: () => Promise.reject(new SyntaxError('Unexpected token <')) } as unknown as Response),
}

function reply(status: number, payload: unknown): Promise<Response> {
  return Promise.resolve({ status, json: () => Promise.resolve(payload), text: () => Promise.resolve('') } as unknown as Response)
}

function fakeCloudflare(opts: { zones?: string[]; records?: FakeRecord[]; fail?: (call: Call) => FailMode | null } = {}) {
  const zones = opts.zones ?? ['lockoo.dev']
  const records = (opts.records ?? []).map((r) => ({ ...r }))
  const calls: Call[] = []
  let seq = 0
  const ok = (result: unknown, extra: object = {}) => reply(200, { success: true, errors: [], result, ...extra })
  const withContent = (r: FakeRecord) => (r.data ? { ...r, content: `${r.data.weight} ${r.data.port} ${r.data.target}` } : r)

  const restore = overrideProperty(globalThis, 'fetch', ((input: string, init?: RequestInit) => {
    const url = new URL(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body as string) as Record<string, unknown> : undefined
    const call = { method, url, body }
    calls.push(call)
    const failure = opts.fail?.(call)
    if (failure) return FAILURES[failure]()

    if (url.pathname.endsWith('/cdn-cgi/trace')) {
      return Promise.resolve({ text: () => Promise.resolve('fl=1\nip=203.0.113.10\n') } as Response)
    }
    if (url.pathname.endsWith('/user/tokens/verify')) return ok({ id: 'tok', status: 'active' })
    if (url.pathname.endsWith('/zones')) {
      const name = url.searchParams.get('name')
      return ok(name && zones.includes(name) ? [{ id: `zone-${name}`, name, status: 'active' }] : [])
    }

    const [, zoneId, , recordId] = url.pathname.replace('/client/v4/', '').split('/')
    if (!recordId && method === 'GET') {
      const type = url.searchParams.get('type')
      const name = url.searchParams.get('name')
      const result = records.filter((r) => r.zoneId === zoneId && (!type || r.type === type) && (!name || r.name === name))
      return ok(result, { result_info: { page: 1, total_pages: 1 } })
    }
    if (!recordId && method === 'POST') {
      seq += 1
      const created = withContent({ id: `cf-new-${seq}`, zoneId, proxied: false, ...body } as unknown as FakeRecord)
      records.push(created)
      return ok(created)
    }
    const idx = records.findIndex((r) => r.id === recordId && r.zoneId === zoneId)
    if (idx < 0) return reply(404, { success: false, errors: [{ code: 81044, message: 'Record does not exist.' }], result: null })
    if (method === 'GET') return ok(records[idx])
    if (method === 'PATCH') {
      const { data, ...rest } = body ?? {}
      records[idx] = withContent({ ...records[idx], ...rest, data: { ...records[idx].data!, ...(data as object) } })
      return ok(records[idx])
    }
    if (method === 'DELETE') {
      records.splice(idx, 1)
      return ok({ id: recordId })
    }
    throw new Error(`Unexpected ${method} ${input}`)
  }) as typeof fetch)

  return {
    calls,
    records,
    restore,
    writes: () => calls.filter((c) => c.method !== 'GET'),
    creates: () => calls.filter((c) => c.method === 'POST'),
  }
}

async function setup(opts: {
  rows?: Row[]
  records?: FakeRecord[]
  zones?: string[]
  deleteOnRemoval?: boolean
  fail?: (call: Call) => FailMode | null
} = {}) {
  const { prisma, cryptoModule } = await modulesPromise
  const tokens: Token[] = [
    { id: 4, name: 'lockoo.dev', ciphertext: cryptoModule.encrypt('cf-token-4') },
    { id: 5, name: 'work', ciphertext: cryptoModule.encrypt('cf-token-5') },
  ]
  const db = fakeTable(prisma, opts.rows ?? [], tokens, opts.deleteOnRemoval ? { deleteRecordsOnRemoval: 'true' } : {})
  const cf = fakeCloudflare({ zones: opts.zones, records: opts.records, fail: opts.fail })
  return {
    db,
    cf,
    tokens,
    restore: () => {
      cf.restore()
      for (const restoreOne of db.restore.reverse()) restoreOne()
    },
  }
}

async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const { appModule } = await modulesPromise
  const { baseUrl, close } = await startTestServer(appModule.createApp())
  try {
    return await fn(baseUrl)
  } finally {
    await close()
  }
}

const realFetch = globalThis.fetch

async function api(baseUrl: string, method: string, pathname: string, body?: unknown) {
  const res = await realFetch(`${baseUrl}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}

function assertErrorBody(res: { status: number; json: unknown }, status: number, label: string) {
  assert.equal(res.status, status, `${label}: status`)
  assert.deepEqual(Object.keys(res.json as object), ['error'], `${label}: body keys`)
  assert.equal(typeof (res.json as { error: unknown }).error, 'string', `${label}: error is a string`)
}

const validPayload = {
  zone: 'lockoo.dev',
  hostname: 'skyblock',
  service: 'minecraft',
  proto: 'tcp',
  port: 25566,
  target: 'skyblock.lockoo.dev',
  tokenId: 4,
}

void test('POST /api/srv normalizes the payload and GET returns the contract row', async () => {
  const env = await setup({ rows: [srvRow({ id: 3, zone: 'lockoo.dev', hostname: 'lobby', cfRecordId: 'cf-9', syncState: 'ok', lastSyncedAt: new Date('2026-09-27T12:00:00.000Z') })] })
  try {
    await withServer(async (baseUrl) => {
      const description = '[vanander] 17d9...@10.10.10.39 '.padEnd(500, 'x')
      assert.equal(description.length, 500)
      const created = await api(baseUrl, 'POST', '/api/srv', {
        ...validPayload,
        service: '_Minecraft',
        proto: '_TCP',
        target: 'SkyBlock.Lockoo.Dev.',
        description,
      })
      assert.equal(created.status, 200)
      assert.deepEqual(created.json, { id: 4 })

      const apex = await api(baseUrl, 'POST', '/api/srv', { ...validPayload, hostname: '', proto: 'udp', priority: 5, weight: 10, ttl: 300, enabled: false })
      assert.deepEqual(apex.json, { id: 5 })
      assert.equal(env.db.byId(5)!.hostname, '@')

      const list = await api(baseUrl, 'GET', '/api/srv')
      assert.equal(list.status, 200)
      assert.deepEqual(list.json, [
        {
          id: 5,
          zone: 'lockoo.dev',
          hostname: '@',
          fqdn: '_minecraft._udp.lockoo.dev',
          service: 'minecraft',
          proto: 'udp',
          priority: 5,
          weight: 10,
          port: 25566,
          target: 'skyblock.lockoo.dev',
          ttl: 300,
          description: null,
          enabled: false,
          tokenId: 4,
          tokenName: 'lockoo.dev',
          cfRecordId: null,
          syncState: 'pending',
          lastError: null,
          lastSyncedAt: null,
        },
        {
          id: 3,
          zone: 'lockoo.dev',
          hostname: 'lobby',
          fqdn: '_minecraft._tcp.lobby.lockoo.dev',
          service: 'minecraft',
          proto: 'tcp',
          priority: 0,
          weight: 0,
          port: 25566,
          target: 'skyblock.lockoo.dev',
          ttl: 1,
          description: null,
          enabled: true,
          tokenId: 4,
          tokenName: 'lockoo.dev',
          cfRecordId: 'cf-9',
          syncState: 'ok',
          lastError: null,
          lastSyncedAt: '2026-09-27T12:00:00.000Z',
        },
        {
          id: 4,
          zone: 'lockoo.dev',
          hostname: 'skyblock',
          fqdn: NAME,
          service: 'minecraft',
          proto: 'tcp',
          priority: 0,
          weight: 0,
          port: 25566,
          target: 'skyblock.lockoo.dev',
          ttl: 1,
          description,
          enabled: true,
          tokenId: 4,
          tokenName: 'lockoo.dev',
          cfRecordId: null,
          syncState: 'pending',
          lastError: null,
          lastSyncedAt: null,
        },
      ])
      assert.equal(env.cf.calls.length, 0, 'CRUD never talks to Cloudflare')
    })
  } finally {
    env.restore()
  }
})

void test('POST /api/srv rejects invalid payloads with 400', async () => {
  const env = await setup()
  const cases: Array<[string, Record<string, unknown>]> = [
    ['underscore inside service', { service: 'mine_craft' }],
    ['service starting with -', { service: '-mc' }],
    ['service ending with -', { service: 'mc-' }],
    ['16 character service', { service: 'abcdefghijklmnop' }],
    ['empty service', { service: '' }],
    ['two leading underscores', { service: '__minecraft' }],
    ['unknown proto', { proto: 'sctp' }],
    ['port 0', { port: 0 }],
    ['port 65536', { port: 65536 }],
    ['fractional port', { port: 25565.5 }],
    ['port as a string', { port: '25565' }],
    ['negative priority', { priority: -1 }],
    ['priority 65536', { priority: 65536 }],
    ['weight 70000', { weight: 70000 }],
    ['ttl 0', { ttl: 0 }],
    ['ttl 86401', { ttl: 86401 }],
    ['target with spaces', { target: 'not a host' }],
    ['single label target', { target: 'skyblock' }],
    ['empty zone', { zone: '' }],
    ['hostname with spaces', { hostname: 'sky block' }],
    ['501 character description', { description: 'x'.repeat(501) }],
    ['missing port', { port: undefined }],
    ['missing proto', { proto: undefined }],
    ['missing tokenId', { tokenId: undefined }],
  ]
  try {
    await withServer(async (baseUrl) => {
      for (const [label, patch] of cases) {
        assertErrorBody(await api(baseUrl, 'POST', '/api/srv', { ...validPayload, ...patch }), 400, label)
      }
      const unknownToken = await api(baseUrl, 'POST', '/api/srv', { ...validPayload, tokenId: 99 })
      assertErrorBody(unknownToken, 400, 'unknown tokenId')
      assert.equal(unknownToken.json.error, 'Selected API token does not exist.')

      for (const service of ['a', 'abcdefghijklmno', 'x-mc-1']) {
        const ok = await api(baseUrl, 'POST', '/api/srv', { ...validPayload, hostname: service, service })
        assert.equal(ok.status, 200, `service "${service}" is valid`)
      }
      assert.equal(env.db.rows.length, 3)
    })
  } finally {
    env.restore()
  }
})

void test('duplicates get 409 and missing rows get 404', async () => {
  const env = await setup({
    rows: [
      srvRow({ id: 1, hostname: 'skyblock' }),
      srvRow({ id: 2, hostname: 'lobby' }),
    ],
  })
  try {
    await withServer(async (baseUrl) => {
      assertErrorBody(await api(baseUrl, 'POST', '/api/srv', validPayload), 409, 'exact duplicate')
      assertErrorBody(await api(baseUrl, 'POST', '/api/srv', { ...validPayload, service: '_Minecraft', proto: '_TCP' }), 409, 'duplicate after normalizing')
      assertErrorBody(await api(baseUrl, 'POST', '/api/srv', { ...validPayload, hostname: 'SkyBlock' }), 409, 'duplicate name in another case')

      const missing = await api(baseUrl, 'PUT', '/api/srv/999', { port: 25570 })
      assertErrorBody(missing, 404, 'PUT on a missing row')
      assertErrorBody(await api(baseUrl, 'PUT', '/api/srv/abc', { port: 25570 }), 404, 'PUT on a non-numeric id')

      const clash = await api(baseUrl, 'PUT', '/api/srv/2', { hostname: 'skyblock' })
      assertErrorBody(clash, 409, 'PUT onto another row')
      assert.equal(env.db.byId(2)!.hostname, 'lobby')

      assertErrorBody(await api(baseUrl, 'PUT', '/api/srv/2', { port: 70000 }), 400, 'PUT with an invalid port')
      assertErrorBody(await api(baseUrl, 'PUT', '/api/srv/2', { tokenId: 99 }), 400, 'PUT with an unknown token')

      assert.deepEqual(await api(baseUrl, 'DELETE', '/api/srv/999'), { status: 200, json: { ok: true } })
      assertErrorBody(await api(baseUrl, 'POST', '/api/srv/999/toggle'), 404, 'toggle on a missing row')
    })
  } finally {
    env.restore()
  }
})

void test('POST /api/srv answers 409 when the unique index catches a race', async () => {
  const { prisma } = await modulesPromise
  const env = await setup()
  const restoreCreate = overrideProperty(prisma.srvRecord, 'create', (() =>
    Promise.reject(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }))) as never)
  try {
    await withServer(async (baseUrl) => {
      assertErrorBody(await api(baseUrl, 'POST', '/api/srv', validPayload), 409, 'P2002 from the database')
    })
  } finally {
    restoreCreate()
    env.restore()
  }
})

void test('PUT /api/srv/:id marks the row pending only when a record field changes', async () => {
  const synced = { cfRecordId: 'cf-1', syncState: 'ok', lastError: null }
  const env = await setup({ rows: [srvRow({ id: 1, ...synced })] })
  const row = () => env.db.byId(1)!
  try {
    await withServer(async (baseUrl) => {
      const put = (body: object) => api(baseUrl, 'PUT', '/api/srv/1', body)

      assert.deepEqual(await put({ description: '[vanander] owned' }), { status: 200, json: { ok: true } })
      assert.equal(row().syncState, 'ok')
      assert.equal(row().description, '[vanander] owned')

      assert.deepEqual(await put({ port: 25566, service: '_MINECRAFT', proto: 'TCP', target: 'skyblock.lockoo.dev.' }), { status: 200, json: { ok: true } })
      assert.equal(row().syncState, 'ok', 'values equal after normalizing are not a change')

      await put({ syncState: 'ok', cfRecordId: 'forged', lastError: 'forged' })
      assert.equal(row().cfRecordId, 'cf-1', 'sync fields cannot be written through the API')

      await put({ port: 25567 })
      assert.equal(row().syncState, 'pending')
      assert.equal(row().port, 25567)
      assert.equal(row().cfRecordId, 'cf-1', 'the tracked record is kept so sync updates it in place')

      for (const [field, value] of [['hostname', 'lobby'], ['ttl', 300], ['tokenId', 5], ['weight', 3]] as const) {
        Object.assign(row(), synced)
        await put({ [field]: value })
        assert.equal(row().syncState, 'pending', `changing ${field} marks the row pending`)
      }
      assert.equal(env.cf.calls.length, 0)
    })
  } finally {
    env.restore()
  }
})

const summary = (overrides: Partial<Record<'created' | 'adopted' | 'updated' | 'unchanged' | 'failed', number>> & { errors?: string[] } = {}) => ({
  created: 0, adopted: 0, updated: 0, unchanged: 0, failed: 0, errors: [], ...overrides,
})

void test('sync creates a record with the documented Cloudflare body', async () => {
  const { srvService } = await modulesPromise
  const env = await setup({ rows: [srvRow()] })
  try {
    assert.deepEqual(await srvService.syncSrvRecords(), summary({ created: 1 }))

    const [create] = env.cf.creates()
    assert.equal(create.url.pathname, `/client/v4/zones/${ZONE_ID}/dns_records`)
    assert.deepEqual(create.body, {
      type: 'SRV',
      name: NAME,
      ttl: 1,
      data: { priority: 0, weight: 0, port: 25566, target: 'skyblock.lockoo.dev' },
      comment: 'vane srv #12',
    })
    assert.ok(String(create.body?.comment).length < 100)

    const lookup = env.cf.calls.find((c) => c.url.searchParams.get('type') === 'SRV')!
    assert.equal(lookup.url.searchParams.get('name'), NAME)

    const row = env.db.byId(12)!
    assert.equal(row.cfRecordId, 'cf-new-1')
    assert.equal(row.syncState, 'ok')
    assert.equal(row.lastError, null)
    assert.ok(row.lastSyncedAt instanceof Date)

    env.cf.calls.length = 0
    assert.deepEqual(await srvService.syncSrvRecords(), summary({ unchanged: 1 }))
    assert.deepEqual(env.cf.writes(), [])
  } finally {
    env.restore()
  }
})

void test('sync adopts the single existing record instead of creating a second one', async () => {
  const { srvService } = await modulesPromise
  const env = await setup({
    rows: [srvRow({ id: 1 }), srvRow({ id: 2, hostname: 'lobby', port: 25570 })],
    records: [
      cfSrv({ id: 'hand-1', comment: 'made by hand' }),
      cfSrv({ id: 'hand-2', name: '_minecraft._tcp.lobby.lockoo.dev', data: { port: 25565 } }),
    ],
  })
  try {
    assert.deepEqual(await srvService.syncSrvRecords(), summary({ adopted: 2 }))
    assert.deepEqual(env.cf.creates(), [])
    assert.equal(env.db.byId(1)!.cfRecordId, 'hand-1')
    assert.equal(env.db.byId(2)!.cfRecordId, 'hand-2')

    const patches = env.cf.calls.filter((c) => c.method === 'PATCH')
    assert.deepEqual(patches.map((c) => c.url.pathname.split('/').pop()), ['hand-2'], 'only the drifted record is updated')
    assert.equal(env.cf.records.find((r) => r.id === 'hand-2')!.data!.port, 25570)
    assert.equal(env.cf.records.find((r) => r.id === 'hand-1')!.comment, 'made by hand')
  } finally {
    env.restore()
  }
})

void test('sync updates drift in port, target, ttl and name on the tracked record', async () => {
  const { srvService } = await modulesPromise
  const cases: Array<[string, FakeRecord]> = [
    ['port', cfSrv({ data: { port: 25565 } })],
    ['target', cfSrv({ data: { target: 'old.lockoo.dev' } })],
    ['ttl', cfSrv({ ttl: 300 })],
    ['name', cfSrv({ name: '_minecraft._tcp.old.lockoo.dev' })],
  ]
  for (const [label, record] of cases) {
    const env = await setup({ rows: [srvRow({ cfRecordId: 'cf-1', syncState: 'ok' })], records: [record] })
    try {
      assert.deepEqual(await srvService.syncSrvRecords(), summary({ updated: 1 }), label)
      const writes = env.cf.writes()
      assert.equal(writes.length, 1, `${label}: one write`)
      assert.equal(writes[0].method, 'PATCH', `${label}: updated in place`)
      assert.equal(writes[0].url.pathname, `/client/v4/zones/${ZONE_ID}/dns_records/cf-1`)
      assert.deepEqual(writes[0].body, {
        type: 'SRV',
        name: NAME,
        ttl: 1,
        data: { priority: 0, weight: 0, port: 25566, target: 'skyblock.lockoo.dev' },
      }, `${label}: body`)
      assert.equal(env.cf.records.length, 1, `${label}: still one record`)
      assert.equal(env.db.byId(12)!.cfRecordId, 'cf-1')
    } finally {
      env.restore()
    }
  }
})

void test('sync compares targets case-insensitively and ignores a trailing dot', async () => {
  const { srvService } = await modulesPromise
  const env = await setup({
    rows: [srvRow({ cfRecordId: 'cf-1' })],
    records: [cfSrv({ data: { target: 'SkyBlock.Lockoo.Dev.' } })],
  })
  try {
    assert.deepEqual(await srvService.syncSrvRecords(), summary({ unchanged: 1 }))
    assert.deepEqual(env.cf.writes(), [])
  } finally {
    env.restore()
  }
})

void test('sync reads the record from content when Cloudflare omits data', async () => {
  const { srvService } = await modulesPromise
  const record: FakeRecord = { ...cfSrv(), priority: 0, data: undefined, content: '0 25566 skyblock.lockoo.dev' } as FakeRecord
  const env = await setup({ rows: [srvRow({ cfRecordId: 'cf-1' })], records: [record] })
  try {
    assert.deepEqual(await srvService.syncSrvRecords(), summary({ unchanged: 1 }))
  } finally {
    env.restore()
  }
})

void test('sync refuses when more than one record exists at the name', async () => {
  const { srvService } = await modulesPromise
  const env = await setup({
    rows: [srvRow()],
    records: [cfSrv({ id: 'a' }), cfSrv({ id: 'b', data: { port: 25570 } })],
  })
  try {
    const result = await srvService.syncSrvRecords()
    const message = `2 SRV records exist at ${NAME}; remove the extras in Cloudflare.`
    assert.deepEqual(result, summary({ failed: 1, errors: [`${NAME}: ${message}`] }))
    assert.deepEqual(env.cf.writes(), [], 'touches none of them')
    const row = env.db.byId(12)!
    assert.equal(row.syncState, 'error')
    assert.equal(row.lastError, message)
    assert.equal(row.cfRecordId, null)
  } finally {
    env.restore()
  }
})

void test('sync finds the record again by name when the tracked id is gone', async () => {
  const { srvService } = await modulesPromise
  const env = await setup({
    rows: [srvRow({ id: 1, cfRecordId: 'gone' }), srvRow({ id: 2, hostname: 'lobby', cfRecordId: 'gone-too' })],
    records: [cfSrv({ id: 'cf-7' })],
  })
  try {
    assert.deepEqual(await srvService.syncSrvRecords(), summary({ adopted: 1, created: 1 }))
    assert.equal(env.db.byId(1)!.cfRecordId, 'cf-7')
    assert.equal(env.db.byId(2)!.cfRecordId, 'cf-new-1')
    assert.deepEqual(env.cf.creates().map((c) => c.body!.name), ['_minecraft._tcp.lobby.lockoo.dev'])
  } finally {
    env.restore()
  }
})

void test('sync refuses to rename onto a name that already has SRV records', async () => {
  const { srvService } = await modulesPromise
  const env = await setup({
    rows: [srvRow({ cfRecordId: 'cf-1' })],
    records: [cfSrv({ id: 'cf-1', name: '_minecraft._tcp.old.lockoo.dev' }), cfSrv({ id: 'someone-else' })],
  })
  try {
    const result = await srvService.syncSrvRecords()
    assert.equal(result.failed, 1)
    assert.match(result.errors[0], /Can't rename to _minecraft\._tcp\.skyblock\.lockoo\.dev: 1 SRV record\(s\) already exist there/)
    assert.deepEqual(env.cf.writes(), [])
    assert.equal(env.db.byId(12)!.cfRecordId, 'cf-1', 'keeps tracking its own record')
  } finally {
    env.restore()
  }
})

void test('sync reports a zone the token cannot see and writes nothing', async () => {
  const { srvService } = await modulesPromise
  const env = await setup({ rows: [srvRow()], zones: [] })
  try {
    assert.deepEqual(
      await srvService.syncSrvRecords(),
      summary({ failed: 1, errors: [`${NAME}: Zone "lockoo.dev" not found for this token.`] }),
    )
    assert.deepEqual(env.cf.writes(), [])
    assert.equal(env.db.byId(12)!.lastError, 'Zone "lockoo.dev" not found for this token.')
  } finally {
    env.restore()
  }
})

void test('sync never creates a record after a failed lookup', async () => {
  const { srvService } = await modulesPromise
  const isZoneLookup = (c: Call) => c.url.pathname.endsWith('/zones')
  const isTrackedLookup = (c: Call) => c.method === 'GET' && /\/dns_records\/[^/]+$/.test(c.url.pathname)
  const isNameLookup = (c: Call) => c.method === 'GET' && c.url.searchParams.get('type') === 'SRV'
  const stages: Array<{ stage: string; cfRecordId: string | null; fails: (c: Call) => boolean }> = [
    { stage: 'zone lookup', cfRecordId: null, fails: isZoneLookup },
    { stage: 'zone lookup with a tracked id', cfRecordId: 'cf-1', fails: isZoneLookup },
    { stage: 'tracked record lookup', cfRecordId: 'cf-1', fails: isTrackedLookup },
    { stage: 'name lookup', cfRecordId: null, fails: isNameLookup },
    { stage: 'name lookup after the tracked id vanished', cfRecordId: 'gone', fails: isNameLookup },
  ]
  for (const { stage, cfRecordId, fails } of stages) {
    for (const mode of Object.keys(FAILURES) as FailMode[]) {
      const label = `${stage} / ${mode}`
      const env = await setup({ rows: [srvRow({ cfRecordId })], fail: (c) => (fails(c) ? mode : null) })
      try {
        const result = await srvService.syncSrvRecords()
        assert.equal(result.failed, 1, `${label}: failed`)
        assert.equal(result.created + result.adopted + result.updated + result.unchanged, 0, `${label}: no success`)
        assert.deepEqual(env.cf.writes(), [], `${label}: no Cloudflare writes`)
        const row = env.db.byId(12)!
        assert.equal(row.syncState, 'error', `${label}: row state`)
        assert.ok(row.lastError, `${label}: lastError set`)
        if (cfRecordId === 'cf-1') assert.equal(row.cfRecordId, 'cf-1', `${label}: tracked id kept`)
      } finally {
        env.restore()
      }
    }
  }
})

void test('sync counts every row once, caches zones per token and keeps going after a failure', async () => {
  const { srvService } = await modulesPromise
  const env = await setup({
    rows: [
      srvRow({ id: 1, hostname: 'a' }),
      srvRow({ id: 2, hostname: 'b', cfRecordId: 'cf-b' }),
      srvRow({ id: 3, hostname: 'c' }),
      srvRow({ id: 4, hostname: 'd', enabled: false }),
      srvRow({ id: 5, hostname: 'e', tokenId: 5 }),
    ],
    records: [
      cfSrv({ id: 'cf-b', name: '_minecraft._tcp.b.lockoo.dev' }),
      cfSrv({ id: 'c1', name: '_minecraft._tcp.c.lockoo.dev' }),
      cfSrv({ id: 'c2', name: '_minecraft._tcp.c.lockoo.dev' }),
    ],
  })
  try {
    const result = await srvService.syncSrvRecords()
    assert.deepEqual({ ...result, errors: result.errors.length }, { created: 2, adopted: 0, updated: 0, unchanged: 1, failed: 1, errors: 1 })
    assert.equal(env.db.byId(4)!.syncState, 'pending', 'disabled rows are skipped')
    const zoneLookups = env.cf.calls.filter((c) => c.url.pathname.endsWith('/zones'))
    assert.equal(zoneLookups.length, 2, 'one zone lookup per token')
  } finally {
    env.restore()
  }
})

void test('overlapping syncs never create the same record twice', async () => {
  const { srvService } = await modulesPromise
  const env = await setup({ rows: [srvRow()] })
  try {
    const [first, second] = await Promise.all([srvService.syncSrvRecords(), srvService.syncSrvRecords()])
    assert.deepEqual(first, summary({ created: 1 }))
    assert.deepEqual(second, summary({ unchanged: 1 }))
    assert.equal(env.cf.creates().length, 1)
  } finally {
    env.restore()
  }
})

void test('POST /api/srv/sync returns the summary and 500 only when the sync crashes', async () => {
  const { prisma } = await modulesPromise
  const env = await setup({ rows: [srvRow()] })
  try {
    await withServer(async (baseUrl) => {
      const ok = await api(baseUrl, 'POST', '/api/srv/sync')
      assert.deepEqual(ok, { status: 200, json: summary({ created: 1 }) })

      const restoreFindMany = overrideProperty(prisma.srvRecord, 'findMany', (() => Promise.reject(new Error('database is locked'))) as never)
      try {
        assert.deepEqual(await api(baseUrl, 'POST', '/api/srv/sync'), { status: 500, json: { error: 'database is locked' } })
      } finally {
        restoreFindMany()
      }
    })
  } finally {
    env.restore()
  }
})

void test('delete and disable leave Cloudflare alone unless deleteRecordsOnRemoval is on', async () => {
  const env = await setup({ rows: [srvRow({ id: 1, cfRecordId: 'cf-1', syncState: 'ok' }), srvRow({ id: 2, hostname: 'lobby' })], records: [cfSrv()] })
  try {
    await withServer(async (baseUrl) => {
      assert.deepEqual(await api(baseUrl, 'POST', '/api/srv/1/toggle'), { status: 200, json: { ok: true, enabled: false } })
      const row = env.db.byId(1)!
      assert.equal(row.enabled, false)
      assert.equal(row.cfRecordId, null, 'disabling clears the tracked id')
      assert.equal(row.syncState, 'pending')

      assert.deepEqual(await api(baseUrl, 'DELETE', '/api/srv/2'), { status: 200, json: { ok: true } })
      assert.equal(env.db.byId(2), undefined)
      assert.equal(env.cf.calls.length, 0)
      assert.equal(env.cf.records.length, 1)
    })
  } finally {
    env.restore()
  }
})

void test('delete removes the tracked record by its id', async () => {
  const env = await setup({
    deleteOnRemoval: true,
    rows: [srvRow({ cfRecordId: 'cf-1', port: 25599 })],
    records: [cfSrv({ id: 'cf-1' }), cfSrv({ id: 'other', name: '_minecraft._tcp.other.lockoo.dev' })],
  })
  try {
    await withServer(async (baseUrl) => {
      assert.deepEqual(await api(baseUrl, 'DELETE', '/api/srv/12'), { status: 200, json: { ok: true, recordsDeleted: 1 } })
      const deletes = env.cf.calls.filter((c) => c.method === 'DELETE')
      assert.deepEqual(deletes.map((c) => c.url.pathname), [`/client/v4/zones/${ZONE_ID}/dns_records/cf-1`])
      assert.deepEqual(env.cf.records.map((r) => r.id), ['other'])
    })
  } finally {
    env.restore()
  }
})

void test('without a tracked id, cleanup deletes only a single exact match', async () => {
  const cases: Array<{ label: string; records: FakeRecord[]; json: Record<string, unknown>; left: number }> = [
    { label: 'single exact match', records: [cfSrv({ id: 'x', data: { target: 'SkyBlock.lockoo.dev.' } })], json: { ok: true, recordsDeleted: 1 }, left: 0 },
    { label: 'nothing there', records: [], json: { ok: true, recordsDeleted: 0 }, left: 0 },
    {
      label: 'single record with other data',
      records: [cfSrv({ id: 'x', data: { port: 25565 } })],
      json: { ok: true, recordsDeleted: 0, cleanupErrors: [`Left the SRV record at ${NAME} in place: it doesn't match this row, so Vane can't prove it owns it.`] },
      left: 1,
    },
    {
      label: 'two records',
      records: [cfSrv({ id: 'x' }), cfSrv({ id: 'y' })],
      json: { ok: true, recordsDeleted: 0, cleanupErrors: [`Left 2 SRV records at ${NAME} in place: Vane can't tell which one is its own.`] },
      left: 2,
    },
  ]
  for (const { label, records, json, left } of cases) {
    const env = await setup({ deleteOnRemoval: true, rows: [srvRow()], records })
    try {
      await withServer(async (baseUrl) => {
        assert.deepEqual(await api(baseUrl, 'DELETE', '/api/srv/12'), { status: 200, json }, label)
        assert.equal(env.cf.records.length, left, `${label}: records left`)
      })
    } finally {
      env.restore()
    }
  }
})

void test('a stale tracked id falls back to the exact-match rule', async () => {
  const env = await setup({ deleteOnRemoval: true, rows: [srvRow({ cfRecordId: 'gone' })], records: [cfSrv({ id: 'x' })] })
  try {
    await withServer(async (baseUrl) => {
      assert.deepEqual(await api(baseUrl, 'DELETE', '/api/srv/12'), { status: 200, json: { ok: true, recordsDeleted: 1 } })
      assert.equal(env.cf.records.length, 0)
    })
  } finally {
    env.restore()
  }
})

void test('cleanup never deletes after a failed lookup', async () => {
  const stages: Array<[string, string | null, (c: Call) => boolean]> = [
    ['zone lookup', 'cf-1', (c) => c.url.pathname.endsWith('/zones')],
    ['tracked record lookup', 'cf-1', (c) => c.method === 'GET' && c.url.pathname.endsWith('/cf-1')],
    ['name lookup', null, (c) => c.method === 'GET' && c.url.searchParams.get('type') === 'SRV'],
  ]
  for (const [stage, cfRecordId, fails] of stages) {
    for (const mode of ['network', 'auth', 'rateLimit'] as const) {
      const env = await setup({ deleteOnRemoval: true, rows: [srvRow({ cfRecordId })], records: [cfSrv()], fail: (c) => (fails(c) ? mode : null) })
      try {
        await withServer(async (baseUrl) => {
          const res = await api(baseUrl, 'DELETE', '/api/srv/12')
          assert.equal(res.status, 200)
          assert.equal(res.json.ok, true)
          assert.equal((res.json.cleanupErrors as string[]).length, 1, `${stage} / ${mode}: reported`)
          assert.deepEqual(env.cf.writes(), [], `${stage} / ${mode}: nothing deleted`)
        })
      } finally {
        env.restore()
      }
    }
  }
})

void test('toggle cleans up and clears the id on disable, and marks the row pending on enable', async () => {
  const env = await setup({ deleteOnRemoval: true, rows: [srvRow({ cfRecordId: 'cf-1', syncState: 'ok' })], records: [cfSrv()] })
  try {
    await withServer(async (baseUrl) => {
      assert.deepEqual(await api(baseUrl, 'POST', '/api/srv/12/toggle'), { status: 200, json: { ok: true, enabled: false, recordsDeleted: 1 } })
      assert.equal(env.cf.records.length, 0)
      assert.equal(env.db.byId(12)!.cfRecordId, null)

      env.cf.calls.length = 0
      assert.deepEqual(await api(baseUrl, 'POST', '/api/srv/12/toggle'), { status: 200, json: { ok: true, enabled: true } })
      assert.equal(env.db.byId(12)!.syncState, 'pending')
      assert.equal(env.cf.calls.length, 0, 'enabling waits for the next sync')
    })
  } finally {
    env.restore()
  }
})

void test('PUT that disables the row or moves it to another zone cleans up the old record', async () => {
  const env = await setup({
    deleteOnRemoval: true,
    zones: ['lockoo.dev', 'lockoo.net'],
    rows: [srvRow({ id: 1, cfRecordId: 'cf-1', syncState: 'ok' }), srvRow({ id: 2, hostname: 'lobby', cfRecordId: 'cf-2', syncState: 'ok' })],
    records: [cfSrv({ id: 'cf-1' }), cfSrv({ id: 'cf-2', name: '_minecraft._tcp.lobby.lockoo.dev' })],
  })
  try {
    await withServer(async (baseUrl) => {
      assert.deepEqual(await api(baseUrl, 'PUT', '/api/srv/1', { enabled: false }), { status: 200, json: { ok: true } })
      assert.equal(env.db.byId(1)!.cfRecordId, null)
      assert.deepEqual(env.cf.records.map((r) => r.id), ['cf-2'])

      assert.deepEqual(await api(baseUrl, 'PUT', '/api/srv/2', { zone: 'lockoo.net' }), { status: 200, json: { ok: true } })
      const moved = env.db.byId(2)!
      assert.equal(moved.cfRecordId, null)
      assert.equal(moved.syncState, 'pending')
      assert.deepEqual(env.cf.records, [])
      assert.ok(env.cf.calls.filter((c) => c.method === 'DELETE').every((c) => c.url.pathname.includes(ZONE_ID)))
    })
  } finally {
    env.restore()
  }
})

void test('apply syncs SRV records even when no host is enabled', async () => {
  const { prisma, configService } = await modulesPromise
  const env = await setup({ rows: [srvRow()] })
  const restore = [
    overrideProperty(prisma.host, 'findMany', (() => Promise.resolve([])) as never),
    overrideProperty(prisma.configHistory, 'create', (() => Promise.resolve(undefined)) as never),
    stubDocker(),
  ]
  try {
    const result = await configService.applyAndRestart('test')
    assert.deepEqual(result.srvSync, summary({ created: 1 }))
    assert.equal(result.recreated, false)
    assert.match(result.message, /SRV records: 1 created\.$/)
    assert.equal(env.cf.creates().length, 1)
  } finally {
    for (const restoreOne of restore.reverse()) restoreOne()
    env.restore()
  }
})

void test('apply syncs SRV records after favonia and no SRV name reaches ddns.env', async () => {
  const { prisma, configService, cryptoModule } = await modulesPromise
  const env = await setup({
    rows: [srvRow({ id: 1 }), srvRow({ id: 2, hostname: 'lobby', port: 25567 })],
    records: [cfSrv({ id: 'x' }), cfSrv({ id: 'y' })],
  })
  const host = {
    id: 1, zone: 'lockoo.dev', hostname: 'skyblock', recordType: 'BOTH', proxied: false, ttl: 1,
    description: null, enabled: true, tokenId: 4, token: { id: 4, name: 'lockoo.dev', ciphertext: cryptoModule.encrypt('cf-token-4') },
  }
  const restore = [
    overrideProperty(prisma.host, 'findMany', (() => Promise.resolve([host])) as never),
    overrideProperty(prisma.configHistory, 'create', (() => Promise.resolve(undefined)) as never),
    stubDocker(),
  ]
  try {
    const generated = await configService.generateConfig()
    const result = await configService.applyAndRestart('test')
    const written = fs.readFileSync(path.join(configDir, 'ddns.env'), 'utf8')

    for (const text of [generated.content, written, JSON.stringify(generated.instances)]) {
      assert.doesNotMatch(text, /_minecraft|_tcp|lobby/)
    }
    assert.match(written, /^DOMAINS=skyblock\.lockoo\.dev$/m)

    assert.deepEqual(result.srvSync, summary({
      created: 1,
      failed: 1,
      errors: [`${NAME}: 2 SRV records exist at ${NAME}; remove the extras in Cloudflare.`],
    }))
    assert.ok(result.warnings.includes(result.srvSync.errors[0]))
    assert.match(result.message, /SRV records: 1 created, 1 failed\./)
  } finally {
    for (const restoreOne of restore.reverse()) restoreOne()
    env.restore()
  }
})

void test('health lists SRV rows next to hosts and reuses the zone record cache', async () => {
  const { prisma, healthService, cryptoModule } = await modulesPromise
  const env = await setup({
    rows: [
      srvRow({ id: 1, cfRecordId: 'cf-1' }),
      srvRow({ id: 2, hostname: 'lobby', port: 25567 }),
      srvRow({ id: 3, proto: 'udp' }),
    ],
    records: [
      cfSrv({ id: 'cf-1', data: { target: 'SkyBlock.Lockoo.dev.' } }),
      cfSrv({ id: 'cf-2', name: '_minecraft._tcp.lobby.lockoo.dev', data: { port: 25565, target: 'lobby.lockoo.dev' } }),
      { id: 'a-1', zoneId: ZONE_ID, type: 'A', name: 'skyblock.lockoo.dev', ttl: 1, proxied: false, content: '203.0.113.10' },
    ],
  })
  const token = { id: 4, name: 'lockoo.dev', ciphertext: cryptoModule.encrypt('cf-token-4') }
  const restore = [
    overrideProperty(prisma.host, 'findMany', (() => Promise.resolve([{
      id: 1, zone: 'lockoo.dev', hostname: 'skyblock', recordType: 'A', proxied: false, ttl: 1,
      description: null, enabled: true, tokenId: 4, token,
    }])) as never),
    overrideProperty(prisma.host, 'count', (() => Promise.resolve(1)) as never),
    stubDocker(),
  ]
  try {
    const report = await healthService.getHealth()
    assert.deepEqual(report.records, [
      { hostname: 'skyblock.lockoo.dev', type: 'A', expected: '203.0.113.10', cloudflareValue: '203.0.113.10', updateNeeded: false },
      { hostname: '_minecraft._tcp.lobby.lockoo.dev', type: 'SRV', expected: '0 0 25567 skyblock.lockoo.dev', cloudflareValue: '0 0 25565 lobby.lockoo.dev', updateNeeded: true },
      { hostname: NAME, type: 'SRV', expected: '0 0 25566 skyblock.lockoo.dev', cloudflareValue: '0 0 25566 skyblock.lockoo.dev', updateNeeded: false },
      { hostname: '_minecraft._udp.skyblock.lockoo.dev', type: 'SRV', expected: '0 0 25566 skyblock.lockoo.dev', cloudflareValue: null, updateNeeded: true },
    ])
    const zoneListings = env.cf.calls.filter((c) => c.url.pathname.endsWith('/dns_records') && c.url.searchParams.has('per_page'))
    assert.equal(zoneListings.length, 1)
  } finally {
    for (const restoreOne of restore.reverse()) restoreOne()
    env.restore()
  }
})

function stubBackupDb(prisma: Awaited<typeof modulesPromise>['prisma'], tokenCiphertext: string) {
  const created: Array<Record<string, unknown>> = []
  let srvWiped = false
  const restore = [
    overrideProperty(prisma.apiToken, 'findMany', (() => Promise.resolve([{ id: 4, name: 'lockoo.dev', ciphertext: tokenCiphertext }])) as never),
    overrideProperty(prisma.host, 'findMany', (() => Promise.resolve([])) as never),
    overrideProperty(prisma.setting, 'findMany', (() => Promise.resolve([])) as never),
    overrideProperty(prisma, '$transaction', ((callback: (tx: unknown) => Promise<void>) => callback({
      apiToken: {
        deleteMany: () => Promise.resolve(undefined),
        create: ({ data }: { data: object }) => Promise.resolve({ id: 1, ...data }),
      },
      host: { deleteMany: () => Promise.resolve(undefined), create: () => Promise.resolve(undefined) },
      srvRecord: {
        deleteMany: () => {
          srvWiped = true
          return Promise.resolve(undefined)
        },
        create: ({ data }: { data: Record<string, unknown> }) => {
          created.push(data)
          return Promise.resolve({ id: created.length, ...data })
        },
      },
      setting: { upsert: () => Promise.resolve(undefined) },
    })) as never),
  ]
  return { created, wiped: () => srvWiped, restore: () => restore.reverse().forEach((r) => r()) }
}

void test('backup exports SRV rows without sync state and restores them as pending', async () => {
  const { prisma, cryptoModule, backupCrypto } = await modulesPromise
  const env = await setup({
    rows: [srvRow({ description: '[vanander] 17d9', cfRecordId: 'cf-1', syncState: 'ok', lastError: 'old', lastSyncedAt: new Date() })],
  })
  const backup = stubBackupDb(prisma, cryptoModule.encrypt('cf-token-4'))
  try {
    await withServer(async (baseUrl) => {
      const exported = await realFetch(`${baseUrl}/api/backup/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'super-secret' }),
      })
      const blob = Buffer.from(await exported.arrayBuffer())
      const bundle = JSON.parse(await backupCrypto.decryptBackup(blob, 'super-secret')) as { srvRecords: unknown[] }
      const exportedRow = {
        zone: 'lockoo.dev',
        hostname: 'skyblock',
        service: 'minecraft',
        proto: 'tcp',
        priority: 0,
        weight: 0,
        port: 25566,
        target: 'skyblock.lockoo.dev',
        ttl: 1,
        description: '[vanander] 17d9',
        enabled: true,
        tokenName: 'lockoo.dev',
      }
      assert.deepEqual(bundle.srvRecords, [exportedRow])

      const data = blob.toString('base64')
      const preview = await api(baseUrl, 'POST', '/api/backup/preview', { password: 'super-secret', data })
      assert.equal(preview.json.srvRecords, 1)

      const imported = await api(baseUrl, 'POST', '/api/backup/import', { password: 'super-secret', data })
      assert.deepEqual(imported.json, { ok: true, tokens: 1, hosts: 0, srvRecords: 1 })
      assert.ok(backup.wiped())
      const { tokenName: _tokenName, ...fields } = exportedRow
      assert.deepEqual(backup.created, [{ ...fields, tokenId: 1, syncState: 'pending' }])
    })
  } finally {
    backup.restore()
    env.restore()
  }
})

void test('backup without srvRecords still imports', async () => {
  const { prisma, cryptoModule, backupCrypto } = await modulesPromise
  const backup = stubBackupDb(prisma, cryptoModule.encrypt('cf-token-4'))
  const legacy = {
    version: 1,
    exportedAt: '2026-08-10T00:00:00.000Z',
    tokens: [{ name: 'lockoo.dev', token: 'cf-token-4' }],
    hosts: [],
    settings: {},
  }
  const data = (await backupCrypto.encryptBackup(JSON.stringify(legacy), 'super-secret')).toString('base64')
  try {
    await withServer(async (baseUrl) => {
      const preview = await api(baseUrl, 'POST', '/api/backup/preview', { password: 'super-secret', data })
      assert.equal(preview.status, 200)
      assert.equal(preview.json.srvRecords, 0)

      const imported = await api(baseUrl, 'POST', '/api/backup/import', { password: 'super-secret', data })
      assert.deepEqual(imported.json, { ok: true, tokens: 1, hosts: 0, srvRecords: 0 })
      assert.ok(backup.wiped(), 'a restore replaces the SRV rows like hosts')
      assert.deepEqual(backup.created, [])
    })
  } finally {
    backup.restore()
  }
})
