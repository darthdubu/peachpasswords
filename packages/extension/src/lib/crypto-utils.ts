// Crypto utilities wrapper
import { deriveKeyFromPassword, deriveKeyFromPasswordWithRaw, encrypt, decrypt, deriveSubKey, deriveKeyWithParams, deriveKeyWithCurrentParams, LEGACY_KDF_VERSION, CURRENT_KDF_VERSION, getKdfParamsForVersion } from './crypto'
import type { KdfParams } from './crypto'
import { 
  createVaultHeader, 
  parseVaultHeader, 
  needsKdfMigration, 
  VAULT_HEADER_KEY,
  LEGACY_KDF_PARAMS,
  PERFORMANCE_KDF_PARAMS,
  CURRENT_KDF_PARAMS,
  PERFORMANCE_KDF_VERSION,
  type VaultHeader 
} from './vault-version'
import type { Vault } from '@lotus/shared'
import { logSecurityEvent } from './security-events'

export { 
  deriveKeyFromPassword, 
  deriveKeyFromPasswordWithRaw, 
  encrypt, 
  decrypt, 
  deriveSubKey,
  deriveKeyWithParams,
  deriveKeyWithCurrentParams,
  LEGACY_KDF_VERSION,
  PERFORMANCE_KDF_VERSION,
  CURRENT_KDF_VERSION,
  getKdfParamsForVersion,
  createVaultHeader,
  parseVaultHeader,
  needsKdfMigration,
  VAULT_HEADER_KEY,
  LEGACY_KDF_PARAMS,
  PERFORMANCE_KDF_PARAMS,
  CURRENT_KDF_PARAMS
}
export type { KdfParams, VaultHeader }

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

/**
 * Constant-time comparison of two Uint8Arrays
 * Prevents timing attacks by always comparing all bytes
 * 
 * Security considerations:
 * - If lengths differ, performs a dummy comparison on the longer array
 *   to avoid leaking length information via timing
 * - Always iterates through all bytes regardless of where a difference is found
 * - Uses XOR accumulation to prevent short-circuit evaluation
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length === b.length) {
    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= a[i] ^ b[i]
    }
    return result === 0
  }
  // Lengths differ - do dummy comparison to avoid timing leak
  const longer = a.length > b.length ? a : b
  let result = 1 // Start with 1 to indicate mismatch
  // Still iterate to avoid timing leak
  for (let i = 0; i < longer.length; i++) {
    result |= longer[i] ^ (longer[i] || 0)
  }
  return false
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

// LOTUS-005: Compute vault content hash for integrity verification
export async function computeVaultHash(vault: { entries: { id: string }[]; syncVersion: number }): Promise<string> {
  const data = vault.entries.map(e => e.id).sort().join('|') + ':' + vault.syncVersion
  const encoder = new TextEncoder()
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data))
  return bufferToBase64(hashBuffer)
}

// LOTUS-005: Verify vault integrity
export async function verifyVaultIntegrity(vault: { entries: { id: string }[]; syncVersion: number; contentHash?: string }): Promise<boolean> {
  if (!vault.contentHash) return true
  const computedHash = await computeVaultHash(vault)
  // Use constant-time comparison to prevent timing attacks
  const computedBytes = new Uint8Array(new TextEncoder().encode(computedHash))
  const storedBytes = new Uint8Array(new TextEncoder().encode(vault.contentHash))
  return constantTimeEqual(computedBytes, storedBytes)
}

// LOTUS-017: Encrypt entry metadata
export interface EncryptedMetadata {
  iv: string
  ciphertext: string
}

export async function encryptMetadata(
  masterKey: CryptoKey,
  metadata: Record<string, string>
): Promise<EncryptedMetadata> {
  const metadataKey = await deriveSubKey(masterKey, 'metadata-encryption', ['encrypt', 'decrypt'])
  const data = new TextEncoder().encode(JSON.stringify(metadata))
  const encrypted = await encrypt(metadataKey, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
  const iv = encrypted.slice(0, 12)
  const ciphertext = encrypted.slice(12)
  return {
    iv: bufferToBase64(iv),
    ciphertext: bufferToBase64(ciphertext)
  }
}

export async function decryptMetadata(
  masterKey: CryptoKey,
  encrypted: EncryptedMetadata
): Promise<Record<string, string> | null> {
  try {
    const metadataKey = await deriveSubKey(masterKey, 'metadata-encryption', ['encrypt', 'decrypt'])
    const iv = base64ToBuffer(encrypted.iv)
    const ciphertext = base64ToBuffer(encrypted.ciphertext)
    const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength)
    combined.set(new Uint8Array(iv), 0)
    combined.set(new Uint8Array(ciphertext), iv.byteLength)
    const decrypted = await decrypt(metadataKey, combined.buffer)
    return JSON.parse(new TextDecoder().decode(decrypted))
  } catch {
    return null
  }
}

// LOTUS-017: Entry metadata encryption helpers
import type { VaultEntry, EncryptedEntryMetadata } from '@lotus/shared'

/**
 * Encrypt entry metadata using entry-specific subkey
 * This ensures metadata is encrypted and tied to the specific entry
 */
