import crypto from 'crypto'

const ALGORITHM = 'aes-256-cbc'
const IV_LENGTH = 16

function getEncryptionKey(): Buffer {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET
  if (secret) {
    // Derive a 32-byte key from the secret using SHA-256
    return crypto.createHash('sha256').update(secret).digest()
  }
  // Fallback: derive from a hardcoded default (for dev only — production should set the env var)
  return crypto.createHash('sha256').update('sourcing-agent-default-key-change-me').digest()
}

export function encryptKey(plainText: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(plainText, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  // Prepend IV to ciphertext so we can decrypt later
  return iv.toString('hex') + ':' + encrypted
}

export function decryptKey(cipherText: string): string {
  const key = getEncryptionKey()
  const parts = cipherText.split(':')
  if (parts.length !== 2) {
    // Not encrypted — return as-is (migration scenario)
    return cipherText
  }
  const iv = Buffer.from(parts[0], 'hex')
  const encrypted = parts[1]
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

export function maskKey(plainText: string): string {
  if (!plainText || plainText.length < 8) return '••••••••'
  const visible = plainText.slice(-4)
  const masked = '•'.repeat(Math.min(plainText.length - 4, 20))
  return masked + visible
}
