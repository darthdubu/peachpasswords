/**
 * Crypto Worker Client
 * 
 * Provides an async interface for communicating with the crypto Web Worker.
 * Handles worker lifecycle, message passing, and type-safe communication.
 * 
 * In environments without Web Worker support (e.g., jsdom for tests),
 * falls back to main-thread execution with the same security guarantees.
 * 
 * Usage:
 *   const client = await CryptoWorkerClient.getInstance()
 *   const key = await client.deriveKey(password, salt, kdfVersion)
 */

import type { 
  WorkerRequest, 
  WorkerResponse, 
  WorkerMessageType,
  DeriveKeyPayload,
  DeriveKeyWithRawPayload,
  SecureWipePayload
} from '../workers/crypto-worker'

// Import the worker functions for fallback mode
// These are imported directly to run on main thread when Worker is unavailable
import { 
  handleDeriveKeyFallback,
  handleDeriveKeyWithRawFallback,
  handleSecureWipeFallback
} from './crypto-worker-fallback'

export interface DerivedKeyResult {
  key: CryptoKey
  rawBytes: Uint8Array
}

// Worker instance singleton
let workerInstance: Worker | null = null
let clientInstance: CryptoWorkerClient | null = null

// Track if we're in fallback mode (no Worker support)
let isFallbackMode = false

/**
 * Check if Web Workers are supported in the current environment
 */
function isWorkerSupported(): boolean {
  try {
    return typeof Worker !== 'undefined' && 
           typeof import.meta.url !== 'undefined'
  } catch {
    return false
  }
}

/**
 * CryptoWorkerClient - Manages communication with the crypto worker
 * 
 * This client:
 * - Lazily initializes the worker on first use
 * - Provides type-safe async methods for each worker operation
 * - Handles request/response correlation via unique IDs
 * - Manages worker errors and timeouts
 * - Falls back to main-thread execution in unsupported environments
 */