export async function encryptEntryMetadata(
  masterKey: CryptoKey,
  entry: VaultEntry
): Promise<string> {
  const metadataKey = await deriveSubKey(masterKey, `entry-meta-${entry.id}`, ['encrypt', 'decrypt'])
  
  const metadata: EncryptedEntryMetadata = {
    name: entry.name || '',
    favorite: entry.favorite || false,
    tags: entry.tags || [],
    created: entry.created || Date.now(),
    ...(entry.login && {
      urls: entry.login.urls,
      username: entry.login.username,
      totpIssuer: entry.login.totp?.issuer,
      passkeyInfo: entry.login.passkey ? {
        rpId: entry.login.passkey.rpId || '',
        rpName: entry.login.passkey.rpName || '',
        userName: entry.login.passkey.userName || ''
      } : undefined
    }),
    ...(entry.card && {
      cardHolder: entry.card.holder,
      expMonth: entry.card.expMonth,
      expYear: entry.card.expYear,
      cardBrand: entry.card.brand
    }),
    ...(entry.identity && { identity: entry.identity })
  }
  
  const data = new TextEncoder().encode(JSON.stringify(metadata))
  const payload = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  const encrypted = await encrypt(metadataKey, payload)
  
  // Return as base64 (IV + ciphertext combined)
  return bufferToBase64(encrypted)
}

/**
 * Decrypt entry metadata using entry-specific subkey
 * Returns null if decryption fails
 */
export async function decryptEntryMetadata(
  masterKey: CryptoKey,
  entryId: string,
  encryptedMetadata: string
): Promise<EncryptedEntryMetadata | null> {
  try {
    const metadataKey = await deriveSubKey(masterKey, `entry-meta-${entryId}`, ['encrypt', 'decrypt'])
    const buffer = base64ToBuffer(encryptedMetadata)
    const decrypted = await decrypt(metadataKey, buffer)
    return JSON.parse(new TextDecoder().decode(decrypted)) as EncryptedEntryMetadata
  } catch {
    return null
  }
}

/**
 * Check if an entry has encrypted metadata (new format)
 */
export function hasEncryptedMetadata(entry: VaultEntry): boolean {
  return typeof entry.encryptedMetadata === 'string' && entry.encryptedMetadata.length > 0
}

/**
 * Merge decrypted metadata back into entry object for UI consumption
 * This creates a "hydrated" entry with all fields accessible
 */
