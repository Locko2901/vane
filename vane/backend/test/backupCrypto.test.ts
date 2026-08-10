import assert from 'node:assert/strict'
import test from 'node:test'
import { decryptBackup, encryptBackup, MIN_PASSWORD_LENGTH } from '../src/backupCrypto'

const password = 'correct-horse-battery-staple'

void test('MIN_PASSWORD_LENGTH defines the accepted password boundary', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8)
})

void test('encryptBackup decrypts a Unicode backup payload', async () => {
  const plaintext = JSON.stringify({ version: 1, token: 'secret', label: 'DNS cafe' })

  const encrypted = await encryptBackup(plaintext, password)

  assert.equal(await decryptBackup(encrypted, password), plaintext)
  assert.notEqual(encrypted.subarray(0, 4).toString('utf8'), plaintext.slice(0, 4))
})

void test('decryptBackup rejects malformed and unsupported backup headers', async () => {
  await assert.rejects(decryptBackup(Buffer.alloc(0), password), /too small/)

  const unrecognized = Buffer.alloc(62)
  await assert.rejects(decryptBackup(unrecognized, password), /Unrecognized file format/)

  const unsupportedVersion = Buffer.alloc(62)
  unsupportedVersion.write('VANE', 0, 'ascii')
  unsupportedVersion.writeUInt8(2, 4)
  await assert.rejects(decryptBackup(unsupportedVersion, password), /Unsupported backup version 2/)

  const unsupportedKdf = Buffer.alloc(62)
  unsupportedKdf.write('VANE', 0, 'ascii')
  unsupportedKdf.writeUInt8(1, 4)
  unsupportedKdf.writeUInt8(2, 5)
  await assert.rejects(decryptBackup(unsupportedKdf, password), /Unsupported key-derivation function/)

  const unsupportedParameters = Buffer.alloc(62)
  unsupportedParameters.write('VANE', 0, 'ascii')
  unsupportedParameters.writeUInt8(1, 4)
  unsupportedParameters.writeUInt8(1, 5)
  unsupportedParameters.writeUInt32BE(1, 6)
  unsupportedParameters.writeUInt32BE(1, 10)
  unsupportedParameters.writeUInt32BE(1, 14)
  await assert.rejects(decryptBackup(unsupportedParameters, password), /unsupported key-derivation parameters/)
})

void test('decryptBackup detects incorrect passwords and corrupted backup contents', async () => {
  const encrypted = await encryptBackup('sensitive backup data', password)

  await assert.rejects(
    decryptBackup(encrypted, 'another-correct-password'),
    /Incorrect password or corrupted file/,
  )

  encrypted[encrypted.length - 1] ^= 0x01

  await assert.rejects(
    decryptBackup(encrypted, password),
    /Incorrect password or corrupted file/,
  )
})

void test('decryptBackup authenticates KDF parameters in the backup header', async () => {
  const encrypted = await encryptBackup('sensitive backup data', password)
  encrypted.writeUInt32BE(4, 10)

  await assert.rejects(
    decryptBackup(encrypted, password),
    /Incorrect password or corrupted file/,
  )
})
