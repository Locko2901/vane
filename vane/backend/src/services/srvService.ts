import { prisma } from '../db'
import { decrypt } from '../crypto'
import {
  createSrvRecord,
  deleteRecord,
  findZoneStrict,
  getDnsRecord,
  listSrvRecords,
  updateSrvRecord,
  type CfDnsRecord,
  type CfSrvData,
  type CfZone,
  type SrvRecordBody,
} from './cloudflareService'
import { srvName } from './configService'
import type { ApiToken, SrvRecord } from '@prisma/client'

type SrvRecordWithToken = SrvRecord & { token: ApiToken }

export interface SrvSyncSummary {
  created: number
  adopted: number
  updated: number
  unchanged: number
  failed: number
  errors: string[]
}

type SyncOutcome = 'created' | 'adopted' | 'updated' | 'unchanged'

export interface SrvCleanupResult {
  recordsDeleted?: number
  cleanupErrors?: string[]
}

export function emptySrvSummary(): SrvSyncSummary {
  return { created: 0, adopted: 0, updated: 0, unchanged: 0, failed: 0, errors: [] }
}

export function describeSrvSync(summary: SrvSyncSummary): string | null {
  const parts = (['created', 'adopted', 'updated', 'failed'] as const)
    .filter((key) => summary[key] > 0)
    .map((key) => `${summary[key]} ${key}`)
  return parts.length ? `SRV records: ${parts.join(', ')}.` : null
}

export function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '')
}

function sameHost(a: string, b: string): boolean {
  return normalizeHostname(a) === normalizeHostname(b)
}

export function srvDataOf(record: CfDnsRecord): CfSrvData | null {
  const d = record.data
  if (d && typeof d.port === 'number' && typeof d.target === 'string') {
    return { priority: d.priority ?? record.priority ?? 0, weight: d.weight ?? 0, port: d.port, target: d.target }
  }
  const fields = (record.content ?? '').trim().split(/\s+/)
  if (fields.length < 3 || fields.length > 4) return null
  const [weight, port, target] = fields.slice(-3)
  const priority = fields.length === 4 ? fields[0] : String(record.priority ?? 0)
  if (![priority, weight, port].every((n) => /^\d+$/.test(n))) return null
  return { priority: Number(priority), weight: Number(weight), port: Number(port), target }
}

export function formatSrvData(data: CfSrvData): string {
  return `${data.priority} ${data.weight} ${data.port} ${normalizeHostname(data.target)}`
}

function sameSrvData(a: CfSrvData, b: CfSrvData): boolean {
  return a.priority === b.priority && a.weight === b.weight && a.port === b.port && sameHost(a.target, b.target)
}

function desiredRecord(row: SrvRecord): SrvRecordBody {
  return {
    name: srvName(row),
    ttl: row.ttl,
    data: { priority: row.priority, weight: row.weight, port: row.port, target: row.target },
  }
}

function drifted(current: CfDnsRecord, want: SrvRecordBody): boolean {
  const data = srvDataOf(current)
  return !data || !sameHost(current.name, want.name) || current.ttl !== want.ttl || !sameSrvData(data, want.data)
}

async function getTrackedSrv(token: string, zoneId: string, recordId: string): Promise<CfDnsRecord | null> {
  const record = await getDnsRecord(token, zoneId, recordId)
  return record?.type === 'SRV' ? record : null
}

let queue: Promise<unknown> = Promise.resolve()

export function withSrvLock<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task)
  queue = run.catch(() => undefined)
  return run
}

export function syncSrvRecords(): Promise<SrvSyncSummary> {
  return withSrvLock(runSync)
}

