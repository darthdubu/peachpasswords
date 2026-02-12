// Vault versioning and KDF parameter management
// Handles migration tracking for Argon2id KDF hardening (LOTUS-ARGON2-HARDENING)

/**
 * KDF Version Constants
 * - LEGACY_KDF_VERSION (1): Original parameters (memorySize: 65536 = 64 MiB)
 * - PERFORMANCE_KDF_VERSION (2): Previous hardened parameters (memorySize: 262144 = 256 MiB)
 * - CURRENT_KDF_VERSION (3): Browser-optimized parameters (memorySize: 131072 = 128 MiB)
 */
export const LEGACY_KDF_VERSION = 1
export const PERFORMANCE_KDF_VERSION = 2
export const CURRENT_KDF_VERSION = 3

/**
 * KDF Algorithm Parameters
 */
export interface KdfParams {
  /** Memory size in KiB */
  memory: number
  /** Number of iterations */
  iterations: number
  /** Degree of parallelism */
  parallelism: number
  /** Hash length in bytes */
  hashLength: number
}

/**
 * Vault Header - Stored alongside encrypted vault data
 * Tracks KDF and AEAD parameters for migration support
 */
export interface VaultHeader {
  /** Vault format version (separate from KDF version) */
  version: number
  /** KDF algorithm identifier */
  kdfAlgorithm: 'argon2id'
  /** KDF parameters used for key derivation */
  kdfParams: KdfParams
  /** KDF version for migration tracking */
  kdfVersion: number
  /** AEAD algorithm identifier */
  aead: 'aes-256-gcm'
  /** Creation timestamp */
  createdAt: number
}

/**
 * Legacy KDF parameters (v1) - 64 MiB memory
 * Used for backward compatibility with existing vaults
 */
export const LEGACY_KDF_PARAMS: KdfParams = {
  memory: 65536,      // 64 MiB
  iterations: 3,
  parallelism: 4,
  hashLength: 32
}

/**
 * Performance-focused KDF parameters (v2) - 256 MiB memory
 * Original hardened parameters. CAUTION: Causes severe performance issues
 * on lower-end devices due to single-threaded WASM execution in browsers.
 * Kept for backward compatibility with existing vaults created with v2.
 */
export const PERFORMANCE_KDF_PARAMS: KdfParams = {
  memory: 262144,     // 256 MiB
  iterations: 3,
  parallelism: 4,
  hashLength: 32
}

/**
 * Current browser-optimized KDF parameters (v3) - 128 MiB memory
 * Balanced for browser extension environments - provides strong security
 * while maintaining acceptable unlock performance (~500-1500ms on modern devices).
 * 128 MiB with 4 iterations offers comparable GPU attack resistance to 256 MiB/3 iterations
 * while being ~2-3x faster for legitimate users.
 */
export const CURRENT_KDF_PARAMS: KdfParams = {
  memory: 131072,     // 128 MiB
  iterations: 4,      // Increased iterations to compensate for reduced memory
  parallelism: 4,
  hashLength: 32
}

/**
 * Storage key for vault header in chrome.storage.local
 */
export const VAULT_HEADER_KEY = 'vaultHeader'

/**
 * Get KDF parameters for a specific version
 */
export function getKdfParamsForVersion(version: number): KdfParams {
  switch (version) {
    case LEGACY_KDF_VERSION:
      return LEGACY_KDF_PARAMS
    case PERFORMANCE_KDF_VERSION:
      return PERFORMANCE_KDF_PARAMS
    case CURRENT_KDF_VERSION:
      return CURRENT_KDF_PARAMS
    default:
      // For unknown versions, use legacy params to maintain backward compatibility
      console.warn(`Unknown KDF version ${version}, using legacy parameters`)
      return LEGACY_KDF_PARAMS
  }
}

/**
 * Create a new vault header with current parameters
 */
export function createVaultHeader(): VaultHeader {
  return {
    version: 1,  // Header format version
    kdfAlgorithm: 'argon2id',
    kdfParams: { ...CURRENT_KDF_PARAMS },
    kdfVersion: CURRENT_KDF_VERSION,
    aead: 'aes-256-gcm',
    createdAt: Date.now()
  }
}

/**
 * Parse a vault header from stored data
 * Handles missing/legacy headers gracefully
 */
export function parseVaultHeader(data: unknown): VaultHeader | null {
  if (!data || typeof data !== 'object') {
    return null
  }

  const candidate = data as Partial<VaultHeader>

  // Validate required fields
  if (
    typeof candidate.kdfVersion !== 'number' ||
    typeof candidate.createdAt !== 'number' ||
    candidate.kdfAlgorithm !== 'argon2id' ||
    candidate.aead !== 'aes-256-gcm' ||
    !candidate.kdfParams ||
    typeof candidate.kdfParams !== 'object'
  ) {
    return null
  }

  const params = candidate.kdfParams as Partial<KdfParams>
  if (
    typeof params.memory !== 'number' ||
    typeof params.iterations !== 'number' ||
    typeof params.parallelism !== 'number' ||
    typeof params.hashLength !== 'number'
  ) {
    return null
  }

  return {
    version: candidate.version ?? 1,
    kdfAlgorithm: 'argon2id',
    kdfParams: {
      memory: params.memory,
      iterations: params.iterations,
      parallelism: params.parallelism,
      hashLength: params.hashLength
    },
    kdfVersion: candidate.kdfVersion,
    aead: 'aes-256-gcm',
    createdAt: candidate.createdAt
  }
}

/**
 * Check if a vault header needs KDF migration
 * Returns true if the vault uses legacy KDF parameters
 */
export function needsKdfMigration(header: VaultHeader | null): boolean {
  if (!header) {
    // No header means legacy vault (before header was introduced)
    return true
  }
  return header.kdfVersion < CURRENT_KDF_VERSION
}

/**
 * Detect KDF version from stored data
 * Returns LEGACY_KDF_VERSION if no valid header found
 */
export function detectKdfVersion(data: unknown): number {
  const header = parseVaultHeader(data)
  if (!header) {
    return LEGACY_KDF_VERSION
  }
  return header.kdfVersion
}

/**
 * Serialize vault header for storage
 */
export function serializeVaultHeader(header: VaultHeader): string {
  return JSON.stringify(header)
}
