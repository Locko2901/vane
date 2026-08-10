import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vane-crypto-'))

function loadCrypto() {
  return import('../src/crypto')
}

void test('encrypt decrypts a Unicode plaintext and uses distinct ciphertexts', async () => {
  const { decrypt, encrypt } = await loadCrypto()
  const plaintext = 'Cloudflare token: secret cafe'
  const first = encrypt(plaintext)
  const second = encrypt(plaintext)

  assert.equal(decrypt(first), plaintext)
  assert.equal(decrypt(second), plaintext)
  assert.notEqual(first, second)
})

void test('decrypt rejects malformed ciphertext payloads', async () => {
  const { decrypt } = await loadCrypto()
  assert.throws(() => decrypt('not-a-valid-payload'), /Malformed ciphertext payload/)
})

void test('maskSecret masks short secrets completely', async () => {
  const { maskSecret } = await loadCrypto()
  assert.equal(maskSecret('short'), '*****')
  assert.equal(maskSecret('12345678'), '********')
})

void test('maskSecret preserves only the expected edges of long secrets', async () => {
  const { maskSecret } = await loadCrypto()
  assert.equal(maskSecret('abcdefghijklmnop'), 'abcd********klmnop')
  assert.equal(maskSecret('abcdefghijklmnopqrst'), 'abcd**********opqrst')
})
