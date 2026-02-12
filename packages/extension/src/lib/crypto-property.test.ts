import { describe, test, beforeEach, vi } from 'vitest'
import fc from 'fast-check'
import { encrypt, decrypt, deriveSubKey } from './crypto'
import { constantTimeEqual } from './crypto-utils'
import { migrateVaultWithRecovery } from './migration'
import type { Vault, VaultEntry } from '@lotus/shared'

// Mock storage for tests
const mockStorage: Record<string, unknown> = {}

describe('Crypto Property-Based Tests', () => {
  beforeEach(() => {
    // Clear mock storage before each test
    for (const key of Object.keys(mockStorage)) {
      delete mockStorage[key]
    }

    // Setup chrome.storage.local mock with working implementation
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (keys: string | string[]) => {
            if (Array.isArray(keys)) {
              const result: Record<string, unknown> = {}
              for (const key of keys) {
                if (key in mockStorage) {
                  result[key] = mockStorage[key]
                }
              }
              return result
            }
            if (typeof keys === 'string') {
              return keys in mockStorage ? { [keys]: mockStorage[keys] } : {}
            }
            return {}
          }),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(mockStorage, items)
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            if (Array.isArray(keys)) {
              for (const key of keys) {
                delete mockStorage[key]
              }
            } else {
              delete mockStorage[keys]
            }
          }),
        },
      },
    })
  })

  /**
   * Helper function to generate a test master key for HKDF derivation
   */
  async function generateTestMasterKey(): Promise<CryptoKey> {
    const rawKeyMaterial = crypto.getRandomValues(new Uint8Array(32))
    return crypto.subtle.importKey(
      'raw',
      rawKeyMaterial,
      { name: 'HKDF' },
      false,
      ['deriveKey']
    )
  }

  /**
   * Test: Encrypt/Decrypt Round-trip
   * 
   * Property: For any random data and context, encrypting then decrypting
   * should return the original data.
   */
  test('encrypt/decrypt roundtrip with random data', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 0, maxLength: 10000 }),
        fc.string({ minLength: 1, maxLength: 50 }), // context info
        async (data, context) => {
          const masterKey = await generateTestMasterKey()
          const key = await deriveSubKey(masterKey, context, ['encrypt', 'decrypt'])
          const encrypted = await encrypt(key, data.buffer)
          const decrypted = await decrypt(key, encrypted)
          return Buffer.from(decrypted).equals(Buffer.from(data))
        }
      ),
      { numRuns: 50 }
    )
  })

  /**
   * Test: Constant-time Comparison
   * 
   * Property: constantTimeEqual returns true if and only if the arrays match.
   * This should hold for all possible array pairs.
   */
  test('constantTimeEqual returns true iff arrays match', async () => {
    await fc.assert(
      fc.property(
        fc.uint8Array(),
        fc.uint8Array(),
        (a, b) => {
          const result = constantTimeEqual(a, b)
          const expected = Buffer.from(a).equals(Buffer.from(b))
          return result === expected
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * Test: KDF Determinism (using Web Crypto directly)
   * 
   * Property: For the same key material and info, HKDF subkey derivation
   * should always produce functionally equivalent keys (deterministic behavior).
   * We test by verifying both keys can encrypt/decrypt the same data.
   */
  test('HKDF subkey derivation produces consistent keys for same inputs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 32, maxLength: 32 }), // master key material
        fc.string({ minLength: 1, maxLength: 50 }), // info/context
        async (keyMaterial, info) => {
          // Import same raw material twice
          const masterKey1 = await crypto.subtle.importKey(
            'raw',
            keyMaterial,
            { name: 'HKDF' },
            false,
            ['deriveKey']
          )
          const masterKey2 = await crypto.subtle.importKey(
            'raw',
            keyMaterial,
            { name: 'HKDF' },
            false,
            ['deriveKey']
          )
          
          // Derive subkeys with same info
          const subKey1 = await deriveSubKey(masterKey1, info, ['encrypt', 'decrypt'])
          const subKey2 = await deriveSubKey(masterKey2, info, ['encrypt', 'decrypt'])
          
          // Test that both keys produce the same encryption result for same IV
          const plaintext = new TextEncoder().encode('test message')
          const iv = crypto.getRandomValues(new Uint8Array(12))
          
          const encrypted1 = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            subKey1,
            plaintext
          )
          const encrypted2 = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            subKey2,
            plaintext
          )
          
          return constantTimeEqual(new Uint8Array(encrypted1), new Uint8Array(encrypted2))
        }
      ),
      { numRuns: 30 }
    )
  })

  /**
   * Test: Different contexts produce different subkeys
   * 
   * Property: Different info/context strings should produce different subkeys
   * that cannot decrypt each other's data.
   */
  test('different HKDF contexts produce different subkeys', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 32, maxLength: 32 }), // master key material
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        async (keyMaterial, context1, context2) => {
          if (context1 === context2) return true // Skip identical contexts
          
          const masterKey = await crypto.subtle.importKey(
            'raw',
            keyMaterial,
            { name: 'HKDF' },
            false,
            ['deriveKey']
          )
          
          const subKey1 = await deriveSubKey(masterKey, context1, ['encrypt', 'decrypt'])
          const subKey2 = await deriveSubKey(masterKey, context2, ['encrypt', 'decrypt'])
          
          // Encrypt with key1
          const plaintext = new TextEncoder().encode('test message')
          const iv = crypto.getRandomValues(new Uint8Array(12))
          const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            subKey1,
            plaintext
          )
          
          // Try to decrypt with key2 - should fail
          try {
            await crypto.subtle.decrypt(
              { name: 'AES-GCM', iv },
              subKey2,
              encrypted
            )
            return false // Should not succeed
          } catch {
            return true // Expected to fail
          }
        }
      ),
      { numRuns: 20 }
    )
  })

  /**
   * Test: Vault Migration v1 -> v2 Preserves Entries
   * 
   * Property: After migrating a vault from v1 to v2, all entries should be preserved.
   */
  test('vault migration from v1 to v2 preserves all entries', async () => {
    // Arbitrary for generating vault entries
    const vaultEntryArbitrary = fc.record<VaultEntry>({
      id: fc.uuid(),
      type: fc.constantFrom('login', 'card', 'identity', 'note'),
      name: fc.string({ minLength: 1, maxLength: 100 }),
      favorite: fc.boolean(),
      created: fc.integer({ min: 0, max: Date.now() }),
      modified: fc.integer({ min: 0, max: Date.now() }),
      encryptedMetadata: fc.string(), // Can be empty for legacy entries
      login: fc.option(fc.record({
        urls: fc.array(fc.webUrl()),
        username: fc.string(),
        password: fc.string(),
        totp: fc.option(fc.record({
          secret: fc.string(),
          algorithm: fc.constantFrom('SHA1', 'SHA256', 'SHA512'),
          digits: fc.constantFrom(6, 8),
          period: fc.integer({ min: 30, max: 60 }),
          issuer: fc.option(fc.string(), { nil: undefined })
        }), { nil: undefined }),
        passkey: fc.option(fc.record({
          credentialId: fc.string(),
          rpId: fc.string(),
          rpName: fc.string(),
          userHandle: fc.string(),
          userName: fc.string(),
          privateKey: fc.string(),
          publicKey: fc.string(),
          signCount: fc.integer({ min: 0 }),
          created: fc.integer({ min: 0 })
        }), { nil: undefined }),
        customFields: fc.option(fc.array(fc.record({
          name: fc.string(),
          value: fc.string(),
          hidden: fc.boolean()
        })), { nil: undefined })
      }), { nil: undefined }),
      card: fc.option(fc.record({
        holder: fc.string(),
        number: fc.string(),
        expMonth: fc.string(),
        expYear: fc.string(),
        cvv: fc.string(),
        brand: fc.option(fc.string(), { nil: undefined })
      }), { nil: undefined }),
      identity: fc.option(fc.record({
        firstName: fc.string(),
        lastName: fc.string(),
        email: fc.string(),
        phone: fc.option(fc.string(), { nil: undefined }),
        address: fc.option(fc.record({
          street: fc.string(),
          city: fc.string(),
          state: fc.string(),
          zip: fc.string(),
          country: fc.string()
        }), { nil: undefined })
      }), { nil: undefined }),
      note: fc.option(fc.record({
        content: fc.string()
      }), { nil: undefined }),
      tags: fc.array(fc.string()),
      trashedAt: fc.option(fc.integer({ min: 0 }), { nil: undefined }),
      trashExpiresAt: fc.option(fc.integer({ min: 0 }), { nil: undefined })
    }, { requiredKeys: ['id', 'type', 'name', 'favorite', 'created', 'modified', 'tags', 'encryptedMetadata'] })

    const vaultArbitrary = fc.record<Vault>({
      version: fc.constant(1), // Legacy v1 vault
      entries: fc.array(vaultEntryArbitrary),
      folders: fc.array(fc.record({
        id: fc.uuid(),
        name: fc.string({ minLength: 1, maxLength: 100 })
      })),
      lastSync: fc.integer({ min: 0, max: Date.now() }),
      syncVersion: fc.integer({ min: 0 }),
      contentHash: fc.option(fc.string(), { nil: undefined })
    }, { requiredKeys: ['version', 'entries', 'folders', 'lastSync', 'syncVersion'] })

    await fc.assert(
      fc.asyncProperty(vaultArbitrary, async (legacyVault) => {
        const migrated = await migrateVaultWithRecovery(legacyVault, {})
        
        // Check that all entries are preserved
        const entryIdsMatch = legacyVault.entries.length === migrated.entries.length &&
          legacyVault.entries.every((entry, index) => 
            entry.id === migrated.entries[index]?.id
          )
        
        // Check version is updated
        const versionUpdated = migrated.version === 3
        
        // Check folders are preserved
        const foldersPreserved = legacyVault.folders.length === migrated.folders.length
        
        // Check sync metadata is preserved
        const syncPreserved = legacyVault.lastSync === migrated.lastSync &&
          legacyVault.syncVersion === migrated.syncVersion
        
        return entryIdsMatch && versionUpdated && foldersPreserved && syncPreserved
      }),
      { numRuns: 50 }
    )
  })
})
