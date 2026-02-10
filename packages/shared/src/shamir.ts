export interface Share {
  index: number
  value: string
}

function bufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

export function generateShares(secret: Uint8Array, totalShares: number, threshold: number): Share[] {
  if (threshold < 2) throw new Error('Threshold must be at least 2')
  if (threshold > totalShares) throw new Error('Threshold cannot exceed total shares')
  if (secret.length === 0) throw new Error('Secret cannot be empty')

  const shares: Share[] = []
  const coeffs: Uint8Array[] = []

  coeffs.push(secret)
  for (let i = 1; i < threshold; i++) {
    coeffs.push(crypto.getRandomValues(new Uint8Array(secret.length)))
  }

  for (let x = 1; x <= totalShares; x++) {
    const y = new Uint8Array(secret.length)
    for (let i = 0; i < secret.length; i++) {
      let sum = 0
      for (let j = 0; j < threshold; j++) {
        sum = gf256Add(sum, gf256Mul(coeffs[j][i], gf256Pow(x, j)))
      }
      y[i] = sum
    }
    shares.push({
      index: x,
      value: bufferToBase64(y.buffer),
    })
  }

  secureWipeCoeffs(coeffs)
  return shares
}

export function reconstructSecret(shares: Share[]): Uint8Array {
  if (shares.length < 2) throw new Error('Need at least 2 shares')

  const length = base64ToBuffer(shares[0].value).byteLength
  const secret = new Uint8Array(length)

  for (let i = 0; i < length; i++) {
    let sum = 0
    for (const share of shares) {
      const y = new Uint8Array(base64ToBuffer(share.value))[i]
      let numerator = 1
      let denominator = 1

      for (const other of shares) {
        if (other.index !== share.index) {
          numerator = gf256Mul(numerator, other.index)
          denominator = gf256Mul(denominator, gf256Add(share.index, other.index))
        }
      }

      sum = gf256Add(sum, gf256Mul(y, gf256Div(numerator, denominator)))
    }
    secret[i] = sum
  }

  return secret
}

function gf256Add(a: number, b: number): number {
  return a ^ b
}

function gf256Mul(a: number, b: number): number {
  let result = 0
  for (let i = 0; i < 8; i++) {
    if (b & 1) result ^= a
    const highBit = a & 0x80
    a = (a << 1) & 0xff
    if (highBit) a ^= 0x1b
    b >>= 1
  }
  return result
}

function gf256Pow(base: number, exp: number): number {
  let result = 1
  for (let i = 0; i < exp; i++) {
    result = gf256Mul(result, base)
  }
  return result
}

function gf256Div(a: number, b: number): number {
  return gf256Mul(a, gf256Inv(b))
}

function gf256Inv(a: number): number {
  if (a === 0) throw new Error('Cannot invert 0')
  let result = 1
  for (let i = 0; i < 254; i++) {
    result = gf256Mul(result, a)
  }
  return result
}

function secureWipeCoeffs(coeffs: Uint8Array[]): void {
  for (const coeff of coeffs) {
    coeff.fill(0)
  }
}
