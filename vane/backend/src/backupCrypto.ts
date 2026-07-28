import crypto from 'node:crypto'
import { argon2id } from 'hash-wasm'

// Encrypted backup binary format (v1):
//   [4B magic "VANE"][1B version][1B KDF id][4B mem_cost][4B iterations][4B parallelism]
//   [16B salt][12B nonce][ciphertext || 16B GCM auth tag]
// The full 18-byte header is authenticated as AES-GCM AAD, so tampering with the
// version byte or KDF parameters (e.g. lowering the memory cost) fails decryption.

const MAGIC = Buffer.from('VANE', 'ascii')
const VERSION = 1
const KDF_ARGON2ID = 1

const ARGON2 = {
  memCost: 131072, // 128 MiB, in KiB
  iterations: 3,
  parallelism: 4,
}

const HEADER_LEN = 18
const SALT_LEN = 16
const NONCE_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32

const LIMITS = {
  memCost: { min: 8192, max: 262144 }, // 8 MiB .. 256 MiB (in KiB)
  iterations: { min: 1, max: 10 },
  parallelism: { min: 1, max: 8 },
}

export const MIN_PASSWORD_LENGTH = 8

function buildHeader(memCost: number, iterations: number, parallelism: number): Buffer {
  const header = Buffer.alloc(HEADER_LEN)
  MAGIC.copy(header, 0)
  header.writeUInt8(VERSION, 4)
  header.writeUInt8(KDF_ARGON2ID, 5)
  header.writeUInt32BE(memCost, 6)
  header.writeUInt32BE(iterations, 10)
  header.writeUInt32BE(parallelism, 14)
  return header
}

async function deriveKey(
  password: string,
  salt: Buffer,
  memCost: number,
  iterations: number,
  parallelism: number,
): Promise<Buffer> {
  const key = await argon2id({
    password,
    salt,
    parallelism,
    iterations,
    memorySize: memCost,
    hashLength: KEY_LEN,
    outputType: 'binary',
  })
  return Buffer.from(key)
}

export async function encryptBackup(plaintext: string, password: string): Promise<Buffer> {
  const salt = crypto.randomBytes(SALT_LEN)
  const nonce = crypto.randomBytes(NONCE_LEN)
  const header = buildHeader(ARGON2.memCost, ARGON2.iterations, ARGON2.parallelism)
  const key = await deriveKey(password, salt, ARGON2.memCost, ARGON2.iterations, ARGON2.parallelism)

  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(header)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return Buffer.concat([header, salt, nonce, enc, tag])
}

export async function decryptBackup(blob: Buffer, password: string): Promise<string> {
  if (blob.length < HEADER_LEN + SALT_LEN + NONCE_LEN + TAG_LEN) {
    throw new Error('File is too small to be a valid backup.')
  }

  const header = blob.subarray(0, HEADER_LEN)
  if (!header.subarray(0, 4).equals(MAGIC)) {
    throw new Error('Unrecognized file format.')
  }
  const version = header.readUInt8(4)
  if (version !== VERSION) {
    throw new Error(`Unsupported backup version ${version}.`)
  }
  const kdfId = header.readUInt8(5)
  if (kdfId !== KDF_ARGON2ID) {
    throw new Error('Unsupported key-derivation function.')
  }
  const memCost = header.readUInt32BE(6)
  const iterations = header.readUInt32BE(10)
  const parallelism = header.readUInt32BE(14)

  if (
    memCost < LIMITS.memCost.min ||
    memCost > LIMITS.memCost.max ||
    iterations < LIMITS.iterations.min ||
    iterations > LIMITS.iterations.max ||
    parallelism < LIMITS.parallelism.min ||
    parallelism > LIMITS.parallelism.max
  ) {
    throw new Error('Backup uses unsupported key-derivation parameters.')
  }

  let offset = HEADER_LEN
  const salt = blob.subarray(offset, offset + SALT_LEN)
  offset += SALT_LEN
  const nonce = blob.subarray(offset, offset + NONCE_LEN)
  offset += NONCE_LEN
  const tag = blob.subarray(blob.length - TAG_LEN)
  const ciphertext = blob.subarray(offset, blob.length - TAG_LEN)

  const key = await deriveKey(password, salt, memCost, iterations, parallelism)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAAD(header)
  decipher.setAuthTag(tag)

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('Incorrect password or corrupted file.')
  }
}
