import { describe, it, expect, vi } from 'vitest'
import {
  LEGACY_KDF_VERSION,
  PERFORMANCE_KDF_VERSION,
  CURRENT_KDF_VERSION,
  LEGACY_KDF_PARAMS,
  PERFORMANCE_KDF_PARAMS,
  CURRENT_KDF_PARAMS,
  getKdfParamsForVersion,
  createVaultHeader,
  parseVaultHeader,
  needsKdfMigration,
  detectKdfVersion,
  serializeVaultHeader,
} from './vault-version'

describe('Vault Version / KDF Hardening', () => {
  describe('KDF Version Constants', () => {
    it('should have correct legacy version', () => {
      expect(LEGACY_KDF_VERSION).toBe(1)
    })

    it('should have current version greater than legacy', () => {
      expect(CURRENT_KDF_VERSION).toBeGreaterThan(LEGACY_KDF_VERSION)
    })

    it('should have correct memory parameters', () => {
      // Legacy: 64 MiB = 65536 KiB
      expect(LEGACY_KDF_PARAMS.memory).toBe(65536)
      // Performance (v2): 256 MiB = 262144 KiB
      expect(PERFORMANCE_KDF_PARAMS.memory).toBe(262144)
      // Current (v3): 128 MiB = 131072 KiB (browser-optimized)
      expect(CURRENT_KDF_PARAMS.memory).toBe(131072)
    })
  })

  describe('getKdfParamsForVersion', () => {
    it('should return legacy params for v1', () => {
      const params = getKdfParamsForVersion(LEGACY_KDF_VERSION)
      expect(params).toEqual(LEGACY_KDF_PARAMS)
    })

    it('should return performance params for v2', () => {
      const params = getKdfParamsForVersion(PERFORMANCE_KDF_VERSION)
      expect(params).toEqual(PERFORMANCE_KDF_PARAMS)
    })

    it('should return current params for v3', () => {
      const params = getKdfParamsForVersion(CURRENT_KDF_VERSION)
      expect(params).toEqual(CURRENT_KDF_PARAMS)
    })

    it('should return legacy params for unknown version', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const params = getKdfParamsForVersion(999)
      expect(params).toEqual(LEGACY_KDF_PARAMS)
      expect(consoleSpy).toHaveBeenCalledWith('Unknown KDF version 999, using legacy parameters')
      consoleSpy.mockRestore()
    })
  })

  describe('createVaultHeader', () => {
    it('should create header with current KDF version', () => {
      const header = createVaultHeader()
      expect(header.kdfVersion).toBe(CURRENT_KDF_VERSION)
      expect(header.kdfAlgorithm).toBe('argon2id')
      expect(header.aead).toBe('aes-256-gcm')
      expect(header.version).toBe(1)
      expect(header.kdfParams).toEqual(CURRENT_KDF_PARAMS)
      expect(typeof header.createdAt).toBe('number')
      expect(header.createdAt).toBeLessThanOrEqual(Date.now())
    })

    it('should create unique timestamps', async () => {
      const header1 = createVaultHeader()
      await new Promise(r => setTimeout(r, 10))
      const header2 = createVaultHeader()
      expect(header1.createdAt).not.toBe(header2.createdAt)
    })
  })

  describe('parseVaultHeader', () => {
    it('should parse valid header with current params (v3)', () => {
      const validHeader = {
        version: 1,
        kdfAlgorithm: 'argon2id',
        kdfParams: {
          memory: 131072,
          iterations: 4,
          parallelism: 4,
          hashLength: 32
        },
        kdfVersion: 3,
        aead: 'aes-256-gcm',
        createdAt: Date.now()
      }
      const parsed = parseVaultHeader(validHeader)
      expect(parsed).toEqual(validHeader)
    })

    it('should parse valid header with performance params (v2)', () => {
      const validHeader = {
        version: 1,
        kdfAlgorithm: 'argon2id',
        kdfParams: {
          memory: 262144,
          iterations: 3,
          parallelism: 4,
          hashLength: 32
        },
        kdfVersion: 2,
        aead: 'aes-256-gcm',
        createdAt: Date.now()
      }
      const parsed = parseVaultHeader(validHeader)
      expect(parsed).toEqual(validHeader)
    })

    it('should return null for null input', () => {
      expect(parseVaultHeader(null)).toBeNull()
    })

    it('should return null for non-object input', () => {
      expect(parseVaultHeader('string')).toBeNull()
      expect(parseVaultHeader(123)).toBeNull()
    })

    it('should return null for missing kdfVersion', () => {
      const invalid = {
        version: 1,
        kdfAlgorithm: 'argon2id',
        kdfParams: { memory: 131072, iterations: 4, parallelism: 4, hashLength: 32 },
        aead: 'aes-256-gcm',
        createdAt: Date.now()
        // kdfVersion missing
      }
      expect(parseVaultHeader(invalid)).toBeNull()
    })

    it('should return null for wrong kdfAlgorithm', () => {
      const invalid = {
        version: 1,
        kdfAlgorithm: 'scrypt', // wrong algorithm
        kdfParams: { memory: 131072, iterations: 4, parallelism: 4, hashLength: 32 },
        kdfVersion: 3,
        aead: 'aes-256-gcm',
        createdAt: Date.now()
      }
      expect(parseVaultHeader(invalid)).toBeNull()
    })

    it('should return null for missing kdfParams', () => {
      const invalid = {
        version: 1,
        kdfAlgorithm: 'argon2id',
        // kdfParams missing
        kdfVersion: 3,
        aead: 'aes-256-gcm',
        createdAt: Date.now()
      }
      expect(parseVaultHeader(invalid)).toBeNull()
    })

    it('should return null for incomplete kdfParams', () => {
      const invalid = {
        version: 1,
        kdfAlgorithm: 'argon2id',
        kdfParams: { memory: 131072, iterations: 4 }, // missing parallelism, hashLength
        kdfVersion: 3,
        aead: 'aes-256-gcm',
        createdAt: Date.now()
      }
      expect(parseVaultHeader(invalid)).toBeNull()
    })
  })

  describe('needsKdfMigration', () => {
    it('should return true for null header', () => {
      expect(needsKdfMigration(null)).toBe(true)
    })

    it('should return true for legacy KDF version', () => {
      const legacyHeader = createVaultHeader()
      legacyHeader.kdfVersion = LEGACY_KDF_VERSION
      legacyHeader.kdfParams = { ...LEGACY_KDF_PARAMS }
      expect(needsKdfMigration(legacyHeader)).toBe(true)
    })

    it('should return false for current KDF version', () => {
      const currentHeader = createVaultHeader()
      expect(needsKdfMigration(currentHeader)).toBe(false)
    })

    it('should return false for future KDF version', () => {
      const futureHeader = createVaultHeader()
      futureHeader.kdfVersion = CURRENT_KDF_VERSION + 1
      expect(needsKdfMigration(futureHeader)).toBe(false)
    })
  })

  describe('detectKdfVersion', () => {
    it('should return legacy version for null', () => {
      expect(detectKdfVersion(null)).toBe(LEGACY_KDF_VERSION)
    })

    it('should return legacy version for invalid header', () => {
      expect(detectKdfVersion({ invalid: true })).toBe(LEGACY_KDF_VERSION)
    })

    it('should detect version from valid header', () => {
      const header = createVaultHeader()
      header.kdfVersion = 3
      expect(detectKdfVersion(header)).toBe(3)
    })
  })

  describe('serializeVaultHeader', () => {
    it('should serialize header to JSON string', () => {
      const header = createVaultHeader()
      const serialized = serializeVaultHeader(header)
      expect(typeof serialized).toBe('string')
      const parsed = JSON.parse(serialized)
      expect(parsed).toEqual(header)
    })
  })

  describe('KDF Params Structure', () => {
    it('legacy params should have correct structure', () => {
      expect(LEGACY_KDF_PARAMS).toHaveProperty('memory', 65536)
      expect(LEGACY_KDF_PARAMS).toHaveProperty('iterations', 3)
      expect(LEGACY_KDF_PARAMS).toHaveProperty('parallelism', 4)
      expect(LEGACY_KDF_PARAMS).toHaveProperty('hashLength', 32)
    })

    it('performance params should have correct structure', () => {
      expect(PERFORMANCE_KDF_PARAMS).toHaveProperty('memory', 262144)
      expect(PERFORMANCE_KDF_PARAMS).toHaveProperty('iterations', 3)
      expect(PERFORMANCE_KDF_PARAMS).toHaveProperty('parallelism', 4)
      expect(PERFORMANCE_KDF_PARAMS).toHaveProperty('hashLength', 32)
    })

    it('current params should have correct structure', () => {
      expect(CURRENT_KDF_PARAMS).toHaveProperty('memory', 131072)
      expect(CURRENT_KDF_PARAMS).toHaveProperty('iterations', 4)
      expect(CURRENT_KDF_PARAMS).toHaveProperty('parallelism', 4)
      expect(CURRENT_KDF_PARAMS).toHaveProperty('hashLength', 32)
    })

    it('current params should have 2x memory of legacy', () => {
      expect(CURRENT_KDF_PARAMS.memory).toBe(LEGACY_KDF_PARAMS.memory * 2)
    })

    it('performance params should have 4x memory of legacy', () => {
      expect(PERFORMANCE_KDF_PARAMS.memory).toBe(LEGACY_KDF_PARAMS.memory * 4)
    })
  })
})
