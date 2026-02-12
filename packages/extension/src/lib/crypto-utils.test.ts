import { describe, it, expect } from 'vitest'
import {
  generateSalt,
  bufferToBase64,
  base64ToBuffer,
  secureWipe,
  constantTimeEqual,
  computeVaultHash,
  verifyVaultIntegrity,
  padVaultPlaintext,
  unpadVaultPlaintext,
} from '../lib/crypto-utils'

describe('Crypto Utilities', () => {
  describe('generateSalt', () => {
    it('should generate 32-byte salt', async () => {
      const salt = await generateSalt()
      expect(salt).toBeInstanceOf(Uint8Array)
      expect(salt.length).toBe(32)
    })

    it('should generate unique salts', async () => {
      const salt1 = await generateSalt()
      const salt2 = await generateSalt()
      expect(salt1).not.toEqual(salt2)
    })
  })

  describe('bufferToBase64 / base64ToBuffer', () => {
    it('should convert buffer to base64 and back', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5])
      const base64 = bufferToBase64(original.buffer)
      const decoded = base64ToBuffer(base64)
      expect(new Uint8Array(decoded)).toEqual(original)
    })

    it('should handle empty buffers', () => {
      const original = new Uint8Array(0)
      const base64 = bufferToBase64(original.buffer)
      const decoded = base64ToBuffer(base64)
      expect(new Uint8Array(decoded)).toEqual(original)
    })
  })

  describe('secureWipe', () => {
    it('should zero out ArrayBuffer', () => {
      const buffer = new ArrayBuffer(32)
      const view = new Uint8Array(buffer)
      view.fill(0xFF)
      secureWipe(buffer)
      expect(new Uint8Array(buffer).every(b => b === 0)).toBe(true)
    })

    it('should zero out Uint8Array', () => {
      const arr = new Uint8Array(32)
      arr.fill(0xFF)
      secureWipe(arr)
      expect(arr.every(b => b === 0)).toBe(true)
    })

    it('should handle null/undefined', () => {
      expect(() => secureWipe(null)).not.toThrow()
      expect(() => secureWipe(undefined)).not.toThrow()
    })
  })

  describe('computeVaultHash', () => {
    it('should compute consistent hash for same vault', async () => {
      const vault = {
        entries: [{ id: 'entry1' }, { id: 'entry2' }],
        syncVersion: 1,
      }
      const hash1 = await computeVaultHash(vault)
      const hash2 = await computeVaultHash(vault)
      expect(hash1).toBe(hash2)
    })

    it('should produce different hashes for different vaults', async () => {
      const vault1 = { entries: [{ id: 'entry1' }], syncVersion: 1 }
      const vault2 = { entries: [{ id: 'entry2' }], syncVersion: 1 }
      const hash1 = await computeVaultHash(vault1)
      const hash2 = await computeVaultHash(vault2)
      expect(hash1).not.toBe(hash2)
    })
  })

  describe('verifyVaultIntegrity', () => {
    it('should return true for vault without hash', async () => {
      const vault = { entries: [{ id: 'entry1' }], syncVersion: 1 }
      const result = await verifyVaultIntegrity(vault)
      expect(result).toBe(true)
    })

    it('should return true for valid hash', async () => {
      const vault = {
        entries: [{ id: 'entry1' }],
        syncVersion: 1,
        contentHash: await computeVaultHash({ entries: [{ id: 'entry1' }], syncVersion: 1 }),
      }
      const result = await verifyVaultIntegrity(vault)
      expect(result).toBe(true)
    })

    it('should return false for tampered vault', async () => {
      const vault = {
        entries: [{ id: 'entry1' }, { id: 'entry2' }],
        syncVersion: 1,
        contentHash: await computeVaultHash({ entries: [{ id: 'entry1' }], syncVersion: 1 }),
      }
      const result = await verifyVaultIntegrity(vault)
      expect(result).toBe(false)
    })
  })

  describe('constantTimeEqual', () => {
    it('should return true for identical arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5])
      const b = new Uint8Array([1, 2, 3, 4, 5])
      expect(constantTimeEqual(a, b)).toBe(true)
    })

    it('should return false for different arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5])
      const b = new Uint8Array([5, 4, 3, 2, 1])
      expect(constantTimeEqual(a, b)).toBe(false)
    })

    it('should return false for arrays with single byte difference', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5])
      const b = new Uint8Array([1, 2, 3, 4, 6])
      expect(constantTimeEqual(a, b)).toBe(false)
    })

    it('should return false for different length arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5])
      const b = new Uint8Array([1, 2, 3, 4])
      expect(constantTimeEqual(a, b)).toBe(false)
    })

    it('should return true for empty arrays', () => {
      const a = new Uint8Array(0)
      const b = new Uint8Array(0)
      expect(constantTimeEqual(a, b)).toBe(true)
    })

    it('should return false when first array is longer', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5, 6])
      const b = new Uint8Array([1, 2, 3, 4, 5])
      expect(constantTimeEqual(a, b)).toBe(false)
    })

    it('should return false when second array is longer', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5])
      const b = new Uint8Array([1, 2, 3, 4, 5, 6])
      expect(constantTimeEqual(a, b)).toBe(false)
    })

    it('should handle arrays with all zero bytes', () => {
      const a = new Uint8Array([0, 0, 0, 0])
      const b = new Uint8Array([0, 0, 0, 0])
      expect(constantTimeEqual(a, b)).toBe(true)
    })

    it('should handle arrays with all same non-zero bytes', () => {
      const a = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF])
      const b = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF])
      expect(constantTimeEqual(a, b)).toBe(true)
    })

    it('should handle single byte arrays', () => {
      expect(constantTimeEqual(new Uint8Array([0]), new Uint8Array([0]))).toBe(true)
      expect(constantTimeEqual(new Uint8Array([1]), new Uint8Array([1]))).toBe(true)
      expect(constantTimeEqual(new Uint8Array([0]), new Uint8Array([1]))).toBe(false)
    })
  })

  describe('padVaultPlaintext', () => {
    it('should pad data to 4KB boundary', () => {
      const plaintext = new TextEncoder().encode('Hello, World!')
      const padded = padVaultPlaintext(plaintext)
      
      // Should be exactly 4096 bytes (one block)
      expect(padded.length).toBe(4096)
      
      // First part should be the original data
      expect(Array.from(padded.slice(0, plaintext.length))).toEqual(Array.from(plaintext))
      
      // Last 2 bytes should indicate padding length in big-endian
      const padLength = 4096 - plaintext.length
      expect(padded[padded.length - 2]).toBe((padLength >> 8) & 0xFF)
      expect(padded[padded.length - 1]).toBe(padLength & 0xFF)
    })

    it('should add full block when data is exactly at boundary', () => {
      const plaintext = new Uint8Array(4096)
      plaintext.fill(0x42)
      
      const padded = padVaultPlaintext(plaintext)
      
      // Should be 8192 bytes (two blocks - original + full padding block)
      expect(padded.length).toBe(8192)
      
      // First block should be original data
      expect(Array.from(padded.slice(0, 4096))).toEqual(Array.from(plaintext))
      
      // Last 2 bytes should indicate 4096 bytes of padding (big-endian)
      expect(padded[padded.length - 2]).toBe(0x10) // 4096 >> 8 = 16
      expect(padded[padded.length - 1]).toBe(0x00) // 4096 & 0xFF = 0
    })

    it('should pad multiple blocks correctly', () => {
      const plaintext = new Uint8Array(5000) // More than 4KB
      plaintext.fill(0x42)
      
      const padded = padVaultPlaintext(plaintext)
      
      // Should be 8192 bytes (two blocks)
      expect(padded.length).toBe(8192)
      
      // Verify padding length in last 2 bytes
      const padLength = 8192 - 5000
      expect((padded[padded.length - 2] << 8) | padded[padded.length - 1]).toBe(padLength)
    })

    it('should handle empty data', () => {
      const plaintext = new Uint8Array(0)
      const padded = padVaultPlaintext(plaintext)
      
      // Should be 4096 bytes (one block of padding)
      expect(padded.length).toBe(4096)
      
      // All bytes except last 2 should be zero
      expect(padded.slice(0, padded.length - 2).every(b => b === 0)).toBe(true)
      
      // Last 2 bytes should indicate 4096 bytes of padding (big-endian)
      expect(padded[padded.length - 2]).toBe(0x10) // 4096 >> 8 = 16
      expect(padded[padded.length - 1]).toBe(0x00) // 4096 & 0xFF = 0
    })
  })

  describe('unpadVaultPlaintext', () => {
    it('should unpad data padded by padVaultPlaintext', () => {
      const original = new TextEncoder().encode('Hello, World! This is a test message.')
      const padded = padVaultPlaintext(original)
      const unpadded = unpadVaultPlaintext(padded)
      
      expect(Array.from(unpadded)).toEqual(Array.from(original))
    })

    it('should return original data if no valid padding marker', () => {
      const original = new TextEncoder().encode('Short')
      const unpadded = unpadVaultPlaintext(original)
      
      // No valid padding detected (length too small), should return as-is
      expect(Array.from(unpadded)).toEqual(Array.from(original))
    })

    it('should handle empty array', () => {
      const empty = new Uint8Array(0)
      const unpadded = unpadVaultPlaintext(empty)
      
      expect(Array.from(unpadded)).toEqual(Array.from(empty))
    })

    it('should return as-is if padding length is invalid', () => {
      // Create array with invalid padding length in last 2 bytes
      const data = new Uint8Array([1, 2, 3, 0, 255]) // Claims 255 bytes of padding but only 5 bytes
      const unpadded = unpadVaultPlaintext(data)
      
      // Should return original because padding length exceeds array size
      expect(Array.from(unpadded)).toEqual(Array.from(data))
    })

    it('should return as-is if padding bytes are not zeros', () => {
      // Create array with non-zero padding bytes
      const data = new Uint8Array(10)
      data.fill(0)
      data[5] = 1 // Non-zero byte in padding area
      data[8] = 0 // padding length high byte (0)
      data[9] = 5 // padding length low byte (5)
      
      const unpadded = unpadVaultPlaintext(data)
      
      // Should return original because padding bytes should be zeros
      expect(Array.from(unpadded)).toEqual(Array.from(data))
    })

    it('should correctly unpad full block padding', () => {
      const original = new Uint8Array(4096)
      original.fill(0x42)
      
      const padded = padVaultPlaintext(original)
      const unpadded = unpadVaultPlaintext(padded)
      
      expect(Array.from(unpadded)).toEqual(Array.from(original))
    })

    it('should round-trip JSON data correctly', () => {
      const vaultData = JSON.stringify({
        version: 1,
        entries: [{ id: 'test', name: 'Test Entry' }],
        syncVersion: 5
      })
      const original = new TextEncoder().encode(vaultData)
      
      const padded = padVaultPlaintext(original)
      const unpadded = unpadVaultPlaintext(padded)
      
      // Verify we can parse the unpadded data
      const decoded = JSON.parse(new TextDecoder().decode(unpadded))
      expect(decoded).toEqual(JSON.parse(vaultData))
    })
  })
})
