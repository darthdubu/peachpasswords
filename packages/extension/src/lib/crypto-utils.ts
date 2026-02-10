// Crypto utilities wrapper
import { deriveKeyFromPassword, encrypt, decrypt, deriveSubKey } from './crypto'

export { deriveKeyFromPassword, encrypt, decrypt, deriveSubKey }

export async function generateSalt(): Promise<Uint8Array> {
  return crypto.getRandomValues(new Uint8Array(32))
}

export async function generateIV(): Promise<Uint8Array> {
  return crypto.getRandomValues(new Uint8Array(12))
}

export function bufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
}

export function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

// LOTUS-004: Encrypt sensitive settings using master key
export interface EncryptedSettings {
  iv: string
  ciphertext: string
}

export async function encryptSettings(
  masterKey: CryptoKey,
  settings: Record<string, string>
): Promise<EncryptedSettings> {
  const settingsKey = await deriveSubKey(masterKey, 'settings-encryption', ['encrypt', 'decrypt'])
  const data = new TextEncoder().encode(JSON.stringify(settings))
  const encrypted = await encrypt(settingsKey, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
  const iv = encrypted.slice(0, 12)
  const ciphertext = encrypted.slice(12)
  return {
    iv: bufferToBase64(iv),
    ciphertext: bufferToBase64(ciphertext)
  }
}

export async function decryptSettings(
  masterKey: CryptoKey,
  encrypted: EncryptedSettings
): Promise<Record<string, string> | null> {
  try {
    const settingsKey = await deriveSubKey(masterKey, 'settings-encryption', ['encrypt', 'decrypt'])
    const iv = base64ToBuffer(encrypted.iv)
    const ciphertext = base64ToBuffer(encrypted.ciphertext)
    const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength)
    combined.set(new Uint8Array(iv), 0)
    combined.set(new Uint8Array(ciphertext), iv.byteLength)
    const decrypted = await decrypt(settingsKey, combined.buffer)
    return JSON.parse(new TextDecoder().decode(decrypted))
  } catch {
    return null
  }
}