import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  constantTimeEqual,
  loadVaultHeader,
  saveVaultHeader,
  attemptVaultUnlockWithMigration,
  migrateKdf,
  checkKdfMigrationNeeded,
  LEGACY_KDF_VERSION,
  CURRENT_KDF_VERSION,
  LEGACY_KDF_PARAMS,
  CURRENT_KDF_PARAMS,
  createVaultHeader,
  VAULT_HEADER_KEY,
} from './crypto-utils'

const storage: Record<string, unknown> = {}

describe('KDF Migration Helpers', () => {
  beforeEach(() => {
    // Clear storage mock
    for (const key of Object.keys(storage)) delete storage[key]

    // Setup chrome.storage.local mock
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (keys: string | string[]) => {
            const list = Array.isArray(keys) ? keys : [keys]
            const result: Record<string, unknown> = {}
            for (const key of list) result[key] = storage[key]
            return result
          }),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(storage, items)
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            const list = Array.isArray(keys) ? keys : [keys]
            for (const key of list) delete storage[key]
          })
        }
      }
    })
  })

  describe('constantTimeEqual', () => {
    it('should return true for equal arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4])
      const b = new Uint8Array([1, 2, 3, 4])
      expect(constantTimeEqual(a, b)).toBe(true)
    })

    it('should return false for different arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4])
      const b = new Uint8Array([1, 2, 3, 5])
      expect(constantTimeEqual(a, b)).toBe(false)
    })

    it('should return false for different lengths', () => {
      const a = new Uint8Array([1, 2, 3, 4])
      const b = new Uint8Array([1, 2, 3])
      expect(constantTimeEqual(a, b)).toBe(false)
    })

    it('should return true for empty arrays', () => {
      const a = new Uint8Array(0)
      const b = new Uint8Array(0)
      expect(constantTimeEqual(a, b)).toBe(true)
    })

    it('should handle large arrays', () => {
      const a = crypto.getRandomValues(new Uint8Array(1024))
      const b = new Uint8Array(a)
      expect(constantTimeEqual(a, b)).toBe(true)
    })
  })

  describe('loadVaultHeader', () => {
    it('should return null when no header stored', async () => {
      const header = await loadVaultHeader()
      expect(header).toBeNull()
    })

    it('should load valid header', async () => {
      const validHeader = createVaultHeader()
      storage[VAULT_HEADER_KEY] = validHeader
      
      const loaded = await loadVaultHeader()
      expect(loaded).not.toBeNull()
      expect(loaded?.kdfVersion).toBe(CURRENT_KDF_VERSION)
    })

    it('should return null for invalid header', async () => {
      storage[VAULT_HEADER_KEY] = { invalid: true }
      const header = await loadVaultHeader()
      expect(header).toBeNull()
    })
  })

  describe('saveVaultHeader', () => {
    it('should save header to storage', async () => {
      const header = createVaultHeader()
      await saveVaultHeader(header)
      
      expect(storage[VAULT_HEADER_KEY]).toEqual(header)
    })

    it('should overwrite existing header', async () => {
      const header1 = createVaultHeader()
      header1.kdfVersion = LEGACY_KDF_VERSION
      await saveVaultHeader(header1)
      
      const header2 = createVaultHeader()
      header2.kdfVersion = CURRENT_KDF_VERSION
      await saveVaultHeader(header2)
      
      expect(storage[VAULT_HEADER_KEY]).toEqual(header2)
    })
  })

  describe('attemptVaultUnlockWithMigration', () => {
    it('should unlock with legacy params when no header', async () => {
      const password = 'test-password'
      const salt = crypto.getRandomValues(new Uint8Array(32))
      
      const result = await attemptVaultUnlockWithMigration(password, salt, null)
      
      expect(result.success).toBe(true)
      expect(result.needsMigration).toBe(true)
      expect(result.usedKdfVersion).toBe(LEGACY_KDF_VERSION)
    })

    it('should detect migration needed for legacy header', async () => {
      const password = 'test-password'
      const salt = crypto.getRandomValues(new Uint8Array(32))
      const legacyHeader = createVaultHeader()
      legacyHeader.kdfVersion = LEGACY_KDF_VERSION
      legacyHeader.kdfParams = { ...LEGACY_KDF_PARAMS }
      
      const result = await attemptVaultUnlockWithMigration(password, salt, legacyHeader)
      
      expect(result.success).toBe(true)
      expect(result.needsMigration).toBe(true)
      expect(result.usedKdfVersion).toBe(LEGACY_KDF_VERSION)
    })

    it('should not need migration for current header', async () => {
      const password = 'test-password'
      const salt = crypto.getRandomValues(new Uint8Array(32))
      const currentHeader = createVaultHeader()
      
      const result = await attemptVaultUnlockWithMigration(password, salt, currentHeader)
      
      expect(result.success).toBe(true)
      expect(result.needsMigration).toBe(false)
      expect(result.usedKdfVersion).toBe(CURRENT_KDF_VERSION)
    })

    it('should return consistent key for same password and salt', async () => {
      const password = 'test-password'
      const salt = crypto.getRandomValues(new Uint8Array(32))
      
      const result1 = await attemptVaultUnlockWithMigration(password, salt, null)
      const result2 = await attemptVaultUnlockWithMigration(password, salt, null)
      
      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)
      
      // Both should derive to the same raw bytes
      if (result1.result && result2.result) {
        expect(constantTimeEqual(result1.result.rawBytes, result2.result.rawBytes)).toBe(true)
      }
    })

    it('should return different keys for different passwords', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(32))
      
      const result1 = await attemptVaultUnlockWithMigration('password1', salt, null)
      const result2 = await attemptVaultUnlockWithMigration('password2', salt, null)
      
      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)
      
      if (result1.result && result2.result) {
        expect(constantTimeEqual(result1.result.rawBytes, result2.result.rawBytes)).toBe(false)
      }
    })
  })

  describe('migrateKdf', () => {
    it('should derive key with current params', async () => {
      const password = 'test-password'
      const salt = crypto.getRandomValues(new Uint8Array(32))
      
      const migration = await migrateKdf(password, salt)
      
      expect(migration.newHeader.kdfVersion).toBe(CURRENT_KDF_VERSION)
      expect(migration.newHeader.kdfParams.memory).toBe(CURRENT_KDF_PARAMS.memory)
    })

    it('should create different key from legacy derivation', async () => {
      const password = 'test-password'
      const salt = crypto.getRandomValues(new Uint8Array(32))
      
      // First derive with legacy params
      const legacyResult = await attemptVaultUnlockWithMigration(password, salt, null)
      expect(legacyResult.success).toBe(true)
      
      // Then migrate
      const migration = await migrateKdf(password, salt)
      
      // Keys should be different (different KDF parameters)
      if (legacyResult.result) {
        expect(constantTimeEqual(legacyResult.result.rawBytes, migration.newRawBytes)).toBe(false)
      }
    })

    it('should create valid header with current timestamp', async () => {
      const before = Date.now()
      const migration = await migrateKdf('password', crypto.getRandomValues(new Uint8Array(32)))
      const after = Date.now()
      
      expect(migration.newHeader.createdAt).toBeGreaterThanOrEqual(before)
      expect(migration.newHeader.createdAt).toBeLessThanOrEqual(after)
      expect(migration.newHeader.kdfAlgorithm).toBe('argon2id')
      expect(migration.newHeader.aead).toBe('aes-256-gcm')
    })
  })

  describe('checkKdfMigrationNeeded', () => {
    it('should return true when no header exists', async () => {
      const needed = await checkKdfMigrationNeeded()
      expect(needed).toBe(true)
    })

    it('should return true for legacy header', async () => {
      const legacyHeader = createVaultHeader()
      legacyHeader.kdfVersion = LEGACY_KDF_VERSION
      storage[VAULT_HEADER_KEY] = legacyHeader
      
      const needed = await checkKdfMigrationNeeded()
      expect(needed).toBe(true)
    })

    it('should return false for current header', async () => {
      const currentHeader = createVaultHeader()
      storage[VAULT_HEADER_KEY] = currentHeader
      
      const needed = await checkKdfMigrationNeeded()
      expect(needed).toBe(false)
    })
  })
})
