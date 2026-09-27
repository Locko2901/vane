import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db'
import * as configService from '../services/configService'
import { cleanupSrvRecord, normalizeHostname, syncSrvRecords, withSrvLock } from '../services/srvService'
import type { ApiToken, Prisma, SrvRecord } from '@prisma/client'

export const srvRouter = Router()

const LABEL = '[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?'
const DNS_NAME = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`, 'i')
const TARGET = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})+$`)
const SERVICE = /^[a-z0-9](?:[a-z0-9-]{0,13}[a-z0-9])?$/

const stripUnderscore = (value: string) => value.trim().replace(/^_/, '').toLowerCase()
const uint16 = z.number().int().min(0).max(65535)

const srvFields = {
  zone: z.string().trim().min(1).max(253).regex(DNS_NAME, 'must be a domain name'),
  hostname: z
    .string()
    .trim()
    .max(253)
    .transform((h) => (h === '' ? '@' : h))
    .refine((h) => h === '@' || DNS_NAME.test(h), 'must be "@" or a name inside the zone'),
  service: z
    .string()
    .transform(stripUnderscore)
    .pipe(z.string().regex(SERVICE, 'must be 1 to 15 characters of a-z, 0-9 and "-", not starting or ending with "-"')),
  proto: z.string().transform(stripUnderscore).pipe(z.enum(['tcp', 'udp', 'tls'])),
  priority: uint16,
  weight: uint16,
  port: z.number().int().min(1).max(65535),
  target: z.string().transform(normalizeHostname).pipe(z.string().regex(TARGET, 'must be a fully qualified hostname')),
  ttl: z.number().int().min(1).max(86400),
  description: z.string().max(500).nullable().optional(),
  enabled: z.boolean().optional(),
  tokenId: z.number().int(),
}

const createSchema = z.object({
  ...srvFields,
  priority: srvFields.priority.default(0),
  weight: srvFields.weight.default(0),
  ttl: srvFields.ttl.default(1),
})
const updateSchema = z.object(srvFields).partial()

const RECORD_FIELDS = ['zone', 'hostname', 'service', 'proto', 'priority', 'weight', 'port', 'target', 'ttl', 'tokenId'] as const

function invalid(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'Invalid SRV record payload.'
  return `Invalid SRV record payload: ${issue.path.length ? `${issue.path.join('.')}: ` : ''}${issue.message}.`
}

function parseId(raw: string): number | null {
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: unknown })?.code === 'P2002'
}

async function takenName(
  r: Pick<SrvRecord, 'zone' | 'hostname' | 'service' | 'proto'>,
  exceptId?: number,
): Promise<string | null> {
  const name = configService.srvName(r)
  const siblings = await prisma.srvRecord.findMany({ where: { service: r.service, proto: r.proto } })
  return siblings.some((o) => o.id !== exceptId && configService.srvName(o) === name) ? name : null
}

function toDto(r: SrvRecord & { token: ApiToken }) {
  return {
    id: r.id,
    zone: r.zone,
    hostname: r.hostname,
    fqdn: configService.srvName(r),
    service: r.service,
    proto: r.proto,
    priority: r.priority,
    weight: r.weight,
    port: r.port,
    target: r.target,
    ttl: r.ttl,
    description: r.description,
    enabled: r.enabled,
    tokenId: r.tokenId,
    tokenName: r.token.name,
    cfRecordId: r.cfRecordId,
    syncState: r.syncState,
    lastError: r.lastError,
    lastSyncedAt: r.lastSyncedAt,
  }
}

srvRouter.get('/', async (_req, res) => {
  const rows = await prisma.srvRecord.findMany({
    orderBy: [{ zone: 'asc' }, { hostname: 'asc' }, { service: 'asc' }, { proto: 'asc' }],
    include: { token: true },
  })
  res.json(rows.map(toDto))
})

srvRouter.post('/sync', async (_req, res) => {
  try {
    res.json(await syncSrvRecords())
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'SRV sync failed.' })
  }
})

srvRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: invalid(parsed.error) })
    return
  }
  const data = parsed.data
  const token = await prisma.apiToken.findUnique({ where: { id: data.tokenId } })
  if (!token) {
    res.status(400).json({ error: 'Selected API token does not exist.' })
    return
  }
  const taken = await takenName(data)
  if (taken) {
    res.status(409).json({ error: `An SRV record for ${taken} already exists.` })
    return
  }
  try {
    const created = await prisma.srvRecord.create({
      data: { ...data, description: data.description ?? null, enabled: data.enabled ?? true },
    })
    res.json({ id: created.id })
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    res.status(409).json({ error: `An SRV record for ${configService.srvName(data)} already exists.` })
  }
})

srvRouter.put('/:id', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: invalid(parsed.error) })
    return
  }
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(404).json({ error: 'SRV record not found.' })
    return
  }
  const patch = parsed.data

  await withSrvLock(async () => {
    const existing = await prisma.srvRecord.findUnique({ where: { id }, include: { token: true } })
    if (!existing) {
      res.status(404).json({ error: 'SRV record not found.' })
      return
    }
    if (patch.tokenId !== undefined && patch.tokenId !== existing.tokenId) {
      const token = await prisma.apiToken.findUnique({ where: { id: patch.tokenId } })
      if (!token) {
        res.status(400).json({ error: 'Selected API token does not exist.' })
        return
      }
    }
    const taken = await takenName({ ...existing, ...patch }, id)
    if (taken) {
      res.status(409).json({ error: `An SRV record for ${taken} already exists.` })
      return
    }

    const recordChanged = RECORD_FIELDS.some((k) => patch[k] !== undefined && patch[k] !== existing[k])
    const enabling = !existing.enabled && patch.enabled === true
    const disabling = existing.enabled && patch.enabled === false
    const leavingZone =
      existing.enabled && patch.zone !== undefined && patch.zone.toLowerCase() !== existing.zone.toLowerCase()

    const data: Prisma.SrvRecordUncheckedUpdateInput = { ...patch }
    if (recordChanged || enabling || disabling) {
      data.syncState = 'pending'
      data.lastError = null
    }
    if (disabling || leavingZone) data.cfRecordId = null
    try {
      await prisma.srvRecord.update({ where: { id }, data })
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
      res.status(409).json({ error: `An SRV record for ${configService.srvName({ ...existing, ...patch })} already exists.` })
      return
    }

    if (disabling || leavingZone) {
      const cleanup = await cleanupSrvRecord(existing)
      if (cleanup.cleanupErrors?.length) {
        console.warn(`[srv] Cleanup after editing SRV record #${id}:`, cleanup.cleanupErrors.join(' '))
      }
    }
    res.json({ ok: true })
  })
})

srvRouter.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.json({ ok: true })
    return
  }
  await withSrvLock(async () => {
    const row = await prisma.srvRecord.findUnique({ where: { id }, include: { token: true } })
    if (!row) {
      res.json({ ok: true })
      return
    }
    await prisma.srvRecord.delete({ where: { id } }).catch(() => undefined)
    const cleanup = await cleanupSrvRecord(row)
    res.json({ ok: true, ...cleanup })
  })
})

srvRouter.post('/:id/toggle', async (req, res) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(404).json({ error: 'SRV record not found.' })
    return
  }
  await withSrvLock(async () => {
    const row = await prisma.srvRecord.findUnique({ where: { id }, include: { token: true } })
    if (!row) {
      res.status(404).json({ error: 'SRV record not found.' })
      return
    }
    const nextEnabled = !row.enabled
    await prisma.srvRecord.update({
      where: { id },
      data: { enabled: nextEnabled, syncState: 'pending', lastError: null, ...(nextEnabled ? {} : { cfRecordId: null }) },
    })
    const cleanup = nextEnabled ? {} : await cleanupSrvRecord(row)
    res.json({ ok: true, enabled: nextEnabled, ...cleanup })
  })
})