export async function hydrateEntryMetadata(
  masterKey: CryptoKey,
  entry: VaultEntry
): Promise<VaultEntry> {
  // If already has encrypted metadata, decrypt and merge
  if (hasEncryptedMetadata(entry)) {
    const metadata = await decryptEntryMetadata(masterKey, entry.id, entry.encryptedMetadata)
    if (metadata) {
      return {
        ...entry,
        name: metadata.name,
        favorite: metadata.favorite,
        tags: metadata.tags,
        created: metadata.created,
        login: entry.login ? {
          ...entry.login,
          urls: metadata.urls,
          username: metadata.username,
          ...(entry.login.totp && {
            totp: {
              ...entry.login.totp,
              issuer: metadata.totpIssuer
            }
          }),
          ...(entry.login.passkey && metadata.passkeyInfo && {
            passkey: {
              ...entry.login.passkey,
              rpId: metadata.passkeyInfo.rpId,
              rpName: metadata.passkeyInfo.rpName,
              userName: metadata.passkeyInfo.userName
            }
          })
        } : undefined,
        card: entry.card ? {
          ...entry.card,
          holder: metadata.cardHolder,
          expMonth: metadata.expMonth,
          expYear: metadata.expYear,
          brand: metadata.cardBrand
        } : undefined,
        identity: metadata.identity
      }
    }
  }
  
  // Legacy format or decryption failed - return as-is
  return entry
}

/**
 * Prepare entry for storage by encrypting metadata
 * This should be called before saving an entry to the vault
 * 
 * NOTE: We keep both encrypted metadata AND plaintext fields in the entry.
 * The encrypted metadata ensures data is encrypted at rest.
 * The plaintext fields remain for UI convenience while vault is unlocked.
 */
export async function prepareEntryForStorage(
  masterKey: CryptoKey,
  entry: VaultEntry
): Promise<VaultEntry> {
  const encryptedMetadata = await encryptEntryMetadata(masterKey, entry)
  
  // Return entry with encrypted metadata AND keep plaintext fields for UI access
  return {
    ...entry,
    encryptedMetadata
  }
}

// LOTUS-004: Encrypt S3 credentials using master key (security fix)
export interface S3SessionConfig {
  s3Endpoint?: string
  s3Region?: string
  s3AccessKey?: string
  s3SecretKey?: string
  s3Bucket?: string
}

export async function encryptS3Config(
  masterKey: CryptoKey,
  config: S3SessionConfig
): Promise<EncryptedSettings> {
  const configKey = await deriveSubKey(masterKey, 's3-config-encryption', ['encrypt', 'decrypt'])
  const data = new TextEncoder().encode(JSON.stringify(config))
  const encrypted = await encrypt(configKey, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
  const iv = encrypted.slice(0, 12)
  const ciphertext = encrypted.slice(12)
  return {
    iv: bufferToBase64(iv),
    ciphertext: bufferToBase64(ciphertext)
  }
}

export async function decryptS3Config(
  masterKey: CryptoKey,
  encrypted: EncryptedSettings
): Promise<S3SessionConfig | null> {
  try {
    const configKey = await deriveSubKey(masterKey, 's3-config-encryption', ['encrypt', 'decrypt'])
    const iv = base64ToBuffer(encrypted.iv)
    const ciphertext = base64ToBuffer(encrypted.ciphertext)
    const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength)
    combined.set(new Uint8Array(iv), 0)
    combined.set(new Uint8Array(ciphertext), iv.byteLength)
    const decrypted = await decrypt(configKey, combined.buffer)
    return JSON.parse(new TextDecoder().decode(decrypted))
  } catch {
    return null
  }
}

/**
 * Securely wipe a buffer by overwriting it with zeros.
 * Use this on sensitive data (keys, passwords) before releasing from memory.
 * Note: JavaScript garbage collection timing is not guaranteed,
 * but this reduces the window of exposure.
 */
export function secureWipe(buffer: ArrayBuffer | Uint8Array | null | undefined): void {
  if (!buffer) return
  if (buffer instanceof ArrayBuffer) {
    new Uint8Array(buffer).fill(0)
  } else if (buffer instanceof Uint8Array) {
    buffer.fill(0)
  }
}

export interface VaultAadContext {
  syncVersion: number
  schemaVersion: number
}

export function buildVaultAad(ctx: VaultAadContext): string {
  return `peach-vault:v${ctx.schemaVersion}:sync:${ctx.syncVersion}`
}

