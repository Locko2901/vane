import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { overrideProperty, startTestServer } from './helpers'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vane-backend-routes-'))
process.env.DATA_DIR = dataDir
process.env.DDNS_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vane-ddns-config-'))

const modulesPromise = (async () => {
  const appModule = await import('../src/app')
  const { prisma } = await import('../src/db')
  const cryptoModule = await import('../src/crypto')
  const backupCrypto = await import('../src/backupCrypto')
  return { appModule, prisma, cryptoModule, backupCrypto }
})()

async function request(baseUrl: string, pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
}

void test('backup routes export, preview and import backup bundles', async () => {
  const { appModule, prisma, cryptoModule, backupCrypto } = await modulesPromise
  const tokenCiphertext = cryptoModule.encrypt('short')
  const bundle = {
    version: 1 as const,
    exportedAt: '2026-08-10T00:00:00.000Z',
    tokens: [{ name: 'Personal', token: 'token-1' }],
    hosts: [{
      zone: 'example.com',
      hostname: 'vpn',
      recordType: 'A',
      proxied: true,
      ttl: 1,
      description: 'Imported',
      enabled: true,
      tokenName: 'Personal',
    }],
    settings: { theme: 'dark' },
  }
  const encryptedBundle = await backupCrypto.encryptBackup(JSON.stringify(bundle), 'super-secret')
  const restore = [
    overrideProperty(prisma.apiToken, 'findMany', () => Promise.resolve([{ id: 1, name: 'Personal', ciphertext: tokenCiphertext }])),
    overrideProperty(prisma.host, 'findMany', () => Promise.resolve([{
      zone: 'example.com',
      hostname: 'vpn',
      recordType: 'A',
      proxied: true,
      ttl: 1,
      description: 'Imported',
      enabled: true,
      token: { name: 'Personal', ciphertext: tokenCiphertext },
    }])),
    overrideProperty(prisma.setting, 'findMany', () => Promise.resolve([{ key: 'theme', value: 'dark' }])),
    overrideProperty(prisma, '$transaction', (callback: (tx: any) => Promise<void>) => {
      return callback({
        apiToken: {
          deleteMany: () => Promise.resolve(undefined),
          create: ({ data }: any) => Promise.resolve({ id: 1, ...data }),
        },
        host: {
          deleteMany: () => Promise.resolve(undefined),
          create: ({ data }: any) => Promise.resolve({ id: 1, ...data }),
        },
        setting: {
          upsert: () => Promise.resolve(undefined),
        },
      })
    }),
  ]

  const { baseUrl, close } = await startTestServer(appModule.createApp())
  try {
    const exported = await request(baseUrl, '/api/backup/export', {
      method: 'POST',
      body: JSON.stringify({ password: 'super-secret' }),
    })
    assert.equal(exported.status, 200)
    assert.equal(exported.headers.get('content-type'), 'application/octet-stream')
    assert.equal(Buffer.from(await exported.arrayBuffer()).subarray(0, 4).toString('ascii'), 'VANE')

    const preview = await request(baseUrl, '/api/backup/preview', {
      method: 'POST',
      body: JSON.stringify({ password: 'super-secret', data: encryptedBundle.toString('base64') }),
    })
    assert.equal(preview.status, 200)
    assert.deepEqual(await preview.json(), {
      tokens: ['Personal'],
      hosts: 1,
      settings: 1,
    })

    const imported = await request(baseUrl, '/api/backup/import', {
      method: 'POST',
      body: JSON.stringify({ password: 'super-secret', data: encryptedBundle.toString('base64') }),
    })
    assert.equal(imported.status, 200)
    assert.deepEqual(await imported.json(), { ok: true, tokens: 1, hosts: 1 })
  } finally {
    for (const restoreOne of restore.reverse()) restoreOne()
    await close()
  }
})

