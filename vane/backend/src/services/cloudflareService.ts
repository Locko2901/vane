const CF_BASE = 'https://api.cloudflare.com/client/v4'

export interface CfResult<T> {
  success: boolean
  errors: Array<{ code: number; message: string }>
  result: T
  result_info?: { page: number; total_pages: number }
}

export interface CfZone {
  id: string
  name: string
  status: string
}

export interface CfSrvData {
  priority: number
  weight: number
  port: number
  target: string
}

export interface CfDnsRecord {
  id: string
  type: string
  name: string
  content: string
  proxied: boolean
  ttl: number
  priority?: number
  data?: Partial<CfSrvData>
}

export class CloudflareNetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CloudflareNetworkError'
  }
}

export class CloudflareApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'CloudflareApiError'
    this.status = status
  }
}

const RECORD_NOT_FOUND = 81044

interface CfResponse<T> {
  status: number
  body: CfResult<T>
}

async function cfRequest<T>(
  token: string,
  pathname: string,
  init?: { method?: string; body?: unknown },
): Promise<CfResponse<T>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(`${CF_BASE}${pathname}`, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    })
    return { status: res.status, body: (await res.json()) as CfResult<T> }
  } catch (err) {
    const code = (err as { cause?: { code?: string } })?.cause?.code
    const reason = code ?? (err instanceof Error ? err.message : 'unknown')
    throw new CloudflareNetworkError(`Could not reach Cloudflare API (${reason}).`)
  } finally {
    clearTimeout(timer)
  }
}

async function cf<T>(
  token: string,
  pathname: string,
  init?: { method?: string; body?: unknown },
): Promise<CfResult<T>> {
  return (await cfRequest<T>(token, pathname, init)).body
}

function apiError(res: CfResponse<unknown>, fallback: string): CloudflareApiError {
  const detail = res.body?.errors?.map((e) => `${e.message} (${e.code})`).join('; ')
  return new CloudflareApiError(detail || fallback, res.status)
}

async function cfStrict<T>(
  token: string,
  pathname: string,
  fallback: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await cfRequest<T>(token, pathname, init)
  if (!res.body?.success) throw apiError(res, fallback)
  return res.body.result
}

export interface TokenValidation {
  valid: boolean
  networkError: boolean
  status?: string
  zonesAccessible: boolean
  zones: CfZone[]
  message: string
}

export async function validateToken(token: string): Promise<TokenValidation> {
  try {
    const verify = await cf<{ id: string; status: string }>(token, '/user/tokens/verify')
    if (!verify.success) {
      return {
        valid: false,
        networkError: false,
        zonesAccessible: false,
        zones: [],
        message: verify.errors?.[0]?.message ?? 'Token verification failed.',
      }
    }
    const zonesRes = await cf<CfZone[]>(token, '/zones?per_page=50')
    return {
      valid: true,
      networkError: false,
      status: verify.result.status,
      zonesAccessible: zonesRes.success,
      zones: zonesRes.success ? zonesRes.result : [],
      message: zonesRes.success ? 'Token valid, zone list accessible, permissions OK.' : 'Token valid but zone list not accessible.',
    }
  } catch (err) {
    const networkError = err instanceof CloudflareNetworkError
    return {
      valid: false,
      networkError,
      zonesAccessible: false,
      zones: [],
      message: err instanceof Error ? err.message : 'Network error contacting Cloudflare.',
    }
  }
}

export async function findZone(token: string, zoneName: string): Promise<CfZone | null> {
  const res = await cf<CfZone[]>(token, `/zones?name=${encodeURIComponent(zoneName)}`)
  return res.success && res.result.length > 0 ? res.result[0] : null
}

export interface TokenVerification {
  valid: boolean
  networkError: boolean
}

export async function verifyTokenOnly(token: string): Promise<TokenVerification> {
  try {
    const verify = await cf<{ id: string; status: string }>(token, '/user/tokens/verify')
    return { valid: verify.success, networkError: false }
  } catch (err) {
    return { valid: false, networkError: err instanceof CloudflareNetworkError }
  }
}

export async function getRecords(
  token: string,
  zoneName: string,
  fqdn: string,
): Promise<CfDnsRecord[]> {
  const zone = await findZone(token, zoneName)
  if (!zone) return []
  const res = await cf<CfDnsRecord[]>(
    token,
    `/zones/${zone.id}/dns_records?name=${encodeURIComponent(fqdn)}`,
  )
  return res.success ? res.result : []
}

export async function listZoneRecords(token: string, zoneName: string): Promise<CfDnsRecord[]> {
  const zone = await findZone(token, zoneName)
  if (!zone) return []
  const records: CfDnsRecord[] = []
  for (let page = 1; ; page++) {
    const res = await cf<CfDnsRecord[]>(token, `/zones/${zone.id}/dns_records?per_page=100&page=${page}`)
    if (!res.success) return records
    records.push(...res.result)
    if (page >= (res.result_info?.total_pages ?? 1)) return records
  }
}

