import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db'
import { decrypt, encrypt } from '../crypto'
import { decryptBackup, encryptBackup, MIN_PASSWORD_LENGTH } from '../backupCrypto'

export const backupRouter = Router()

interface BackupFile {
  version: 1
  exportedAt: string
  tokens: Array<{ name: string; token: string }>
  hosts: Array<{
    zone: string
    hostname: string
    recordType: string
    proxied: boolean
    ttl: number
    description: string | null
    enabled: boolean
    tokenName: string
  }>
  srvRecords?: BackupSrvRecord[]
  settings: Record<string, string>
}

interface BackupSrvRecord {
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
  tokenName: string
}

const backupSchema = z.object({
  version: z.literal(1),
  tokens: z.array(z.object({ name: z.string(), token: z.string() })),
  hosts: z.array(
    z.object({
      zone: z.string(),
      hostname: z.string(),
      recordType: z.string(),
      proxied: z.boolean(),
      ttl: z.number(),
      description: z.string().nullable().optional(),
      enabled: z.boolean(),
      tokenName: z.string(),
    }),
  ),
  srvRecords: z
    .array(
      z.object({
        zone: z.string(),
        hostname: z.string(),
        service: z.string(),
        proto: z.string(),
        priority: z.number(),
        weight: z.number(),
        port: z.number(),
        target: z.string(),
        ttl: z.number(),
        description: z.string().nullable().optional(),
        enabled: z.boolean(),
        tokenName: z.string(),
      }),
    )
    .optional(),
  settings: z.record(z.string(), z.string()).optional(),
})

const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)

const exportSchema = z.object({ password: passwordSchema })
const importSchema = z.object({ password: passwordSchema, data: z.string().min(1) })

async function buildBundle(): Promise<BackupFile> {
  const tokens = await prisma.apiToken.findMany()
  const hosts = await prisma.host.findMany({ include: { token: true } })
  const srvRecords = await prisma.srvRecord.findMany({ include: { token: true } })
  const settings = await prisma.setting.findMany()

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    tokens: tokens.map((t) => ({ name: t.name, token: decrypt(t.ciphertext) })),
    hosts: hosts.map((h) => ({
      zone: h.zone,
      hostname: h.hostname,
      recordType: h.recordType,
      proxied: h.proxied,
      ttl: h.ttl,
      description: h.description,
      enabled: h.enabled,
      tokenName: h.token.name,
    })),
    srvRecords: srvRecords.map((r) => ({
      zone: r.zone,
      hostname: r.hostname,
      service: r.service,
      proto: r.proto,
      priority: r.priority,
      weight: r.weight,
      port: r.port,
      target: r.target,
      ttl: r.ttl,
      description: r.description,
      enabled: r.enabled,
      tokenName: r.token.name,
    })),
    settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
  }
}

async function decodeBundle(dataB64: string, password: string): Promise<BackupFile> {
  const blob = Buffer.from(dataB64, 'base64')
  const json = await decryptBackup(blob, password)

  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('Backup contents are corrupted.')
  }
  const parsed = backupSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error('Backup file has an unexpected structure.')
  }
  return parsed.data as BackupFile
}

backupRouter.post('/export', async (req, res) => {
  const parsed = exportSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' })
    return
  }

  const bundle = await buildBundle()
  const blob = await encryptBackup(JSON.stringify(bundle), parsed.data.password)

  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('Content-Disposition', 'attachment; filename="vane-backup.bin"')
  res.send(blob)
})

backupRouter.post('/preview', async (req, res) => {
  const parsed = importSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' })
    return
  }

  try {
    const bundle = await decodeBundle(parsed.data.data, parsed.data.password)
    res.json({
      exportedAt: bundle.exportedAt,
      tokens: bundle.tokens.map((t) => t.name),
      hosts: bundle.hosts.length,
      srvRecords: bundle.srvRecords?.length ?? 0,
      settings: Object.keys(bundle.settings).length,
    })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to read backup.' })
  }
})

backupRouter.post('/import', async (req, res) => {
  const parsed = importSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' })
    return
  }

  let data: BackupFile
  try {
    data = await decodeBundle(parsed.data.data, parsed.data.password)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to read backup.' })
    return
  }

  await prisma.$transaction(async (tx) => {
    await tx.host.deleteMany()
    await tx.srvRecord.deleteMany()
    await tx.apiToken.deleteMany()

    const tokenMap = new Map<string, number>()
    for (const t of data.tokens) {
      const created = await tx.apiToken.create({
        data: { name: t.name, ciphertext: encrypt(t.token) },
      })
      tokenMap.set(t.name, created.id)
    }
    for (const h of data.hosts) {
      const tokenId = tokenMap.get(h.tokenName)
      if (!tokenId) continue
      await tx.host.create({
        data: {
          zone: h.zone,
          hostname: h.hostname,
          recordType: h.recordType,
          proxied: h.proxied,
          ttl: h.ttl,
          description: h.description ?? null,
          enabled: h.enabled,
          tokenId,
        },
      })
    }
    for (const r of data.srvRecords ?? []) {
      const tokenId = tokenMap.get(r.tokenName)
      if (!tokenId) continue
      await tx.srvRecord.create({
        data: {
          zone: r.zone,
          hostname: r.hostname,
          service: r.service,
          proto: r.proto,
          priority: r.priority,
          weight: r.weight,
          port: r.port,
          target: r.target,
          ttl: r.ttl,
          description: r.description ?? null,
          enabled: r.enabled,
          tokenId,
          syncState: 'pending',
        },
      })
    }
    if (data.settings) {
      for (const [key, value] of Object.entries(data.settings)) {
        await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } })
      }
    }
  })

  res.json({ ok: true, tokens: data.tokens.length, hosts: data.hosts.length, srvRecords: data.srvRecords?.length ?? 0 })
})
