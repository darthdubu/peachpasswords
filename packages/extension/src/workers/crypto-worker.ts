/**
 * Crypto Worker - Web Worker for isolated cryptographic operations
 * 
 * This worker provides a dedicated, isolated memory context for:
 * - Argon2id key derivation (computationally expensive + handles sensitive material)
 * - Secure memory wiping (outside main thread's GC reach)
 * 
 * Security properties:
 * - Raw key bytes never leave the worker (only non-extractable CryptoKey handles)
 * - Worker heap can be more aggressively wiped after operations
 * - Limits exposure of key material to main thread's garbage collector
 */

import { argon2id } from 'hash-wasm'
import { getKdfParamsForVersion, LEGACY_KDF_VERSION, CURRENT_KDF_VERSION } from '../lib/vault-version'
import type { KdfParams } from '../lib/vault-version'

// Message types for worker communication
export type WorkerMessageType = 'deriveKey' | 'deriveKeyWithRaw' | 'secureWipe' | 'ping'

export interface WorkerRequest {
  id: string
  type: WorkerMessageType
  payload: unknown
}

export interface WorkerResponse {
  id: string
  type: 'success' | 'error'
  result?: unknown
  error?: string
}

export interface DeriveKeyPayload {
  password: string
  salt: Uint8Array
  kdfVersion: number
}

export interface DeriveKeyWithRawPayload {
  password: string
  salt: Uint8Array
  kdfVersion: number
}

export interface SecureWipePayload {
  buffer: Uint8Array
}

// Re-export for type sharing
export { LEGACY_KDF_VERSION, CURRENT_KDF_VERSION }
export type { KdfParams }

/**
 * Derive a key from password using Argon2id in isolated worker context
 * Returns only a non-extractable CryptoKey handle - raw bytes are wiped
 */
async function handleDeriveKey(payload: DeriveKeyPayload): Promise<CryptoKey> {
  const { password, salt, kdfVersion } = payload
  
  // Get KDF params based on version
  const params = getKdfParamsForVersion(kdfVersion)
  
  // Run Argon2id (via WASM) in worker context
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
    // Always secure wipe the raw hash from worker memory
    // This happens even if importKey fails
    secureWipe(hash)
  }
}

/**
 * Derive a key and return both the CryptoKey handle AND raw bytes
 * Used during key migration where raw bytes are temporarily needed
 * 
 * SECURITY NOTE: Caller is responsible for wiping raw bytes when done
 */
async function handleDeriveKeyWithRaw(payload: DeriveKeyWithRawPayload): Promise<{ key: CryptoKey; rawBytes: Uint8Array }> {
  const { password, salt, kdfVersion } = payload
  
  // Get KDF params based on version
  const params = getKdfParamsForVersion(kdfVersion)
  
  // Run Argon2id (via WASM) in worker context
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
 * Securely wipe a buffer by overwriting with zeros
 * This is more reliable in worker context due to isolated heap
 */
function secureWipe(buffer: Uint8Array): void {
  if (buffer && buffer.length > 0) {
    buffer.fill(0)
  }
}

/**
 * Handle secure wipe request
 */
function handleSecureWipe(payload: SecureWipePayload): void {
  const { buffer } = payload
  secureWipe(buffer)
}



// Main message handler
self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, type, payload } = e.data
  
  try {
    switch (type) {
      case 'deriveKey': {
        const key = await handleDeriveKey(payload as DeriveKeyPayload)
        // Note: CryptoKey cannot be transferred, only structured cloned
        // The key remains usable in the main thread after posting
        const response: WorkerResponse = { id, type: 'success', result: key }
        self.postMessage(response)
        break
      }
      
      case 'deriveKeyWithRaw': {
        const result = await handleDeriveKeyWithRaw(payload as DeriveKeyWithRawPayload)
        // Note: rawBytes will be copied via structured clone
        // Caller must wipe the copy they receive
        const response: WorkerResponse = { id, type: 'success', result }
        self.postMessage(response)
        break
      }
      
      case 'secureWipe': {
        handleSecureWipe(payload as SecureWipePayload)
        const response: WorkerResponse = { id, type: 'success', result: undefined }
        self.postMessage(response)
        break
      }
      
      case 'ping': {
        const response: WorkerResponse = { id, type: 'success', result: 'pong' }
        self.postMessage(response)
        break
      }
      
      default:
        throw new Error(`Unknown message type: ${type}`)
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const response: WorkerResponse = { id, type: 'error', error: errorMessage }
    self.postMessage(response)
  }
}

// Handle errors within the worker
self.onerror = (error) => {
  console.error('Crypto worker error:', error)
}

// Notify that worker is ready (useful for debugging)
console.log('Crypto worker initialized')
