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

export interface CfDnsRecord {
  id: string
  type: string
  name: string
  content: string
  proxied: boolean
  ttl: number
}

export class CloudflareNetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CloudflareNetworkError'
  }
}

async function cf<T>(
  token: string,
  pathname: string,
  init?: { method?: string; body?: unknown },
): Promise<CfResult<T>> {
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
    return (await res.json()) as CfResult<T>
  } catch (err) {
    const code = (err as { cause?: { code?: string } })?.cause?.code
    const reason = code ?? (err instanceof Error ? err.message : 'unknown')
    throw new CloudflareNetworkError(`Could not reach Cloudflare API (${reason}).`)
  } finally {
    clearTimeout(timer)
  }
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
