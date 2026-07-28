import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { paths } from './config'

const ALGO = 'aes-256-gcm'
let keyCache: Buffer | null = null

function getKey(): Buffer {
  if (keyCache) return keyCache
  const file = paths.secretKeyFile()
  if (fs.existsSync(file)) {
    keyCache = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex')
  } else {
    const key = crypto.randomBytes(32)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, key.toString('hex'), { mode: 0o600 })
    keyCache = key
  }
  if (keyCache.length !== 32) {
    throw new Error('Invalid encryption key length; expected 32 bytes.')
  }
  return keyCache
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':')
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(':')
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed ciphertext payload.')
  }
  const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

export function maskSecret(secret: string): string {
  if (secret.length <= 8) return '*'.repeat(secret.length)
  return `${secret.slice(0, 4)}${'*'.repeat(Math.max(8, secret.length - 10))}${secret.slice(-6)}`
}
