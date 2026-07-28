export interface ApiTokenDTO {
  id: number
  name: string
  masked: string
  lastValid: boolean | null
  lastChecked: string | null
  hostCount: number
}

export interface HostDTO {
  id: number
  zone: string
  hostname: string
  fqdn: string
  recordType: 'A' | 'AAAA' | 'BOTH'
  proxied: boolean
  ttl: number
  description: string | null
  enabled: boolean
  tokenId: number
  tokenName: string
  tokenMasked: string
}

export interface CfRecord {
  id: string
  type: string
  name: string
  content: string
  proxied: boolean
  ttl: number
}

export interface ContainerHealth {
  name: string
  tokenId: number | null
  tokenName: string | null
  exists: boolean
  state: string
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
