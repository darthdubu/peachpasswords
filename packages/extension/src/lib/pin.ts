const PIN_STORAGE_KEY = 'peach_pin_data'
const PIN_ATTEMPT_STORAGE_KEY = 'peach_pin_attempts'
const PIN_MAX_ATTEMPTS_BEFORE_LOCK = 5
const PIN_MAX_LOCK_MS = 60 * 60 * 1000

interface PinData {
  salt: number[]
  encryptedKey: number[]
}

interface PinAttemptData {
  failedAttempts: number
  lockUntil: number
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength)
  copy.set(view)
  return copy.buffer
}

async function deriveKeyFromPin(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const pinData = encoder.encode(pin)

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    pinData,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function setPin(pin: string, rawMasterKey: Uint8Array): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKeyFromPin(pin, salt)
  
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    toArrayBuffer(rawMasterKey)
  )
  
  const combined = new Uint8Array(iv.length + encrypted.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(encrypted), iv.length)
  
  const pinData: PinData = {
    salt: Array.from(salt),
    encryptedKey: Array.from(combined)
  }
  
  await chrome.storage.local.set({ [PIN_STORAGE_KEY]: pinData })
  await clearPinLockout()
}

export async function decryptMasterKeyWithPin(pin: string): Promise<Uint8Array | null> {
  const result = await chrome.storage.local.get(PIN_STORAGE_KEY)
  if (!result[PIN_STORAGE_KEY]) return null
  
  const pinData: PinData = result[PIN_STORAGE_KEY]
  const salt = new Uint8Array(pinData.salt)
  const combined = new Uint8Array(pinData.encryptedKey)
  
  const iv = combined.slice(0, 12)
  const ciphertext = combined.slice(12)
  
  try {
    const key = await deriveKeyFromPin(pin, salt)
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      key,
      toArrayBuffer(ciphertext)
    )
    return new Uint8Array(decrypted)
  } catch {
    return null
  }
}

export async function hasPin(): Promise<boolean> {
  const result = await chrome.storage.local.get(PIN_STORAGE_KEY)
  return !!result[PIN_STORAGE_KEY]
}

export async function clearPin(): Promise<void> {
  await chrome.storage.local.remove(PIN_STORAGE_KEY)
  await clearPinLockout()
}

export async function getPinLockoutStatus(): Promise<{ isLocked: boolean; remainingMs: number }> {
  const result = await chrome.storage.local.get(PIN_ATTEMPT_STORAGE_KEY)
  const attempts = result[PIN_ATTEMPT_STORAGE_KEY] as PinAttemptData | undefined
  if (!attempts || !attempts.lockUntil) {
    return { isLocked: false, remainingMs: 0 }
  }

  const remainingMs = attempts.lockUntil - Date.now()
  if (remainingMs <= 0) {
    await clearPinLockout()
    return { isLocked: false, remainingMs: 0 }
  }

  return { isLocked: true, remainingMs }
}

export async function recordFailedPinAttempt(): Promise<{ isLocked: boolean; remainingMs: number; failedAttempts: number }> {
  const result = await chrome.storage.local.get(PIN_ATTEMPT_STORAGE_KEY)
  const current = (result[PIN_ATTEMPT_STORAGE_KEY] as PinAttemptData | undefined) ?? {
    failedAttempts: 0,
    lockUntil: 0
  }

  if (current.lockUntil > Date.now()) {
    return {
      isLocked: true,
      remainingMs: current.lockUntil - Date.now(),
      failedAttempts: current.failedAttempts
    }
  }

  const failedAttempts = current.failedAttempts + 1
  const lockStep = Math.max(0, failedAttempts - PIN_MAX_ATTEMPTS_BEFORE_LOCK)
  const lockDurationMs = lockStep > 0
    ? Math.min(30_000 * 2 ** (lockStep - 1), PIN_MAX_LOCK_MS)
    : 0
  const lockUntil = lockDurationMs > 0 ? Date.now() + lockDurationMs : 0

  await chrome.storage.local.set({
    [PIN_ATTEMPT_STORAGE_KEY]: {
      failedAttempts,
      lockUntil
    }
  })

  return {
    isLocked: lockDurationMs > 0,
    remainingMs: lockDurationMs,
    failedAttempts
  }
}

export async function clearPinLockout(): Promise<void> {
  await chrome.storage.local.remove(PIN_ATTEMPT_STORAGE_KEY)
}
