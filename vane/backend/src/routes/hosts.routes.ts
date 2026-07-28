import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db'
import { decrypt, maskSecret } from '../crypto'
import { findZone, getRecords, validateToken, deleteRecordsForName } from '../services/cloudflareService'
import * as configService from '../services/configService'
import type { Host, ApiToken } from '@prisma/client'

export const hostsRouter = Router()

const hostSchema = z.object({
  zone: z.string().min(1).max(253),
  hostname: z.string().min(0).max(253),
  recordType: z.enum(['A', 'AAAA', 'BOTH']),
  proxied: z.boolean(),
  ttl: z.number().int().min(1).max(86400),
  description: z.string().max(500).optional().nullable(),
  enabled: z.boolean().optional(),
  tokenId: z.number().int(),
})

hostsRouter.get('/', async (_req, res) => {
  const hosts = await prisma.host.findMany({
    orderBy: [{ zone: 'asc' }, { hostname: 'asc' }],
    include: { token: true },
  })
  res.json(
    hosts.map((h) => ({
      id: h.id,
      zone: h.zone,
      hostname: h.hostname,
      fqdn: configService.fqdn(h.zone, h.hostname),
      recordType: h.recordType,
      proxied: h.proxied,
      ttl: h.ttl,
      description: h.description,
      enabled: h.enabled,
      tokenId: h.tokenId,
      tokenName: h.token.name,
      tokenMasked: maskSecret(safeDecrypt(h.token.ciphertext)),
    })),
  )
})

hostsRouter.post('/', async (req, res) => {
  const parsed = hostSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid host payload.', details: parsed.error.flatten() })
    return
  }
  const token = await prisma.apiToken.findUnique({ where: { id: parsed.data.tokenId } })
  if (!token) {
    res.status(400).json({ error: 'Selected API token does not exist.' })
    return
  }
  try {
    const created = await prisma.host.create({
      data: {
        zone: parsed.data.zone,
        hostname: parsed.data.hostname || '@',
        recordType: parsed.data.recordType,
        proxied: parsed.data.proxied,
        ttl: parsed.data.ttl,
        description: parsed.data.description ?? null,
        enabled: parsed.data.enabled ?? true,
        tokenId: parsed.data.tokenId,
      },
    })
    res.json({ id: created.id })
  } catch {
    res.status(409).json({ error: 'A host with this zone, hostname and record type already exists.' })
  }
})

hostsRouter.put('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const parsed = hostSchema.partial().safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid host payload.' })
    return
  }
  try {
    await prisma.host.update({ where: { id }, data: parsed.data as any })
    res.json({ ok: true })
  } catch {
    res.status(404).json({ error: 'Host not found or duplicate entry.' })
  }
})

hostsRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const host = await prisma.host.findUnique({ where: { id }, include: { token: true } })
  if (!host) {
    res.json({ ok: true })
    return
  }
  await prisma.host.delete({ where: { id } }).catch(() => undefined)
  const cleanup = await cleanupHostRecords(host)
  res.json({ ok: true, ...cleanup })
})

hostsRouter.post('/:id/toggle', async (req, res) => {
  const id = Number(req.params.id)
  const host = await prisma.host.findUnique({ where: { id }, include: { token: true } })
  if (!host) {
    res.status(404).json({ error: 'Host not found.' })
    return
  }
  const nextEnabled = !host.enabled
  await prisma.host.update({ where: { id }, data: { enabled: nextEnabled } })
  const cleanup = nextEnabled ? {} : await cleanupHostRecords(host)
  res.json({ ok: true, enabled: nextEnabled, ...cleanup })
})

hostsRouter.post('/:id/duplicate', async (req, res) => {
  const host = await prisma.host.findUnique({ where: { id: Number(req.params.id) } })
  if (!host) {
    res.status(404).json({ error: 'Host not found.' })
    return
  }
  let suffix = 1
  let hostname = `${host.hostname}-copy`
  while (
    await prisma.host.findFirst({
      where: { zone: host.zone, hostname, recordType: host.recordType },
    })
  ) {
    suffix += 1
    hostname = `${host.hostname}-copy${suffix}`
  }
  const copy = await prisma.host.create({
    data: {
      zone: host.zone,
      hostname,
      recordType: host.recordType,
      proxied: host.proxied,
      ttl: host.ttl,
      description: host.description,
      enabled: false,
      tokenId: host.tokenId,
    },
  })
  res.json({ id: copy.id })
})

hostsRouter.post('/validate', async (req, res) => {
  const schema = z.object({
    tokenId: z.number().int(),
    zone: z.string().min(1),
    hostname: z.string().max(253),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid validation payload.' })
    return
  }
  const token = await prisma.apiToken.findUnique({ where: { id: parsed.data.tokenId } })
  if (!token) {
    res.status(400).json({ error: 'Token not found.' })
    return
  }
  const plain = decrypt(token.ciphertext)
  const tokenResult = await validateToken(plain)
  if (!tokenResult.valid) {
    res.json({ tokenValid: false, zoneExists: false, message: tokenResult.message, records: [] })
    return
  }
  const zone = await findZone(plain, parsed.data.zone)
  const fqdn = configService.fqdn(parsed.data.zone, parsed.data.hostname || '@')
  const records = zone ? await getRecords(plain, parsed.data.zone, fqdn) : []
  res.json({
    tokenValid: true,
    zoneExists: !!zone,
    fqdn,
    message: zone ? 'Token and zone valid.' : `Zone "${parsed.data.zone}" not found for this token.`,
    records,
  })
})

hostsRouter.post('/:id/test', async (req, res) => {
  const host = await prisma.host.findUnique({
    where: { id: Number(req.params.id) },
    include: { token: true },
  })
  if (!host) {
    res.status(404).json({ error: 'Host not found.' })
    return
  }
  const plain = decrypt(host.token.ciphertext)
  const fqdn = configService.fqdn(host.zone, host.hostname)
  const records = await getRecords(plain, host.zone, fqdn)
  res.json({ fqdn, records })
})

function safeDecrypt(ciphertext: string): string {
  try {
    return decrypt(ciphertext)
  } catch {
    return '????????'
  }
}

async function cleanupHostRecords(
  host: Host & { token: ApiToken },
): Promise<{ recordsDeleted?: number; cleanupErrors?: string[] }> {
  const setting = await prisma.setting.findUnique({ where: { key: 'deleteRecordsOnRemoval' } })
  if (setting?.value !== 'true') return {}

  try {
    const plain = decrypt(host.token.ciphertext)
    const name = configService.fqdn(host.zone, host.hostname)
    const result = await deleteRecordsForName(
      plain,
      host.zone,
      name,
      host.recordType as 'A' | 'AAAA' | 'BOTH',
    )
    return {
      recordsDeleted: result.deleted,
      ...(result.errors.length ? { cleanupErrors: result.errors } : {}),
    }
  } catch (err) {
    return { cleanupErrors: [err instanceof Error ? err.message : 'Cloudflare cleanup failed.'] }
  }
}
