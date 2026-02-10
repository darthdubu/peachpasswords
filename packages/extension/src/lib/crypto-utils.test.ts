import { describe, it, expect } from 'vitest'
import {
  generateSalt,
  bufferToBase64,
  base64ToBuffer,
  secureWipe,
  computeVaultHash,
  verifyVaultIntegrity,
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
})
