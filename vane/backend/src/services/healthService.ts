import { prisma } from '../db'
import { decrypt } from '../crypto'
import * as dockerService from './dockerService'
import { listZoneRecords, verifyTokenOnly, CloudflareNetworkError, type CfDnsRecord } from './cloudflareService'
import { fqdn } from './configService'

export async function getPublicIPv4(): Promise<string | null> {
  return tracedIp('https://1.1.1.1/cdn-cgi/trace')
}

export async function getPublicIPv6(): Promise<string | null> {
  return tracedIp('https://[2606:4700:4700::1111]/cdn-cgi/trace')
}

async function tracedIp(url: string): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    const text = await res.text()
    const match = text.split('\n').find((l) => l.startsWith('ip='))
    return match ? match.slice(3) : null
  } catch {
    return null
  }
}

export interface ContainerHealth {
  name: string
  tokenId: number | null
  tokenName: string | null
  exists: boolean
  state: dockerService.ContainerState
  status: string
}

export interface HealthReport {
  containers: ContainerHealth[]
  publicIPv4: string | null
  publicIPv6: string | null
  domainCount: number
  banners: Array<{ level: 'ok' | 'warn' | 'error'; message: string }>
  records: Array<{
    hostname: string
    type: string
    expected: string | null
    cloudflareValue: string | null
    updateNeeded: boolean
  }>
}

async function buildContainerHealth(
  tokens: Array<{ id: number; name: string }>,
): Promise<ContainerHealth[]> {
  const managed = await dockerService.listManagedContainers()
  const byTokenId = new Map(managed.map((m) => [m.tokenId, m]))
  const seen = new Set<number>()

  const fromTokens: ContainerHealth[] = tokens.map((t) => {
    seen.add(t.id)
    const m = byTokenId.get(t.id)
    return {
      name: dockerService.containerNameForToken(t.id),
      tokenId: t.id,
      tokenName: t.name,
      exists: !!m,
      state: m?.state ?? 'missing',
      status: m?.status ?? 'not created',
    }
  })

  const orphans: ContainerHealth[] = managed
    .filter((m) => m.tokenId === null || !seen.has(m.tokenId))
    .map((m) => ({
      name: m.name,
      tokenId: m.tokenId,
      tokenName: null,
      exists: true,
      state: m.state,
      status: m.status,
    }))

  return [...fromTokens, ...orphans]
}

export async function getHealth(): Promise<HealthReport> {
  const hosts = await prisma.host.findMany({
    where: { enabled: true },
    include: { token: true },
    orderBy: [{ zone: 'asc' }, { hostname: 'asc' }, { recordType: 'asc' }],
  })
  const needsIPv6 = hosts.some((h) => h.recordType === 'AAAA' || h.recordType === 'BOTH')

  const tokensWithHosts = [...new Map(hosts.map((h) => [h.tokenId, h.token.name])).entries()].map(
    ([id, name]) => ({ id, name }),
  )

  const [containers, publicIPv4, publicIPv6, domainCount] = await Promise.all([
    buildContainerHealth(tokensWithHosts),
    getPublicIPv4(),
    needsIPv6 ? getPublicIPv6() : Promise.resolve<string | null>(null),
    prisma.host.count({ where: { enabled: true } }),
  ])

  const banners: HealthReport['banners'] = []
  const expected = containers.filter((c) => c.tokenName !== null)
  const notRunning = expected.filter((c) => c.state !== 'running')
  if (expected.length > 0 && expected.some((c) => !c.exists)) {
    banners.push({
      level: 'warn',
      message: 'One or more DDNS instances are not created yet. Click "Save & Restart DDNS" to launch them.',
    })
  } else if (expected.length > 0 && notRunning.length > 0) {
    banners.push({
      level: 'warn',
      message: `${notRunning.length} DDNS instance(s) are not running.`,
    })
  }
  const orphanRunning = containers.filter((c) => c.tokenName === null)
  if (orphanRunning.length > 0) {
    banners.push({
      level: 'warn',
      message: `${orphanRunning.length} DDNS instance(s) belong to removed tokens. Apply to clean them up.`,
    })
  }

  let authFailed = false
  let networkIssue = false

  const distinctTokens = new Map<number, string>()
  for (const h of hosts) distinctTokens.set(h.tokenId, h.token.ciphertext)
  const tokenStatus = new Map<number, 'ok' | 'auth' | 'network'>()
  await Promise.all(
    [...distinctTokens.entries()].map(async ([tokenId, ciphertext]) => {
      try {
        const result = await verifyTokenOnly(decrypt(ciphertext))
        if (result.valid) {tokenStatus.set(tokenId, 'ok')}
        else if (result.networkError) {
          tokenStatus.set(tokenId, 'network')
          networkIssue = true
        } else {
          tokenStatus.set(tokenId, 'auth')
          authFailed = true
        }
      } catch {
        tokenStatus.set(tokenId, 'network')
        networkIssue = true
      }
    }),
  )

  const zoneRecords = new Map<string, Promise<CfDnsRecord[]>>()
  const recordsForZone = (h: (typeof hosts)[number]): Promise<CfDnsRecord[]> => {
    const key = `${h.tokenId}:${h.zone}`
    let pending = zoneRecords.get(key)
    if (!pending) {
      pending = listZoneRecords(decrypt(h.token.ciphertext), h.zone)
      zoneRecords.set(key, pending)
    }
    return pending
  }

  const records = await Promise.all(
    hosts.map(async (h): Promise<HealthReport['records'][number]> => {
      const name = fqdn(h.zone, h.hostname)
      const wantType = h.recordType === 'BOTH' ? 'A' : h.recordType
      const expected = wantType === 'A' ? publicIPv4 : publicIPv6
      if (tokenStatus.get(h.tokenId) !== 'ok') {
        return { hostname: name, type: wantType, expected, cloudflareValue: null, updateNeeded: false }
      }
      try {
        const cfRecords = await recordsForZone(h)
        const match = cfRecords.find((r) => r.type === wantType && r.name.toLowerCase() === name.toLowerCase())
        return {
          hostname: name,
          type: wantType,
          expected,
          cloudflareValue: match?.content ?? null,
          updateNeeded: !!expected && match?.content !== expected,
        }
      } catch (err) {
        if (err instanceof CloudflareNetworkError) networkIssue = true
        return { hostname: name, type: wantType, expected, cloudflareValue: null, updateNeeded: false }
      }
    }),
  )

  if (authFailed) {
    banners.push({ level: 'error', message: 'Cloudflare authentication failed for one or more hosts.' })
  }
  if (networkIssue) {
    banners.push({
      level: 'warn',
      message: 'Could not reach the Cloudflare API (network/DNS/timeout). Health data may be incomplete.',
    })
  }
  if (banners.length === 0) {
    banners.push({ level: 'ok', message: 'Everything healthy.' })
  }

  return { containers, publicIPv4, publicIPv6, domainCount, banners, records }
}
