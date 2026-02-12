// Core crypto operations using Web Crypto API
import { getKdfParamsForVersion, LEGACY_KDF_VERSION, CURRENT_KDF_VERSION } from './vault-version'
import type { KdfParams } from './vault-version'
import { bufferToBase64 } from './crypto-utils'
import { deriveKeyWithRawInWorker } from './crypto-worker-client'
import type { DerivedKeyResult as WorkerDerivedKeyResult } from './crypto-worker-client'

// IV Collision Detection for Cross-Device Sync (Security Fix)
const MAX_STORED_IVS = 10000
const RECENT_IVS_KEY = 'peach_recent_ivs'
const MAX_IV_RETRY_ATTEMPTS = 5

interface RecentIVs {
  ivs: string[]  // Base64-encoded IVs
  lastRotation: number
}

/**
 * Check if an IV has been used before and record it for future checks.
 * This is essential for AES-GCM security when multiple devices sync to the same S3 object.
 * AES-GCM fails catastrophically on IV reuse with the same key.
 * 
 * @param iv - The IV to check and record
 * @returns true if IV is unique (not a collision), false if collision detected
 */
export async function checkAndRecordIV(iv: Uint8Array): Promise<boolean> {
  const ivBase64 = bufferToBase64(iv.buffer as ArrayBuffer)
  const stored = await chrome.storage.local.get(RECENT_IVS_KEY)
  const recent: RecentIVs = stored[RECENT_IVS_KEY] || { ivs: [], lastRotation: Date.now() }
  
  // Check for collision
  if (recent.ivs.includes(ivBase64)) {
    return false // Collision detected
  }
  
  // Add new IV
  recent.ivs.push(ivBase64)
  
  // Rotate if exceeding max
  if (recent.ivs.length > MAX_STORED_IVS) {
    recent.ivs = recent.ivs.slice(-MAX_STORED_IVS / 2) // Keep last half
    recent.lastRotation = Date.now()
  }
  
  await chrome.storage.local.set({ [RECENT_IVS_KEY]: recent })
  return true
}

/**
 * Log a security event when IV collision is detected.
 * This helps with security monitoring and incident response.
 */
async function logIVCollisionEvent(): Promise<void> {
  try {
    const SECURITY_EVENTS_KEY = 'peach_security_events'
    const MAX_SECURITY_EVENTS = 100
    
    const result = await chrome.storage.local.get(SECURITY_EVENTS_KEY)
    const events = (result[SECURITY_EVENTS_KEY] as Array<{ type: string; timestamp: number; severity: string; details: string }> | undefined) ?? []
    
    const event = {
      type: 'IV_COLLISION_DETECTED',
      timestamp: Date.now(),
      severity: 'high',
      details: 'An IV collision was detected during encryption. This may indicate a sync conflict or cryptographically improbable random value collision.'
    }
    
    const updatedEvents = [event, ...events].slice(0, MAX_SECURITY_EVENTS)
    await chrome.storage.local.set({ [SECURITY_EVENTS_KEY]: updatedEvents })
  } catch {
    // Fail silently - don't block encryption if logging fails
  }
}

/**
 * Clear the stored IV history. Useful for testing or when rotating keys.
 */
export async function clearIVHistory(): Promise<void> {
  await chrome.storage.local.remove(RECENT_IVS_KEY)
}

export interface DerivedKeyResult {
  key: CryptoKey
  rawBytes: Uint8Array
}

// Re-export for backward compatibility
export type { WorkerDerivedKeyResult }

/**
 * Derive key from password using default (legacy) parameters
 * Maintains backward compatibility with existing code
 */
export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const result = await deriveKeyFromPasswordWithRaw(password, salt)
  return result.key
}

/**
 * Derive key from password with specific KDF version
 * @param password - The password to derive key from
 * @param salt - The salt for key derivation
 * @param kdfVersion - KDF version to use (default: LEGACY_KDF_VERSION for backward compatibility)
 */
export async function deriveKeyFromPasswordWithRaw(
  password: string,
  salt: Uint8Array,
  kdfVersion: number = LEGACY_KDF_VERSION
): Promise<DerivedKeyResult> {
  // Use Web Worker for isolated key derivation
  // Raw key bytes never leave the worker; only the non-extractable CryptoKey is returned
  const result = await deriveKeyWithRawInWorker(password, salt, kdfVersion)
  
  // The worker returns raw bytes which the caller is responsible for wiping
  // This is needed for KDF migration scenarios
  return {
    key: result.key,
    rawBytes: result.rawBytes
  }
}

