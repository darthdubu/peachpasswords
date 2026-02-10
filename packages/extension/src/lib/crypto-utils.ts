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