export async function findZoneStrict(token: string, zoneName: string): Promise<CfZone | null> {
  const zones = await cfStrict<CfZone[]>(
    token,
    `/zones?name=${encodeURIComponent(zoneName)}`,
    `Failed to look up zone "${zoneName}".`,
  )
  return zones[0] ?? null
}

export async function getDnsRecord(token: string, zoneId: string, recordId: string): Promise<CfDnsRecord | null> {
  const res = await cfRequest<CfDnsRecord>(token, `/zones/${zoneId}/dns_records/${encodeURIComponent(recordId)}`)
  if (res.body?.success) return res.body.result
  if (res.status === 404 || res.body?.errors?.some((e) => e.code === RECORD_NOT_FOUND)) return null
  throw apiError(res, `Failed to read DNS record ${recordId}.`)
}

export async function listSrvRecords(token: string, zoneId: string, name: string): Promise<CfDnsRecord[]> {
  return cfStrict<CfDnsRecord[]>(
    token,
    `/zones/${zoneId}/dns_records?type=SRV&name=${encodeURIComponent(name)}`,
    `Failed to list SRV records at ${name}.`,
  )
}

export interface SrvRecordBody {
  name: string
  ttl: number
  data: CfSrvData
}

export async function createSrvRecord(
  token: string,
  zoneId: string,
  record: SrvRecordBody,
  comment: string,
): Promise<CfDnsRecord> {
  return cfStrict<CfDnsRecord>(token, `/zones/${zoneId}/dns_records`, `Failed to create SRV record ${record.name}.`, {
    method: 'POST',
    body: { type: 'SRV', name: record.name, ttl: record.ttl, data: record.data, comment },
  })
}

export async function updateSrvRecord(
  token: string,
  zoneId: string,
  recordId: string,
  record: SrvRecordBody,
): Promise<CfDnsRecord> {
  return cfStrict<CfDnsRecord>(
    token,
    `/zones/${zoneId}/dns_records/${encodeURIComponent(recordId)}`,
    `Failed to update SRV record ${record.name}.`,
    { method: 'PATCH', body: { type: 'SRV', name: record.name, ttl: record.ttl, data: record.data } },
  )
}

export async function deleteRecord(token: string, zoneId: string, recordId: string): Promise<boolean> {
  const res = await cf<{ id: string }>(token, `/zones/${zoneId}/dns_records/${recordId}`, {
    method: 'DELETE',
  })
  return res.success
}

export interface RecordCleanupResult {
  deleted: number
  errors: string[]
}

export async function deleteRecordsForName(
  token: string,
  zoneName: string,
  fqdn: string,
  recordType: 'A' | 'AAAA' | 'BOTH',
): Promise<RecordCleanupResult> {
  const zone = await findZone(token, zoneName)
  if (!zone) return { deleted: 0, errors: [`Zone "${zoneName}" not found for this token.`] }

  const wantTypes = recordType === 'BOTH' ? ['A', 'AAAA'] : [recordType]
  const res = await cf<CfDnsRecord[]>(
    token,
    `/zones/${zone.id}/dns_records?name=${encodeURIComponent(fqdn)}`,
  )
  if (!res.success) {
    return { deleted: 0, errors: res.errors?.map((e) => e.message) ?? ['Failed to list DNS records.'] }
  }

  const targets = res.result.filter((r) => wantTypes.includes(r.type))
  let deleted = 0
  const errors: string[] = []
  for (const rec of targets) {
    const ok = await deleteRecord(token, zone.id, rec.id)
    if (ok) deleted += 1
    else errors.push(`Failed to delete ${rec.type} record for ${rec.name}.`)
  }
  return { deleted, errors }
}

export async function setProxied(
  token: string,
  zoneId: string,
  recordId: string,
  proxied: boolean,
): Promise<boolean> {
  const res = await cf<CfDnsRecord>(token, `/zones/${zoneId}/dns_records/${recordId}`, {
    method: 'PATCH',
    body: { proxied },
  })
  return res.success
}

export interface ProxySyncResult {
  changed: number
  errors: string[]
}

export async function syncProxiedForName(
  token: string,
  zoneName: string,
  fqdn: string,
  recordType: 'A' | 'AAAA' | 'BOTH',
  proxied: boolean,
): Promise<ProxySyncResult> {
  const zone = await findZone(token, zoneName)
  if (!zone) return { changed: 0, errors: [`Zone "${zoneName}" not found for this token.`] }

  const wantTypes = recordType === 'BOTH' ? ['A', 'AAAA'] : [recordType]
  const res = await cf<CfDnsRecord[]>(
    token,
    `/zones/${zone.id}/dns_records?name=${encodeURIComponent(fqdn)}`,
  )
  if (!res.success) {
    return { changed: 0, errors: res.errors?.map((e) => e.message) ?? ['Failed to list DNS records.'] }
  }

  const drifted = res.result.filter((r) => wantTypes.includes(r.type) && r.proxied !== proxied)
  let changed = 0
  const errors: string[] = []
  for (const rec of drifted) {
    const ok = await setProxied(token, zone.id, rec.id, proxied)
    if (ok) changed += 1
    else errors.push(`Failed to set proxied=${proxied} on ${rec.type} record for ${rec.name}.`)
  }
  return { changed, errors }
}