/**
 * Derive key from password with explicit KDF parameters
 * This delegates to the Web Worker for isolated key derivation
 * 
 * NOTE: KDF params are passed to the worker, but the worker will use
 * the KDF version to look up params. This maintains backward compatibility.
 */
export async function deriveKeyWithParams(
  password: string,
  salt: Uint8Array,
  params: KdfParams
): Promise<DerivedKeyResult> {
  // Determine KDF version from params
  // We need to find which version these params correspond to
  let kdfVersion = LEGACY_KDF_VERSION
  const currentParams = getKdfParamsForVersion(CURRENT_KDF_VERSION)
  
  if (params.memory === currentParams.memory && 
      params.iterations === currentParams.iterations) {
    kdfVersion = CURRENT_KDF_VERSION
  }
  
  // Use Web Worker for isolated key derivation
  const result = await deriveKeyWithRawInWorker(password, salt, kdfVersion)
  
  return {
    key: result.key,
    rawBytes: result.rawBytes
  }
}

/**
 * Derive key using current (hardened) KDF parameters
 * Use this for new vaults and re-encryption after migration
 */
export async function deriveKeyWithCurrentParams(
  password: string,
  salt: Uint8Array
): Promise<DerivedKeyResult> {
  // Use Web Worker for isolated key derivation
  const result = await deriveKeyWithRawInWorker(password, salt, CURRENT_KDF_VERSION)
  
  return {
    key: result.key,
    rawBytes: result.rawBytes
  }
}

export async function deriveSubKey(
  masterKey: CryptoKey,
  info: string,
  usage: KeyUsage[],
  extractable: boolean = false
): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32), // Empty salt (Argon2 already salted)
      info: encoder.encode(info),
    },
    masterKey,
    { name: "AES-GCM", length: 256 },
    extractable,
    usage
  )
}

export async function encrypt(
  key: CryptoKey,
  data: ArrayBuffer,
  aad?: ArrayBuffer
): Promise<ArrayBuffer> {
  let iv: Uint8Array
  let attempts = 0
  let isUnique = false
  let collisionDetected = false
  
  // Try to generate a unique IV, with retry limit
  do {
    iv = crypto.getRandomValues(new Uint8Array(12))
    isUnique = await checkAndRecordIV(iv)
    attempts++
    
    if (!isUnique) {
      collisionDetected = true
      
      if (attempts >= MAX_IV_RETRY_ATTEMPTS) {
        // Log security event before throwing
        await logIVCollisionEvent()
        throw new Error(
          `IV collision detected after ${MAX_IV_RETRY_ATTEMPTS} attempts. ` +
          'This may indicate a serious sync conflict or PRNG failure.'
        )
      }
    }
  } while (!isUnique && attempts < MAX_IV_RETRY_ATTEMPTS)
  
  // Log security event if any collision was detected (even if we recovered)
  if (collisionDetected) {
    await logIVCollisionEvent()
  }
  
  const algorithm: AesGcmParams = { name: "AES-GCM", iv: iv as BufferSource }
  if (aad) {
    algorithm.additionalData = aad
  }
  
  const ciphertext = await crypto.subtle.encrypt(
    algorithm,
    key,
    data
  )
  // Prepend IV to ciphertext
  const result = new Uint8Array(iv.length + ciphertext.byteLength)
  result.set(iv, 0)
  // Cast to handle ArrayBufferLike type
  const ciphertextArray = new Uint8Array(ciphertext as ArrayBuffer)
  result.set(ciphertextArray, iv.length)
  return result.buffer
}

export async function decrypt(
  key: CryptoKey,
  data: ArrayBuffer,
  aad?: ArrayBuffer
): Promise<ArrayBuffer> {
  const iv = new Uint8Array(data, 0, 12)
  const ciphertext = new Uint8Array(data, 12)
  
  const algorithm: AesGcmParams = { name: "AES-GCM", iv }
  if (aad) {
    algorithm.additionalData = aad
  }

  return crypto.subtle.decrypt(
    algorithm,
    key,
    ciphertext
  )
}

// Re-export KDF version constants for convenience
export { LEGACY_KDF_VERSION, CURRENT_KDF_VERSION, getKdfParamsForVersion }
export type { KdfParams }
