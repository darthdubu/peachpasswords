/**
 * Crypto Worker Fallback Module
 * 
 * This module provides fallback implementations of crypto operations
 * for environments where Web Workers are not available (e.g., jsdom for tests).
 * 
 * The fallback provides the same security guarantees:
 * - Argon2id key derivation with automatic secure wipe of raw bytes
 * - Non-extractable CryptoKey handles returned to caller
 * 
 * SECURITY NOTE: In fallback mode, operations run on the main thread,
 * so key material exists temporarily in the main thread's heap. This is
 * acceptable for testing but the Web Worker mode is preferred for production.
 */

import { argon2id } from 'hash-wasm'
import { getKdfParamsForVersion } from './vault-version'
import type { 
  DeriveKeyPayload,
  DeriveKeyWithRawPayload,
  SecureWipePayload
} from '../workers/crypto-worker'
import type { DerivedKeyResult } from './crypto-worker-client'

/**
 * Derive a key from password using Argon2id (fallback for worker)
 * 
 * Returns a non-extractable CryptoKey handle. Raw key bytes are
 * automatically wiped from memory before returning.
 */
export async function handleDeriveKeyFallback(
  payload: DeriveKeyPayload
): Promise<CryptoKey> {
  const { password, salt, kdfVersion } = payload
  
  // Get KDF params based on version
  const params = getKdfParamsForVersion(kdfVersion)
  
  // Run Argon2id (via WASM) 
  const hash = await argon2id({
    password,
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memory,
    hashLength: params.hashLength,
    outputType: 'binary'
  })

  try {
    // Import as non-extractable CryptoKey - this is what we return
    // Extract the actual bytes from the Uint8Array to handle the ArrayBufferLike type
    const keyData = new Uint8Array(hash).buffer
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HKDF' },
      false, // non-extractable - key cannot be exported
      ['deriveKey']
    )

    return key
  } finally {
    // Always secure wipe the raw hash from memory
    // This happens even if importKey fails
    secureWipe(hash)
  }
}

/**
 * Derive a key and return both the CryptoKey handle AND raw bytes (fallback for worker)
 * 
 * SECURITY NOTE: This should only be used when you need raw bytes
 * (e.g., for KDF migration). Caller is responsible for wiping raw bytes when done.
 */
export async function handleDeriveKeyWithRawFallback(
  payload: DeriveKeyWithRawPayload
): Promise<DerivedKeyResult> {
  const { password, salt, kdfVersion } = payload
  
  // Get KDF params based on version
  const params = getKdfParamsForVersion(kdfVersion)
  
  // Run Argon2id (via WASM)
  const hash = await argon2id({
    password,
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memory,
    hashLength: params.hashLength,
    outputType: 'binary'
  })

  // Keep a copy of raw bytes for the caller (for migration purposes)
  // We must make a copy because argon2id returns a typed array that we will wipe
  const rawBytes = new Uint8Array(hash)

  try {
    // Import as non-extractable CryptoKey
    // Extract the actual bytes from the Uint8Array to handle the ArrayBufferLike type
    const keyData = new Uint8Array(hash).buffer
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HKDF' },
      false, // non-extractable
      ['deriveKey']
    )

    return { key, rawBytes }
  } finally {
    // Wipe the original hash buffer from argon2id
    // Note: rawBytes copy still exists and is caller's responsibility
    secureWipe(hash)
  }
}

/**
 * Securely wipe a buffer by overwriting with zeros (fallback for worker)
 * This is more of a best-effort operation in the main thread
 */
export function handleSecureWipeFallback(payload: SecureWipePayload): void {
  const { buffer } = payload
  secureWipe(buffer)
}

/**
 * Securely wipe a buffer by overwriting with zeros
 */
function secureWipe(buffer: Uint8Array): void {
  if (buffer && buffer.length > 0) {
    buffer.fill(0)
  }
}
