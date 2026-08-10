import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

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
