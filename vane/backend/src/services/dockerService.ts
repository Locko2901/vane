import Docker from 'dockerode'
import { config } from '../config'

const docker = new Docker({ socketPath: config.dockerSocket })

export type ContainerState = 'running' | 'stopped' | 'restarting' | 'paused' | 'exited' | 'missing' | 'unknown'

export interface ContainerStatus {
  exists: boolean
  state: ContainerState
  status: string
  startedAt?: string
  image?: string
}

export interface InstanceStatus {
  name: string
  tokenId: number | null
  exists: boolean
  state: ContainerState
  status: string
}

export interface InstanceResult {
  tokenId: number
  name: string
  recreated: boolean
  message: string
}

function baseContainer() {
  return docker.getContainer(config.ddnsContainer)
}

export function containerNameForToken(tokenId: number): string {
  return `${config.ddnsContainer}-t${tokenId}`
}

function parseTokenId(name: string): number | null {
  const prefix = `${config.ddnsContainer}-t`
  if (!name.startsWith(prefix)) return null
  const rest = name.slice(prefix.length)
  return /^\d+$/.test(rest) ? Number(rest) : null
}

interface TemplateSpec {
  image: string
  restartPolicy: Docker.HostRestartPolicy
  dns: string[]
  networks: string[]
}

async function getTemplateSpec(): Promise<TemplateSpec> {
  try {
    const info = await baseContainer().inspect()
    return {
      image: info.Config.Image || 'favonia/cloudflare-ddns:latest',
      restartPolicy: info.HostConfig.RestartPolicy ?? { Name: 'unless-stopped' },
      dns: info.HostConfig.Dns ?? [],
      networks: Object.keys(info.NetworkSettings.Networks ?? {}).slice(0, 1),
    }
  } catch {
    return {
      image: 'favonia/cloudflare-ddns:latest',
      restartPolicy: { Name: 'unless-stopped' },
      dns: ['1.1.1.1', '1.0.0.1'],
      networks: [],
    }
  }
}

function mapState(state: Docker.ContainerInspectInfo['State']): ContainerState {
  if (state.Running) return 'running'
  if (state.Restarting) return 'restarting'
  if (state.Paused) return 'paused'
  if (state.Status === 'exited') return 'exited'
  return 'stopped'
}

async function inspectStatus(name: string): Promise<ContainerStatus> {
  try {
    const info = await docker.getContainer(name).inspect()
    return {
      exists: true,
      state: mapState(info.State),
      status: info.State.Status,
      startedAt: info.State.StartedAt,
      image: info.Config.Image,
    }
  } catch (err: any) {
    if (err?.statusCode === 404) return { exists: false, state: 'missing', status: 'not found' }
    return { exists: false, state: 'unknown', status: err?.message ?? 'error' }
  }
}