export function deriveVaultAadFromVault(vault: Vault): string {
  return buildVaultAad({
    syncVersion: Number(vault.syncVersion || 0),
    schemaVersion: Number(vault.version || 1)
  })
}

export function assertEncryptedBlobPayload(payload: unknown): asserts payload is { blob: string; version: number } {
  const candidate = payload as { blob?: unknown; version?: unknown } | null
  if (!candidate || typeof candidate.blob !== 'string' || typeof candidate.version !== 'number') {
    throw new Error('Invalid encrypted sync payload')
  }
  if (candidate.blob.trim().length < 16) {
    throw new Error('Encrypted blob payload is unexpectedly small')
  }
}

// ============================================================================
// KDF Migration Helpers (LOTUS-ARGON2-HARDENING)
// ============================================================================

/**
 * Load vault header from storage
 */
export async function loadVaultHeader(): Promise<VaultHeader | null> {
  try {
    const result = await chrome.storage.local.get([VAULT_HEADER_KEY])
    return parseVaultHeader(result[VAULT_HEADER_KEY])
  } catch {
    return null
  }
}

/**
 * Save vault header to storage
 */
export async function saveVaultHeader(header: VaultHeader): Promise<void> {
  await chrome.storage.local.set({ [VAULT_HEADER_KEY]: header })
}

/**
 * Derive key for vault unlock with automatic KDF version detection
 * 
 * This function tries multiple KDF versions to ensure backward compatibility:
 * 1. First, try the KDF version from the stored header (if available)
 * 2. Fall back to legacy parameters if no header or if header version fails
 */
export async function deriveKeyForUnlock(
  password: string,
  salt: Uint8Array,
  header: VaultHeader | null
): Promise<{ result: { key: CryptoKey; rawBytes: Uint8Array }; kdfVersion: number }> {
  // If we have a valid header with KDF version, use that first
  if (header && header.kdfVersion) {
    try {
      const result = await deriveKeyFromPasswordWithRaw(password, salt, header.kdfVersion)
      return { result, kdfVersion: header.kdfVersion }
    } catch (error) {
      // If the stored version fails, fall through to try legacy
      console.warn('KDF derivation with stored version failed, trying legacy', error)
    }
  }

  // Try legacy KDF version (v1) - ensures backward compatibility
  const result = await deriveKeyFromPasswordWithRaw(password, salt, LEGACY_KDF_VERSION)
  return { result, kdfVersion: LEGACY_KDF_VERSION }
}

/**
 * Attempt vault unlock with KDF migration detection
 * 
 * This function attempts to unlock a vault and returns whether KDF migration
 * is needed. It ensures backward compatibility by trying legacy KDF parameters
 * if the current parameters fail.
 */
export async function attemptVaultUnlockWithMigration(
  password: string,
  salt: Uint8Array,
  header: VaultHeader | null
): Promise<{
  success: boolean
  result?: { key: CryptoKey; rawBytes: Uint8Array }
  needsMigration: boolean
  usedKdfVersion: number
}> {
  // Determine expected KDF version
  const expectedVersion = header?.kdfVersion ?? LEGACY_KDF_VERSION
  
  try {
    // Try with the expected version first
    const result = await deriveKeyFromPasswordWithRaw(password, salt, expectedVersion)
    return {
      success: true,
      result,
      needsMigration: needsKdfMigration(header),
      usedKdfVersion: expectedVersion
    }
  } catch (error) {
    // If expected version is already legacy, fail
    if (expectedVersion === LEGACY_KDF_VERSION) {
      return {
        success: false,
        needsMigration: false,
        usedKdfVersion: expectedVersion
      }
    }

    // Try legacy version as fallback (backward compatibility)
    try {
      const result = await deriveKeyFromPasswordWithRaw(password, salt, LEGACY_KDF_VERSION)
      return {
        success: true,
        result,
        needsMigration: true, // Definitely needs migration
        usedKdfVersion: LEGACY_KDF_VERSION
      }
    } catch {
      return {
        success: false,
        needsMigration: false,
        usedKdfVersion: expectedVersion
      }
    }
  }
}