export class CryptoWorkerClient {
  private worker: Worker | null = null
  private pendingRequests: Map<string, {
    resolve: (value: unknown) => void
    reject: (reason: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>
  private requestTimeout: number
  private fallbackMode: boolean

  /**
   * Private constructor - use getInstance() instead
   * Default timeout reduced from 60s to 30s for better UX in browser extensions.
   * KDF operations with 128 MiB should complete in <5s on most devices.
   */
  private constructor(worker: Worker | null, requestTimeout = 30000, fallbackMode = false) {
    this.worker = worker
    this.fallbackMode = fallbackMode
    this.pendingRequests = new Map()
    this.requestTimeout = requestTimeout
    this.fallbackMode = fallbackMode
    
    if (this.worker && !this.fallbackMode) {
      // Set up message handler
      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        this.handleMessage(e.data)
      }
      
      // Set up error handler
      this.worker.onerror = (error) => {
        console.error('Crypto worker error:', error)
        // Reject all pending requests on worker error
        this.pendingRequests.forEach(({ reject }) => {
          reject(new Error('Crypto worker failed'))
        })
        this.pendingRequests.clear()
      }
    }
  }

  /**
   * Get or create the singleton CryptoWorkerClient instance
   */
  public static async getInstance(): Promise<CryptoWorkerClient> {
    if (clientInstance) {
      return clientInstance
    }

    // Check if Worker is supported
    if (!isWorkerSupported()) {
      console.warn('Web Workers not supported, using fallback mode')
      isFallbackMode = true
      clientInstance = new CryptoWorkerClient(null, 30000, true)
      return clientInstance
    }

    // Create worker instance if not exists
    if (!workerInstance) {
      try {
        workerInstance = createWorker()
      } catch (error) {
        console.warn('Failed to create worker, using fallback mode:', error)
        isFallbackMode = true
        clientInstance = new CryptoWorkerClient(null, 30000, true)
        return clientInstance
      }
    }

    clientInstance = new CryptoWorkerClient(workerInstance)

    // Verify worker is responsive (only if not in fallback mode)
    if (!isFallbackMode && clientInstance.worker) {
      try {
        await clientInstance.ping()
      } catch (error) {
        console.warn('Worker ping failed, using fallback mode:', error)
        isFallbackMode = true
        // Create new client in fallback mode
        clientInstance = new CryptoWorkerClient(null, 30000, true)
      }
    }
    
    return clientInstance
  }

  /**
   * Create a new client with a fresh worker instance
   * Useful for testing or when you need guaranteed isolation
   */
  public static async createFresh(requestTimeout = 30000): Promise<CryptoWorkerClient> {
    if (!isWorkerSupported()) {
      return new CryptoWorkerClient(null, requestTimeout, true)
    }
    
    try {
      const worker = createWorker()
      const client = new CryptoWorkerClient(worker, requestTimeout)
      await client.ping()
      return client
    } catch (error) {
      console.warn('Failed to create fresh worker, using fallback:', error)
      return new CryptoWorkerClient(null, requestTimeout, true)
    }
  }

  /**
   * Check if running in fallback mode
   */
  public isFallbackMode(): boolean {
    return this.fallbackMode
  }

  /**
   * Terminate the worker and clean up resources
   */
  public terminate(): void {
    // Reject all pending requests
    this.pendingRequests.forEach(({ reject, timer }) => {
      clearTimeout(timer)
      reject(new Error('Worker terminated'))
    })
    this.pendingRequests.clear()
    
    if (this.worker) {
      this.worker.terminate()
    }
    
    // Clear singleton references if this is the singleton instance
    if (clientInstance === this) {
      clientInstance = null
      workerInstance = null
      isFallbackMode = false
    }
  }

  /**
   * Send a message to the worker and wait for response
   * In fallback mode, executes directly on main thread
   */
  private sendMessage(type: WorkerMessageType, payload: unknown): Promise<unknown> {
    // In fallback mode, execute directly
    if (this.fallbackMode) {
      return this.executeFallback(type, payload)
    }

    return new Promise((resolve, reject) => {
      const id = generateRequestId()
      
      // Set up timeout
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Worker request timed out after ${this.requestTimeout}ms`))
      }, this.requestTimeout)
      
      // Store pending request
      this.pendingRequests.set(id, { resolve, reject, timer })
      
      // Send message to worker
      const request: WorkerRequest = { id, type, payload }
      this.worker!.postMessage(request)
    })
  }

  /**
   * Execute operation in fallback mode (main thread)
   */
  private async executeFallback(type: WorkerMessageType, payload: unknown): Promise<unknown> {
    switch (type) {
      case 'deriveKey':
        return handleDeriveKeyFallback(payload as DeriveKeyPayload)
      
      case 'deriveKeyWithRaw':
        return handleDeriveKeyWithRawFallback(payload as DeriveKeyWithRawPayload)
      
      case 'secureWipe':
        handleSecureWipeFallback(payload as SecureWipePayload)
        return undefined
      
      case 'ping':
        return 'pong'
      
      default:
        throw new Error(`Unknown message type: ${type}`)
    }
  }

  /**
   * Handle incoming messages from worker
   */
  private handleMessage(response: WorkerResponse): void {
    const { id, type, result, error } = response
    
    const pending = this.pendingRequests.get(id)
    if (!pending) {
      console.warn('Received response for unknown request:', id)
      return
    }
    
    // Clear timeout
    clearTimeout(pending.timer)
    this.pendingRequests.delete(id)
    
    // Resolve or reject based on response type
    if (type === 'error') {
      pending.reject(new Error(error || 'Unknown worker error'))
    } else {
      pending.resolve(result)
    }
  }

  /**
   * Ping the worker to verify it's responsive
   */
  public async ping(): Promise<string> {
    const result = await this.sendMessage('ping', undefined)
    return result as string
  }

  /**
   * Derive a key from password using Argon2id
   * 
   * Returns a non-extractable CryptoKey handle. Raw key bytes are
   * automatically wiped from worker memory before returning.
   */
  public async deriveKey(
    password: string,
    salt: Uint8Array,
    kdfVersion: number
  ): Promise<CryptoKey> {
    // Validate inputs
    if (!password) {
      throw new Error('Password is required')
    }
    if (!salt || salt.length === 0) {
      throw new Error('Salt is required')
    }
    if (kdfVersion < 1) {
      throw new Error('Invalid KDF version')
    }

    const payload: DeriveKeyPayload = {
      password,
      salt,
      kdfVersion
    }

    const result = await this.sendMessage('deriveKey', payload)
    return result as CryptoKey
  }

  /**
   * Derive a key and return both CryptoKey and raw bytes
   * 
   * SECURITY NOTE: This should only be used when you need raw bytes
   * (e.g., for KDF migration). Caller MUST wipe rawBytes when done.
   */
  public async deriveKeyWithRaw(
    password: string,
    salt: Uint8Array,
    kdfVersion: number
  ): Promise<DerivedKeyResult> {
    // Validate inputs
    if (!password) {
      throw new Error('Password is required')
    }
    if (!salt || salt.length === 0) {
      throw new Error('Salt is required')
    }
    if (kdfVersion < 1) {
      throw new Error('Invalid KDF version')
    }

    const payload: DeriveKeyWithRawPayload = {
      password,
      salt,
      kdfVersion
    }

    const result = await this.sendMessage('deriveKeyWithRaw', payload)
    return result as DerivedKeyResult
  }

  /**
   * Securely wipe a buffer in the worker context
   * 
   * This is useful when you want to ensure a buffer is wiped
   * outside of the main thread's GC reach.
   */
  public async secureWipe(buffer: Uint8Array): Promise<void> {
    if (!buffer || buffer.length === 0) {
      return
    }

    // Send a copy to the worker for wiping
    // We copy because the original buffer is transferred, not shared
    const copy = new Uint8Array(buffer)
    
    const payload: SecureWipePayload = { buffer: copy }
    await this.sendMessage('secureWipe', payload)
    
    // Also wipe the local buffer
    buffer.fill(0)
  }
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}-${Math.random().toString(36).substring(2, 11)}`
}

/**
 * Create a new Worker instance
 * 
 * In Vite, we can use the ?worker suffix for proper bundling
 */
function createWorker(): Worker {
  // Use Vite's worker import syntax
  // This ensures the worker is properly bundled
  const worker = new Worker(
    new URL('../workers/crypto-worker.ts', import.meta.url),
    { type: 'module' }
  )
  return worker
}

// Convenience exports for direct usage (without managing client instance)

/**
 * Derive a key using the worker (convenience function)
 */
export async function deriveKeyInWorker(
  password: string,
  salt: Uint8Array,
  kdfVersion: number
): Promise<CryptoKey> {
  const client = await CryptoWorkerClient.getInstance()
  return client.deriveKey(password, salt, kdfVersion)
}

/**
 * Derive a key with raw bytes using the worker (convenience function)
 * 
 * SECURITY NOTE: Caller MUST wipe rawBytes when done
 */
export async function deriveKeyWithRawInWorker(
  password: string,
  salt: Uint8Array,
  kdfVersion: number
): Promise<DerivedKeyResult> {
  const client = await CryptoWorkerClient.getInstance()
  return client.deriveKeyWithRaw(password, salt, kdfVersion)
}

/**
 * Securely wipe a buffer in the worker (convenience function)
 */
export async function secureWipeInWorker(buffer: Uint8Array): Promise<void> {
  const client = await CryptoWorkerClient.getInstance()
  return client.secureWipe(buffer)
}

/**
 * Terminate the shared worker instance
 * Call this when the application is shutting down or when you want
 * to ensure all worker memory is freed.
 */
export function terminateWorker(): void {
  if (clientInstance) {
    clientInstance.terminate()
    clientInstance = null
    workerInstance = null
    isFallbackMode = false
  }
}

/**
 * Check if running in fallback mode (no Web Worker support)
 */
export function isInFallbackMode(): boolean {
  return isFallbackMode
}
