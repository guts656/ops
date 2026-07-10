import crypto from 'crypto'
import { credentialEncryptionKey, jwtSecret, legacyCredentialEncryptionKeys } from '../config/env'

function keyFrom(value: string) {
  return crypto.createHash('sha256').update(value).digest()
}

function decryptionKeys() {
  return Array.from(new Set([credentialEncryptionKey, ...legacyCredentialEncryptionKeys, jwtSecret]))
}

export function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(credentialEncryptionKey), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return {
    encryptedSecret: encrypted.toString('base64'),
    secretIv: iv.toString('base64'),
    secretTag: cipher.getAuthTag().toString('base64'),
  }
}

export function decryptSecret(value: { encryptedSecret: string; secretIv: string; secretTag: string }) {
  let lastError: unknown
  for (const key of decryptionKeys()) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(key), Buffer.from(value.secretIv, 'base64'))
      decipher.setAuthTag(Buffer.from(value.secretTag, 'base64'))
      return Buffer.concat([decipher.update(Buffer.from(value.encryptedSecret, 'base64')), decipher.final()]).toString('utf8')
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}