export async function listManagedContainers(): Promise<InstanceStatus[]> {
  const list = await docker.listContainers({ all: true })
  const out: InstanceStatus[] = []
  for (const c of list) {
    const name = (c.Names?.[0] ?? '').replace(/^\//, '')
    if (!name.startsWith(`${config.ddnsContainer}-t`)) continue
    out.push({
      name,
      tokenId: parseTokenId(name),
      exists: true,
      state: (c.State as ContainerState) ?? 'unknown',
      status: c.Status ?? '',
    })
  }
  return out
}

async function removeContainer(name: string): Promise<void> {
  const container = docker.getContainer(name)
  try {
    const info = await container.inspect()
    if (info.State.Running) await container.stop({ t: 10 }).catch(() => undefined)
    await container.remove({ force: true })
  } catch (err: any) {
    if (err?.statusCode !== 404) throw err
  }
}

async function recreateInstance(
  tokenId: number,
  env: Record<string, string>,
  spec: TemplateSpec,
): Promise<InstanceResult> {
  const name = containerNameForToken(tokenId)
  try {
    await removeContainer(name)
    await docker.createContainer({
      name,
      Image: spec.image,
      Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
      Labels: {
        'vane.managed': 'true',
        'vane.token-id': String(tokenId),
      },
      HostConfig: {
        RestartPolicy: spec.restartPolicy,
        ...(spec.dns.length ? { Dns: spec.dns } : {}),
      },
      ...(spec.networks.length
        ? { NetworkingConfig: { EndpointsConfig: Object.fromEntries(spec.networks.map((n) => [n, {}])) } }
        : {}),
    })
    await docker.getContainer(name).start()
    return { tokenId, name, recreated: true, message: `${name} started.` }
  } catch (err: any) {
    return { tokenId, name, recreated: false, message: `${name}: ${err?.message ?? 'failed to start'}` }
  }
}

async function stopBase(): Promise<void> {
  try {
    const info = await baseContainer().inspect()
    if (info.State.Running) await baseContainer().stop({ t: 10 }).catch(() => undefined)
  } catch {
    // Ignore errors - container may not exist or may already be stopped. --- IGNORE ---
  }
}

export async function applyInstances(
  instances: Array<{ tokenId: number; env: Record<string, string> }>,
): Promise<{ results: InstanceResult[]; removed: string[] }> {
  const spec = await getTemplateSpec()
  const wanted = new Set(instances.map((i) => i.tokenId))

  const removed: string[] = []
  for (const managed of await listManagedContainers()) {
    if (managed.tokenId === null || !wanted.has(managed.tokenId)) {
      await removeContainer(managed.name)
      removed.push(managed.name)
    }
  }

  const results: InstanceResult[] = []
  for (const inst of instances) {
    results.push(await recreateInstance(inst.tokenId, inst.env, spec))
  }

  await stopBase()
  return { results, removed }
}

export async function stopAllManaged(): Promise<{ removed: string[]; message: string }> {
  const removed: string[] = []
  for (const managed of await listManagedContainers()) {
    await removeContainer(managed.name)
    removed.push(managed.name)
  }
  await stopBase()
  return {
    removed,
    message: removed.length
      ? `Stopped ${removed.length} DDNS instance(s) (no enabled hosts).`
      : 'No DDNS instances running (no enabled hosts).',
  }
}

export async function restartAllManaged(): Promise<number> {
  const managed = await listManagedContainers()
  await Promise.all(
    managed.map((c) => docker.getContainer(c.name).restart({ t: 10 }).catch(() => undefined)),
  )
  return managed.length
}

export async function getInstanceStatus(tokenId: number): Promise<ContainerStatus> {
  return inspectStatus(containerNameForToken(tokenId))
}

async function readLogs(name: string, tail: number): Promise<string> {
  try {
    const buf = await docker.getContainer(name).logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: true,
    })
    return demuxDockerLog(buf)
  } catch (err: any) {
    if (err?.statusCode === 404) return `Instance ${name} not found.`
    return `Unable to read logs for ${name}: ${err?.message ?? 'unknown error'}`
  }
}

export async function getInstanceLogs(tokenId: number, tail = 200): Promise<string> {
  return readLogs(containerNameForToken(tokenId), tail)
}

export async function getManagedInstanceLogs(name: string, tail = 200): Promise<string | null> {
  const managed = await listManagedContainers()
  if (!managed.some((c) => c.name === name)) return null
  return readLogs(name, tail)
}

export async function getAllLogs(tail = 200): Promise<string> {
  const managed = await listManagedContainers()
  if (managed.length === 0) return 'No DDNS instances running.'
  const sections = await Promise.all(
    managed.map(async (c) => {
      const text = await readLogs(c.name, tail)
      return `===== ${c.name} =====\n${text}`
    }),
  )
  return sections.join('\n')
}

export async function getContainerEnv(): Promise<Record<string, string> | null> {
  try {
    const info = await baseContainer().inspect()
    const env: Record<string, string> = {}
    for (const entry of info.Config.Env ?? []) {
      const idx = entry.indexOf('=')
      if (idx > 0) env[entry.slice(0, idx)] = entry.slice(idx + 1)
    }
    return env
  } catch {
    return null
  }
}

function demuxDockerLog(buf: Buffer): string {
  if (buf.length === 0) return ''
  const lines: string[] = []
  let offset = 0
  const looksMultiplexed = buf[1] === 0 && buf[2] === 0 && buf[3] === 0
  if (!looksMultiplexed) return buf.toString('utf8')
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset + 4)
    const start = offset + 8
    const end = start + len
    lines.push(buf.toString('utf8', start, end))
    offset = end
  }
  return lines.join('')
}
