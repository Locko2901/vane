import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db'
import { decrypt, encrypt, maskSecret } from '../crypto'
import { validateToken } from '../services/cloudflareService'

export const tokensRouter = Router()

const tokenSchema = z.object({
  name: z.string().min(1).max(64),
  token: z.string().min(10).max(512),
})

tokensRouter.get('/', async (_req, res) => {
  const tokens = await prisma.apiToken.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { hosts: true } } },
  })
  res.json(
    tokens.map((t) => ({
      id: t.id,
      name: t.name,
      masked: maskSecret(safeDecrypt(t.ciphertext)),
      lastValid: t.lastValid,
      lastChecked: t.lastChecked,
      hostCount: t._count.hosts,
    })),
  )
})

tokensRouter.post('/', async (req, res) => {
  const parsed = tokenSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Name and token are required.' })
    return
  }
  try {
    const created = await prisma.apiToken.create({
      data: { name: parsed.data.name, ciphertext: encrypt(parsed.data.token) },
    })
    res.json({ id: created.id, name: created.name })
  } catch {
    res.status(409).json({ error: 'A token with that name already exists.' })
  }
})

tokensRouter.patch('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const schema = z.object({ name: z.string().min(1).max(64).optional(), token: z.string().min(10).optional() })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload.' })
    return
  }
  const data: Record<string, unknown> = {}
  if (parsed.data.name) data.name = parsed.data.name
  if (parsed.data.token) data.ciphertext = encrypt(parsed.data.token)
  try {
    await prisma.apiToken.update({ where: { id }, data })
    res.json({ ok: true })
  } catch {
    res.status(404).json({ error: 'Token not found or name in use.' })
  }
})

tokensRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const hostCount = await prisma.host.count({ where: { tokenId: id } })
  if (hostCount > 0) {
    res.status(409).json({ error: `Token is used by ${hostCount} host(s). Reassign or delete them first.` })
    return
  }
  await prisma.apiToken.delete({ where: { id } }).catch(() => undefined)
  res.json({ ok: true })
})

tokensRouter.post('/:id/test', async (req, res) => {
  const id = Number(req.params.id)
  const token = await prisma.apiToken.findUnique({ where: { id } })
  if (!token) {
    res.status(404).json({ error: 'Token not found.' })
    return
  }
  const result = await validateToken(decrypt(token.ciphertext))
  await prisma.apiToken.update({
    where: { id },
    data: { lastValid: result.valid, lastChecked: new Date() },
  })
  res.json(result)
})

tokensRouter.post('/validate', async (req, res) => {
  const schema = z.object({ token: z.string().min(10) })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Token required.' })
    return
  }
  res.json(await validateToken(parsed.data.token))
})

function safeDecrypt(ciphertext: string): string {
  try {
    return decrypt(ciphertext)
  } catch {
    return '????????'
  }
}