void test('tokens routes list, create and delete tokens', async () => {
  const { appModule, prisma, cryptoModule } = await modulesPromise
  const tokenCiphertext = cryptoModule.encrypt('short')
  const restore = [
    overrideProperty(prisma.apiToken, 'findMany', () => Promise.resolve([
      {
        id: 1,
        name: 'Personal',
        ciphertext: tokenCiphertext,
        lastValid: null,
        lastChecked: null,
        _count: { hosts: 0 },
      },
    ] as any)),
    overrideProperty(prisma.apiToken, 'create', ({ data }: any) => Promise.resolve({ id: 2, ...data })),
    overrideProperty(prisma.apiToken, 'delete', () => Promise.resolve(undefined)),
    overrideProperty(prisma.host, 'count', () => Promise.resolve(0)),
  ]

  const { baseUrl, close } = await startTestServer(appModule.createApp())
  try {
    const list = await request(baseUrl, '/api/tokens')
    assert.deepEqual(await list.json(), [{
      id: 1,
      name: 'Personal',
      masked: '*****',
      lastValid: null,
      lastChecked: null,
      hostCount: 0,
    }])

    const created = await request(baseUrl, '/api/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 'Home', token: 'super-secret-token' }),
    })
    assert.deepEqual(await created.json(), { id: 2, name: 'Home' })

    const deleted = await request(baseUrl, '/api/tokens/1', { method: 'DELETE' })
    assert.deepEqual(await deleted.json(), { ok: true })
  } finally {
    for (const restoreOne of restore.reverse()) restoreOne()
    await close()
  }
})

void test('hosts routes list, create, toggle and delete hosts', async () => {
  const { appModule, prisma, cryptoModule } = await modulesPromise
  const hostCiphertext = cryptoModule.encrypt('short')
  const restore = [
    overrideProperty(prisma.host, 'findMany', () => Promise.resolve([{
      id: 1,
      zone: 'example.com',
      hostname: 'vpn',
      recordType: 'A',
      proxied: true,
      ttl: 1,
      description: 'Primary host',
      enabled: true,
      tokenId: 7,
      token: { name: 'Personal', ciphertext: hostCiphertext },
    }])),
    overrideProperty(prisma.host, 'findUnique', ({ where }: any) => Promise.resolve(where.id === 1 ? ({
      id: 1,
      zone: 'example.com',
      hostname: 'vpn',
      recordType: 'A',
      proxied: true,
      ttl: 1,
      description: 'Primary host',
      enabled: true,
      tokenId: 7,
      token: { name: 'Personal', ciphertext: hostCiphertext },
    }) : null)),
    overrideProperty(prisma.apiToken, 'findUnique', ({ where }: any) => Promise.resolve({ id: where.id, ciphertext: hostCiphertext, name: 'Personal' })),
    overrideProperty(prisma.setting, 'findUnique', () => Promise.resolve({ key: 'deleteRecordsOnRemoval', value: 'false' })),
    overrideProperty(prisma.host, 'create', ({ data }: any) => Promise.resolve({ id: 2, ...data })),
    overrideProperty(prisma.host, 'delete', () => Promise.resolve(undefined)),
    overrideProperty(prisma.host, 'findFirst', () => Promise.resolve(null)),
    overrideProperty(prisma.host, 'update', () => Promise.resolve(undefined)),
  ]

  const { baseUrl, close } = await startTestServer(appModule.createApp())
  try {
    const list = await request(baseUrl, '/api/hosts')
    assert.deepEqual(await list.json(), [{
      id: 1,
      zone: 'example.com',
      hostname: 'vpn',
      fqdn: 'vpn.example.com',
      recordType: 'A',
      proxied: true,
      ttl: 1,
      description: 'Primary host',
      enabled: true,
      tokenId: 7,
      tokenName: 'Personal',
      tokenMasked: '*****',
    }])

    const created = await request(baseUrl, '/api/hosts', {
      method: 'POST',
      body: JSON.stringify({
        zone: 'example.com',
        hostname: 'vpn',
        recordType: 'A',
        proxied: true,
        ttl: 1,
        description: 'New host',
        tokenId: 7,
        enabled: true,
      }),
    })
    assert.deepEqual(await created.json(), { id: 2 })

    const toggle = await request(baseUrl, '/api/hosts/1/toggle', { method: 'POST' })
    assert.deepEqual(await toggle.json(), { ok: true, enabled: false })

    const deleted = await request(baseUrl, '/api/hosts/1', { method: 'DELETE' })
    assert.deepEqual(await deleted.json(), { ok: true })
  } finally {
    for (const restoreOne of restore.reverse()) restoreOne()
    await close()
  }
})