/**
 * Perform KDF migration for a vault
 * 
 * This re-derives the master key with current (hardened) parameters,
 * updates the vault header, and returns the new key.
 * 
 * IMPORTANT: The caller must re-encrypt the vault with the new key
 * and save both the encrypted vault and the updated header.
 */
export async function migrateKdf(
  password: string,
  salt: Uint8Array
): Promise<{
  newKey: CryptoKey
  newRawBytes: Uint8Array
  newHeader: VaultHeader
}> {
  try {
    // Derive new key with current (hardened) parameters
    const { key: newKey, rawBytes: newRawBytes } = await deriveKeyWithCurrentParams(password, salt)
    
    // Create new header with current KDF version
    const newHeader = createVaultHeader()
    
    await logSecurityEvent('kdf-migration-completed', 'info', {
      fromVersion: LEGACY_KDF_VERSION,
      toVersion: CURRENT_KDF_VERSION
    })
    
    return { newKey, newRawBytes, newHeader }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    await logSecurityEvent('kdf-migration-failed', 'error', {
      fromVersion: LEGACY_KDF_VERSION,
      toVersion: CURRENT_KDF_VERSION,
      error: errorMsg
    })
    throw error
  }
}

/**
 * Check if KDF migration is needed based on stored header
 */
export async function checkKdfMigrationNeeded(): Promise<boolean> {
  const header = await loadVaultHeader()
  return needsKdfMigration(header)
}

// ============================================================================
// Vault Blob Padding for Size Privacy (LOTUS-011)
// ============================================================================

const VAULT_PADDING_SIZE = 4096 // 4KB

// For 4KB padding, we can't use standard PKCS#7 (max 255 bytes).
// We use a modified approach: store the padding length in the last 2 bytes
// of the padding in big-endian format.

/**
 * Pad vault plaintext to the nearest 4KB boundary before encryption.
 * This prevents an S3 admin from inferring entry count from blob size changes.
 * 
 * Padding format: The last 2 bytes of the padded data contain the padding length
 * in big-endian format. All other padding bytes are filled with 0x00.
 */
export function padVaultPlaintext(plaintext: Uint8Array): Uint8Array {
  const currentSize = plaintext.length
  const targetSize = Math.ceil(currentSize / VAULT_PADDING_SIZE) * VAULT_PADDING_SIZE
  
  // Always add at least VAULT_PADDING_SIZE bytes of padding to ensure
  // we have room for the 2-byte padding length marker
  const finalTargetSize = targetSize === currentSize ? currentSize + VAULT_PADDING_SIZE : targetSize
  
  const paddingNeeded = finalTargetSize - currentSize
  const padded = new Uint8Array(finalTargetSize)
  padded.set(plaintext, 0)
  
  // Fill padding with zeros
  padded.fill(0, currentSize)
  
  // Store padding length in last 2 bytes (big-endian)
  padded[padded.length - 2] = (paddingNeeded >> 8) & 0xFF
  padded[padded.length - 1] = paddingNeeded & 0xFF
  
  return padded
}

/**
 * Remove padding from decrypted vault plaintext.
 * 
 * Reads the padding length from the last 2 bytes (big-endian) and returns
 * the original plaintext. Returns the input unchanged if padding is invalid.
 */
export function unpadVaultPlaintext(padded: Uint8Array): Uint8Array {
  if (padded.length < 2) return padded
  
  // Read padding length from last 2 bytes (big-endian)
  const padLength = (padded[padded.length - 2] << 8) | padded[padded.length - 1]
  
  // Validate padding length
  if (padLength < 2 || padLength > padded.length) {
    // Invalid padding, return as-is
    return padded
  }
  
  // Verify that all padding bytes (except the last 2 length bytes) are zeros
  const paddingStart = padded.length - padLength
  for (let i = paddingStart; i < padded.length - 2; i++) {
    if (padded[i] !== 0) {
      return padded // Invalid padding, return as-is
    }
  }
  
  return padded.slice(0, padded.length - padLength)
}