async function runSync(): Promise<SrvSyncSummary> {
  const rows = (await prisma.srvRecord.findMany({
    where: { enabled: true },
    include: { token: true },
    orderBy: { id: 'asc' },
  })) as SrvRecordWithToken[]

  const byToken = new Map<number, SrvRecordWithToken[]>()
  for (const r of rows) {
    const group = byToken.get(r.tokenId) ?? []
    group.push(r)
    byToken.set(r.tokenId, group)
  }

  const summary = emptySrvSummary()
  for (const group of byToken.values()) {
    let apiToken: string | null
    try {
      apiToken = decrypt(group[0].token.ciphertext)
    } catch {
      apiToken = null
    }
    const zones = new Map<string, Promise<CfZone | null>>()

    for (const row of group) {
      const tracked = { id: row.cfRecordId }
      let outcome: SyncOutcome | null = null
      let error = ''
      try {
        if (apiToken === null) throw new Error(`Could not decrypt token "${group[0].token.name}".`)
        outcome = await syncRow(apiToken, row, zones, tracked)
      } catch (err) {
        error = err instanceof Error ? err.message : 'SRV sync failed.'
      }

      if (outcome) {
        summary[outcome] += 1
        await prisma.srvRecord.updateMany({
          where: { id: row.id },
          data: { cfRecordId: tracked.id, syncState: 'ok', lastError: null, lastSyncedAt: new Date() },
        })
      } else {
        summary.failed += 1
        summary.errors.push(`${srvName(row)}: ${error}`)
        await prisma.srvRecord.updateMany({
          where: { id: row.id },
          data: { cfRecordId: tracked.id, syncState: 'error', lastError: error },
        })
      }
    }
  }
  return summary
}

async function syncRow(
  token: string,
  row: SrvRecord,
  zones: Map<string, Promise<CfZone | null>>,
  tracked: { id: string | null },
): Promise<SyncOutcome> {
  let zoneLookup = zones.get(row.zone)
  if (!zoneLookup) {
    zoneLookup = findZoneStrict(token, row.zone)
    zones.set(row.zone, zoneLookup)
  }
  const zone = await zoneLookup
  if (!zone) throw new Error(`Zone "${row.zone}" not found for this token.`)

  const want = desiredRecord(row)

  if (tracked.id) {
    const current = await getTrackedSrv(token, zone.id, tracked.id)
    if (current) {
      if (!drifted(current, want)) return 'unchanged'
      if (!sameHost(current.name, want.name)) {
        const occupied = (await listSrvRecords(token, zone.id, want.name)).filter((r) => r.id !== current.id)
        if (occupied.length) {
          throw new Error(
            `Can't rename to ${want.name}: ${occupied.length} SRV record(s) already exist there; remove them in Cloudflare.`,
          )
        }
      }
      await updateSrvRecord(token, zone.id, current.id, want)
      return 'updated'
    }
    tracked.id = null
  }

  const existing = await listSrvRecords(token, zone.id, want.name)
  if (existing.length > 1) {
    throw new Error(`${existing.length} SRV records exist at ${want.name}; remove the extras in Cloudflare.`)
  }
  if (existing.length === 1) {
    tracked.id = existing[0].id
    if (drifted(existing[0], want)) await updateSrvRecord(token, zone.id, existing[0].id, want)
    return 'adopted'
  }

  const created = await createSrvRecord(token, zone.id, want, `vane srv #${row.id}`)
  tracked.id = created.id
  return 'created'
}

export async function cleanupSrvRecord(row: SrvRecordWithToken): Promise<SrvCleanupResult> {
  const setting = await prisma.setting.findUnique({ where: { key: 'deleteRecordsOnRemoval' } })
  if (setting?.value !== 'true') return {}

  const name = srvName(row)
  try {
    const token = decrypt(row.token.ciphertext)
    const zone = await findZoneStrict(token, row.zone)
    if (!zone) return { recordsDeleted: 0, cleanupErrors: [`Zone "${row.zone}" not found for this token.`] }

    let target = row.cfRecordId ? await getTrackedSrv(token, zone.id, row.cfRecordId) : null
    if (!target) {
      const found = await listSrvRecords(token, zone.id, name)
      if (found.length === 0) return { recordsDeleted: 0 }
      if (found.length > 1) {
        return {
          recordsDeleted: 0,
          cleanupErrors: [`Left ${found.length} SRV records at ${name} in place: Vane can't tell which one is its own.`],
        }
      }
      const data = srvDataOf(found[0])
      if (!data || !sameSrvData(data, desiredRecord(row).data)) {
        return {
          recordsDeleted: 0,
          cleanupErrors: [`Left the SRV record at ${name} in place: it doesn't match this row, so Vane can't prove it owns it.`],
        }
      }
      target = found[0]
    }

    const ok = await deleteRecord(token, zone.id, target.id)
    return ok ? { recordsDeleted: 1 } : { recordsDeleted: 0, cleanupErrors: [`Failed to delete SRV record ${name}.`] }
  } catch (err) {
    return { cleanupErrors: [err instanceof Error ? err.message : 'Cloudflare cleanup failed.'] }
  }
}
