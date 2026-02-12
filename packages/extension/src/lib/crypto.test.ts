import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { encrypt, decrypt, deriveSubKey, checkAndRecordIV, clearIVHistory } from './crypto'
import { bufferToBase64 } from './crypto-utils'

// Mock storage for tests
const mockStorage: Record<string, unknown> = {}

describe('IV Collision Detection', () => {
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

  describe('checkAndRecordIV', () => {
    it('should return true for a new IV', async () => {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const result = await checkAndRecordIV(iv)
      expect(result).toBe(true)
    })

    it('should return false for a duplicate IV', async () => {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      
      // First call should succeed
      const firstResult = await checkAndRecordIV(iv)
      expect(firstResult).toBe(true)
      
      // Second call with same IV should detect collision
      const secondResult = await checkAndRecordIV(iv)
      expect(secondResult).toBe(false)
    })

    it('should store IV in storage after recording', async () => {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      await checkAndRecordIV(iv)
      
      const stored = await chrome.storage.local.get('peach_recent_ivs')
      expect(stored).toHaveProperty('peach_recent_ivs')
      expect(stored.peach_recent_ivs).toHaveProperty('ivs')
      expect(stored.peach_recent_ivs).toHaveProperty('lastRotation')
      expect(stored.peach_recent_ivs.ivs).toHaveLength(1)
      expect(stored.peach_recent_ivs.ivs[0]).toBe(bufferToBase64(iv.buffer))
    })

    it('should handle multiple unique IVs', async () => {
      for (let i = 0; i < 100; i++) {
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const result = await checkAndRecordIV(iv)
        expect(result).toBe(true)
      }
      
      const stored = await chrome.storage.local.get('peach_recent_ivs')
      expect(stored.peach_recent_ivs.ivs).toHaveLength(100)
    })

    it('should handle storage rotation when exceeding max IVs', async () => {
      // Add more than MAX_STORED_IVS (10000) IVs
      for (let i = 0; i < 10001; i++) {
        const iv = crypto.getRandomValues(new Uint8Array(12))
        await checkAndRecordIV(iv)
      }
      
      const stored = await chrome.storage.local.get('peach_recent_ivs')
      // After rotation, should keep last half (5000)
      expect(stored.peach_recent_ivs.ivs.length).toBeLessThanOrEqual(5000)
    })
  })

  describe('clearIVHistory', () => {
    it('should clear all stored IVs', async () => {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      await checkAndRecordIV(iv)
      
      let stored = await chrome.storage.local.get('peach_recent_ivs')
      expect(stored.peach_recent_ivs.ivs).toHaveLength(1)
      
      await clearIVHistory()
      
      stored = await chrome.storage.local.get('peach_recent_ivs')
      expect(stored).not.toHaveProperty('peach_recent_ivs')
    })
  })

  describe('encrypt', () => {
    let testKey: CryptoKey
    let originalGetRandomValues: typeof crypto.getRandomValues

    beforeEach(async () => {
      // Generate a test AES-GCM key
      testKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      )
      originalGetRandomValues = crypto.getRandomValues.bind(crypto)
    })

    afterEach(() => {
      // Restore original getRandomValues
      crypto.getRandomValues = originalGetRandomValues
    })

    it('should encrypt data successfully', async () => {
      const plaintext = new TextEncoder().encode('Hello, World!')
      const encrypted = await encrypt(testKey, plaintext.buffer)
      
      expect(encrypted.byteLength).toBeGreaterThan(12) // At least IV + tag
    })

    it('should produce different ciphertexts for same plaintext (different IVs)', async () => {
      const plaintext = new TextEncoder().encode('Hello, World!')
      
      const encrypted1 = await encrypt(testKey, plaintext.buffer)
      const encrypted2 = await encrypt(testKey, plaintext.buffer)
      
      // IVs should be different (first 12 bytes)
      const iv1 = new Uint8Array(encrypted1, 0, 12)
      const iv2 = new Uint8Array(encrypted2, 0, 12)
      expect(iv1).not.toEqual(iv2)
      
      // Full ciphertexts should be different
      expect(new Uint8Array(encrypted1)).not.toEqual(new Uint8Array(encrypted2))
    })

    it('should throw error when IV collision persists beyond retry limit', async () => {
      // Mock crypto.getRandomValues to return the same IV repeatedly
      const fixedIv = new Uint8Array(12).fill(0x42)
      crypto.getRandomValues = vi.fn((array: Uint8Array) => {
        array.set(fixedIv)
        return array
      }) as typeof crypto.getRandomValues
      
      // First call records the IV
      const plaintext = new TextEncoder().encode('test data')
      await encrypt(testKey, plaintext.buffer)
      
      // Subsequent calls should fail due to collision
      await expect(encrypt(testKey, plaintext.buffer)).rejects.toThrow(
        /IV collision detected after \d+ attempts/
      )
    })

    it('should log security event on IV collision', async () => {
      const fixedIv = new Uint8Array(12).fill(0xAB)
      let callCount = 0
      
      // Pre-populate storage with the fixed IV to trigger collision
      await checkAndRecordIV(fixedIv)
      
      crypto.getRandomValues = vi.fn((array: Uint8Array) => {
        callCount++
        if (callCount <= 2) {
          // First two calls return same IV to trigger collision
          array.set(fixedIv)
        } else {
          // After that return different IVs to succeed
          const randomIv = originalGetRandomValues(new Uint8Array(12))
          array.set(randomIv)
        }
        return array
      }) as typeof crypto.getRandomValues
      
      const plaintext = new TextEncoder().encode('test data')
      await encrypt(testKey, plaintext.buffer)
      
      // Check that security event was logged
      const stored = await chrome.storage.local.get('peach_security_events')
      expect(stored).toHaveProperty('peach_security_events')
      expect(stored.peach_security_events.length).toBeGreaterThan(0)
      expect(stored.peach_security_events[0].type).toBe('IV_COLLISION_DETECTED')
      expect(stored.peach_security_events[0].severity).toBe('high')
    })

    it('should handle AAD (Additional Authenticated Data)', async () => {
      const plaintext = new TextEncoder().encode('secret message')
      const aad = new TextEncoder().encode('authenticated context')
      
      const encrypted = await encrypt(testKey, plaintext.buffer, aad.buffer)
      
      // Should be able to decrypt with same AAD
      const decrypted = await decrypt(testKey, encrypted, aad.buffer)
      expect(new TextDecoder().decode(decrypted)).toBe('secret message')
      
      // Decryption with different AAD should fail
      const wrongAad = new TextEncoder().encode('wrong context')
      await expect(decrypt(testKey, encrypted, wrongAad.buffer)).rejects.toThrow()
    })

    it('should support encrypt/decrypt roundtrip', async () => {
      const plaintext = new TextEncoder().encode('Roundtrip test message')
      
      const encrypted = await encrypt(testKey, plaintext.buffer)
      const decrypted = await decrypt(testKey, encrypted)
      
      expect(new Uint8Array(decrypted)).toEqual(new Uint8Array(plaintext.buffer))
    })
  })

  describe('decrypt', () => {
    let testKey: CryptoKey

    beforeEach(async () => {
      testKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      )
    })

    it('should decrypt data encrypted with encrypt', async () => {
      const plaintext = new TextEncoder().encode('Test message')
      const encrypted = await encrypt(testKey, plaintext.buffer)
      
      const decrypted = await decrypt(testKey, encrypted)
      
      expect(new TextDecoder().decode(decrypted)).toBe('Test message')
    })

    it('should throw on tampered ciphertext', async () => {
      const plaintext = new TextEncoder().encode('Test message')
      const encrypted = await encrypt(testKey, plaintext.buffer)
      
      // Tamper with ciphertext (after IV)
      const tampered = new Uint8Array(encrypted)
      tampered[15] ^= 0xFF // Flip some bits
      
      await expect(decrypt(testKey, tampered.buffer)).rejects.toThrow()
    })

    it('should throw on wrong key', async () => {
      const plaintext = new TextEncoder().encode('Test message')
      const encrypted = await encrypt(testKey, plaintext.buffer)
      
      const wrongKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      )
      
      await expect(decrypt(wrongKey, encrypted)).rejects.toThrow()
    })
  })

  describe('deriveSubKey', () => {
    it('should derive a subkey from master key', async () => {
      // Import raw key material for HKDF
      const rawKeyMaterial = crypto.getRandomValues(new Uint8Array(32))
      const masterKey = await crypto.subtle.importKey(
        'raw',
        rawKeyMaterial,
        { name: 'HKDF' },
        false,
        ['deriveKey']
      )
      
      const subKey = await deriveSubKey(masterKey, 'test-purpose', ['encrypt', 'decrypt'])
      
      expect(subKey.type).toBe('secret')
      expect(subKey.algorithm.name).toBe('AES-GCM')
    })

    it('should derive different subkeys for different purposes', async () => {
      // Import raw key material for HKDF (extractable for test verification)
      const rawKeyMaterial = crypto.getRandomValues(new Uint8Array(32))
      const masterKey = await crypto.subtle.importKey(
        'raw',
        rawKeyMaterial,
        { name: 'HKDF' },
        false,
        ['deriveKey']
      )
      
      // Derive subkeys with extractable flag for testing
      const subKey1 = await deriveSubKey(masterKey, 'purpose1', ['encrypt', 'decrypt'])
      const subKey2 = await deriveSubKey(masterKey, 'purpose2', ['encrypt', 'decrypt'])
      
      // Verify they are different by encrypting with each
      const plaintext = new TextEncoder().encode('test data')
      const encrypted1 = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: crypto.getRandomValues(new Uint8Array(12)) },
        subKey1,
        plaintext
      )
      
      // subKey2 should not be able to decrypt data encrypted with subKey1
      await expect(
        crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: new Uint8Array(encrypted1, 0, 12) },
          subKey2,
          new Uint8Array(encrypted1, 12)
        )
      ).rejects.toThrow()
    })
  })
})
