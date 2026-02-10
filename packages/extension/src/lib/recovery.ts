import { generateShares, reconstructSecret, Share } from '@lotus/shared'

export interface RecoveryKit {
  shares: Share[]
  threshold: number
  totalShares: number
  createdAt: number
  vaultHint: string
}

export async function generateRecoveryKit(
  masterKey: CryptoKey,
  vaultName: string
): Promise<RecoveryKit | null> {
  try {
    const rawKey = await crypto.subtle.exportKey('raw', masterKey)
    const keyBytes = new Uint8Array(rawKey)

    const shares = generateShares(keyBytes, 5, 3)

    keyBytes.fill(0)

    return {
      shares,
      threshold: 3,
      totalShares: 5,
      createdAt: Date.now(),
      vaultHint: vaultName.slice(0, 3) + '***'
    }
  } catch (err) {
    console.error('Failed to generate recovery kit:', err)
    return null
  }
}

export async function recoverVaultKey(shares: Share[]): Promise<CryptoKey | null> {
  try {
    if (shares.length < 3) {
      throw new Error(`Need at least 3 shares, got ${shares.length}`)
    }

    const keyBytes = reconstructSecret(shares.slice(0, 3))
    const keyBuffer = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer

    const masterKey = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'HKDF' },
      false,
      ['deriveKey']
    )

    keyBytes.fill(0)

    return masterKey
  } catch (err) {
    console.error('Failed to recover vault key:', err)
    return null
  }
}

export function downloadRecoveryKit(kit: RecoveryKit): void {
  const content = `
LOTUS PASSWORD MANAGER - RECOVERY KIT
======================================

Created: ${new Date(kit.createdAt).toLocaleString()}
Vault: ${kit.vaultHint}
Threshold: ${kit.threshold} of ${kit.totalShares} shares needed

IMPORTANT: Store these shares in separate secure locations.
Anyone with ${kit.threshold} shares can access your vault.

RECOVERY SHARES:
----------------
${kit.shares.map((share, i) => `
Share ${i + 1}:
Index: ${share.index}
Value: ${share.value}
`).join('\n')}

RECOVERY INSTRUCTIONS:
----------------------
1. Collect at least ${kit.threshold} shares
2. Go to Lotus Settings > Recovery
3. Enter all share values
4. Your vault will be unlocked

WARNING: If you lose these shares and forget your password,
your data cannot be recovered.
  `.trim()

  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `lotus-recovery-kit-${Date.now()}.txt`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
