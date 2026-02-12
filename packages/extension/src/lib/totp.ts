export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512'
export type TotpDigits = 6 | 8

export interface ParsedTotpUri {
  secret: string
  issuer?: string
  algorithm: TotpAlgorithm
  digits: TotpDigits
  period: number
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function normalizeTotpSecret(secret: string): string {
  return secret.replace(/\s+/g, '').replace(/=+$/g, '').toUpperCase()
}

export function parseTotpUri(uri: string): ParsedTotpUri | null {
  try {
    const parsed = new URL(uri.trim())
    if (parsed.protocol !== 'otpauth:' || parsed.hostname.toLowerCase() !== 'totp') return null

    const rawSecret = parsed.searchParams.get('secret') || ''
    const secret = normalizeTotpSecret(rawSecret)
    if (!secret) return null

    const algorithmRaw = (parsed.searchParams.get('algorithm') || 'SHA1').toUpperCase()
    const algorithm: TotpAlgorithm =
      algorithmRaw === 'SHA256' ? 'SHA256'
      : algorithmRaw === 'SHA512' ? 'SHA512'
      : 'SHA1'

    const digitsRaw = Number(parsed.searchParams.get('digits') || '6')
    const digits: TotpDigits = digitsRaw === 8 ? 8 : 6

    const periodRaw = Number(parsed.searchParams.get('period') || '30')
    const period = Number.isFinite(periodRaw) && periodRaw > 0 ? Math.floor(periodRaw) : 30

    const issuerParam = parsed.searchParams.get('issuer') || undefined
    return {
      secret,
      issuer: issuerParam,
      algorithm,
      digits,
      period
    }
  } catch {
    return null
  }
}

function decodeBase32ToBytes(secret: string): Uint8Array {
  const cleaned = normalizeTotpSecret(secret)
  const output: number[] = []
  let bits = 0
  let value = 0

  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }

  return new Uint8Array(output)
}

export function getTotpRemainingSeconds(period: number, timestampMs = Date.now()): number {
  const nowSec = Math.floor(timestampMs / 1000)
  const rem = period - (nowSec % period)
  return rem === 0 ? period : rem
}

export async function generateTotpCode(
  secret: string,
  algorithm: TotpAlgorithm = 'SHA1',
  digits: TotpDigits = 6,
  period = 30,
  timestampMs = Date.now()
): Promise<string> {
  const keyBytes = decodeBase32ToBytes(secret)
  if (keyBytes.length === 0) throw new Error('Invalid TOTP secret')
  const keyBuffer = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer

  const counter = Math.floor(timestampMs / 1000 / period)
  const counterBuffer = new ArrayBuffer(8)
  const view = new DataView(counterBuffer)
  view.setUint32(0, Math.floor(counter / 0x100000000), false)
  view.setUint32(4, counter >>> 0, false)

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: { name: algorithm } },
    false,
    ['sign']
  )

  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, counterBuffer)
  const signature = new Uint8Array(signatureBuffer)
  const offset = signature[signature.length - 1] & 0x0f
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff)
  const otp = (binary % (10 ** digits)).toString().padStart(digits, '0')
  return otp
}
