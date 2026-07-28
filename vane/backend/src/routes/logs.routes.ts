import { Router } from 'express'
import { prisma } from '../db'
import {
  getAllLogs,
  getInstanceLogs,
  getManagedInstanceLogs,
  listManagedContainers,
  containerNameForToken,
} from '../services/dockerService'

export const logsRouter = Router()

function parseToken(value: unknown): number | null {
  if (typeof value !== 'string' || value === '' || value === 'all') return null
  const n = Number(value)
  return Number.isInteger(n) ? n : null
}

function filterLines(text: string, q: string): string {
  if (!q) return text
  return text
    .split('\n')
    .filter((l) => l.toLowerCase().includes(q))
    .join('\n')
}

async function resolveLogs(name: string | null, tokenId: number | null, tail: number): Promise<string> {
  if (name) {
    const text = await getManagedInstanceLogs(name, tail)
    return text ?? `Instance ${name} not found or not managed.`
  }
  if (tokenId !== null) return getInstanceLogs(tokenId, tail)
  return getAllLogs(tail)
}

logsRouter.get('/containers', async (_req, res) => {
  const managed = await listManagedContainers()
  const tokens = await prisma.apiToken.findMany({ select: { id: true, name: true } })
  const nameById = new Map(tokens.map((t) => [t.id, t.name]))
  res.json(
    managed.map((c) => ({
      name: c.name,
      tokenId: c.tokenId,
      tokenName: c.tokenId !== null ? nameById.get(c.tokenId) ?? null : null,
      state: c.state,
    })),
  )
})

logsRouter.get('/', async (req, res) => {
  const tail = Math.min(Math.max(Number(req.query.tail ?? 200) || 200, 1), 2000)
  const q = typeof req.query.q === 'string' ? req.query.q.toLowerCase() : ''
  const name = typeof req.query.name === 'string' ? req.query.name : null
  const tokenId = parseToken(req.query.token)
  const text = await resolveLogs(name, tokenId, tail)
  res.json({ logs: filterLines(text, q) })
})

logsRouter.get('/download', async (req, res) => {
  const name = typeof req.query.name === 'string' ? req.query.name : null
  const tokenId = parseToken(req.query.token)
  const text = await resolveLogs(name, tokenId, 2000)
  let filename = 'cloudflare-ddns.log'
  if (name) filename = `${name}.log`
  else if (tokenId !== null) filename = `${containerNameForToken(tokenId)}.log`
  res.setHeader('Content-Type', 'text/plain')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(text)
})
