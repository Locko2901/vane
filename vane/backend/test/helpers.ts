import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import Docker from 'dockerode'

export async function startTestServer(app: unknown): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer(app as never)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

export function overrideProperty<T extends object, K extends keyof T>(object: T, key: K, value: T[K]): () => void {
  const original = object[key]
  ;(object as Record<PropertyKey, unknown>)[key] = value
  return () => {
    (object as Record<PropertyKey, unknown>)[key] = original
  }
}

export function stubDocker(containers: Array<{ name: string; state: string; status: string }> = []): () => void {
  const notFound = Object.assign(new Error('no such container'), { statusCode: 404 })
  const restore = [
    overrideProperty(Docker.prototype, 'listContainers', (() => Promise.resolve(
      containers.map((c) => ({ Names: [`/${c.name}`], State: c.state, Status: c.status })),
    )) as never),
    overrideProperty(Docker.prototype, 'createContainer', (() => Promise.resolve({})) as never),
    overrideProperty(Docker.prototype, 'getContainer', (() => ({
      inspect: () => Promise.reject(notFound),
      start: () => Promise.resolve(),
    })) as never),
  ]
  return () => {
    for (const restoreOne of restore.reverse()) restoreOne()
  }
}
