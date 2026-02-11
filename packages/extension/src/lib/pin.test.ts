import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPin,
  clearPinLockout,
  decryptMasterKeyWithPin,
  getPinLockoutStatus,
  hasPin,
  recordFailedPinAttempt,
  setPin
} from './pin'

const storage: Record<string, unknown> = {}

describe('PIN helper', () => {
  beforeEach(() => {
    vi.useRealTimers()

    for (const key of Object.keys(storage)) {
      delete storage[key]
    }

    ;(chrome.storage.local.get as any).mockImplementation(async (keys: string | string[] | Record<string, unknown> | null) => {
      if (keys === null) return { ...storage }
      if (Array.isArray(keys)) {
        const result: Record<string, unknown> = {}
        for (const key of keys) result[key] = storage[key]
        return result
      }
      if (typeof keys === 'object') {
        const result: Record<string, unknown> = {}
        for (const key of Object.keys(keys)) {
          result[key] = storage[key] ?? (keys as Record<string, unknown>)[key]
        }
        return result
      }
      return { [keys]: storage[keys] }
    })

    ;(chrome.storage.local.set as any).mockImplementation(async (items: Record<string, unknown>) => {
      Object.assign(storage, items)
    })

    ;(chrome.storage.local.remove as any).mockImplementation(async (keys: string | string[]) => {
      const toRemove = Array.isArray(keys) ? keys : [keys]
      for (const key of toRemove) delete storage[key]
    })
  })

  it('encrypts and decrypts master key with valid PIN', async () => {
    const rawMasterKey = crypto.getRandomValues(new Uint8Array(32))
    await setPin('123456', rawMasterKey)

    const decrypted = await decryptMasterKeyWithPin('123456')
    expect(decrypted).not.toBeNull()
    expect(Array.from(decrypted as Uint8Array)).toEqual(Array.from(rawMasterKey))
  })

  it('returns null with invalid PIN', async () => {
    const rawMasterKey = crypto.getRandomValues(new Uint8Array(32))
    await setPin('123456', rawMasterKey)

    const decrypted = await decryptMasterKeyWithPin('000000')
    expect(decrypted).toBeNull()
  })

  it('tracks and clears PIN storage', async () => {
    const rawMasterKey = crypto.getRandomValues(new Uint8Array(32))
    expect(await hasPin()).toBe(false)

    await setPin('123456', rawMasterKey)
    expect(await hasPin()).toBe(true)

    await clearPin()
    expect(await hasPin()).toBe(false)
  })

  it('locks temporarily after repeated failed attempts', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

    for (let i = 0; i < 5; i += 1) {
      const attempt = await recordFailedPinAttempt()
      expect(attempt.isLocked).toBe(false)
    }

    const sixthAttempt = await recordFailedPinAttempt()
    expect(sixthAttempt.isLocked).toBe(true)
    expect(sixthAttempt.remainingMs).toBeGreaterThan(0)

    const lockStatus = await getPinLockoutStatus()
    expect(lockStatus.isLocked).toBe(true)

    vi.advanceTimersByTime(lockStatus.remainingMs + 1000)
    const afterWait = await getPinLockoutStatus()
    expect(afterWait.isLocked).toBe(false)
  })

  it('clears lockout data explicitly', async () => {
    await recordFailedPinAttempt()
    await clearPinLockout()
    const lockStatus = await getPinLockoutStatus()
    expect(lockStatus.isLocked).toBe(false)
  })
})
