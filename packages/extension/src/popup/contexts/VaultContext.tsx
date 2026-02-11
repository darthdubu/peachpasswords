import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { Vault, VaultEntry } from '@lotus/shared'
import { deriveKeyFromPasswordWithRaw, encrypt, decrypt, generateSalt, bufferToBase64, base64ToBuffer, deriveSubKey, encryptSettings, decryptSettings, EncryptedSettings, computeVaultHash, verifyVaultIntegrity } from '../../lib/crypto-utils'
import { authenticateWithBiometric } from '../../lib/biometric'
import { STORAGE_KEYS } from '../../lib/constants'
import { useSync } from '../hooks/useSync'
import { useS3Sync } from '../hooks/useS3Sync'

interface VaultContextType {
  vault: Vault | null
  isUnlocked: boolean
  masterKey: CryptoKey | null
  unlockVault: (password: string) => Promise<boolean>
  unlockWithBiometric: () => Promise<boolean>
  unlockWithPin: (pin: string) => Promise<boolean>
  lockVault: () => void
  createVault: (password: string) => Promise<void>
  addEntry: (entry: VaultEntry) => Promise<void>
  importEntries: (entries: VaultEntry[]) => Promise<void>
  updateEntry: (entry: VaultEntry) => Promise<void>
  deleteEntry: (entryId: string) => Promise<void>
  getEntry: (entryId: string) => VaultEntry | null
  searchEntries: (query: string) => VaultEntry[]
  encryptValue: (value: string, entryId: string, modified?: number) => Promise<string>
  decryptValue: (ciphertext: string, entryId: string, modified?: number) => Promise<string>
  isLoading: boolean
  error: string | null
  vaultExists: boolean
  syncStatus: 'disconnected' | 'connecting' | 'connected' | 'error' | 'offline'
  syncError: string | null
  lastSyncTime: number | null
  s3SyncStatus: 'disconnected' | 'connecting' | 'connected' | 'error'
  pendingSave: { url: string, username: string, password: string } | null
  clearPendingSave: () => void
  encryptSettingsData: (settings: Record<string, string>) => Promise<EncryptedSettings | null>
  decryptSettingsData: (encrypted: EncryptedSettings) => Promise<Record<string, string> | null>
}

const VaultContext = createContext<VaultContextType | undefined>(undefined)

export const useVault = () => {
  const context = useContext(VaultContext)
  if (!context) {
    throw new Error('useVault must be used within a VaultProvider')
  }
  return context
}

function formatRemaining(remainingMs: number): string {
  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength)
  copy.set(view)
  return copy.buffer
}

async function decryptVaultPayload(
  vaultKey: CryptoKey,
  encryptedVault: Uint8Array,
  aadHint?: string,
  syncVersionHint?: number
): Promise<ArrayBuffer | null> {
  const encryptedBuffer = toArrayBuffer(encryptedVault)
  try {
    return await decrypt(vaultKey, encryptedBuffer)
  } catch {
    // Continue with AAD-based decrypt attempts
  }

  const tried = new Set<string>()
  const tryWithAad = async (aadValue: string): Promise<ArrayBuffer | null> => {
    if (tried.has(aadValue)) return null
    tried.add(aadValue)
    try {
      const aad = new TextEncoder().encode(aadValue).buffer as ArrayBuffer
      return await decrypt(vaultKey, encryptedBuffer, aad)
    } catch {
      return null
    }
  }

  if (aadHint) {
    const decryptedWithHint = await tryWithAad(aadHint)
    if (decryptedWithHint) return decryptedWithHint
  }

  if (typeof syncVersionHint === 'number' && Number.isFinite(syncVersionHint) && syncVersionHint >= 0) {
    const hintedAad = `vault:1:${Math.floor(syncVersionHint)}`
    const decryptedWithSyncHint = await tryWithAad(hintedAad)
    if (decryptedWithSyncHint) return decryptedWithSyncHint
  }

  for (let syncVersion = 0; syncVersion <= 10; syncVersion += 1) {
    const decrypted = await tryWithAad(`vault:1:${syncVersion}`)
    if (decrypted) return decrypted
  }

  // Migration recovery path for old installs that lack stored AAD hints.
  // We bound this loop to avoid excessive unlock latency.
  for (let syncVersion = 11; syncVersion <= 5000; syncVersion += 1) {
    const decrypted = await tryWithAad(`vault:1:${syncVersion}`)
    if (decrypted) return decrypted
  }

  return null
}

export const VaultProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [vault, setVault] = useState<Vault | null>(null)
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [vaultExists, setVaultExists] = useState(false)
  const [pendingSave, setPendingSave] = useState<{ url: string, username: string, password: string } | null>(null)
  const skipScheduleOnCloseRef = useRef(false)

  const saveVault = async (vaultData: Vault, key: CryptoKey) => {
    // LOTUS-005: Compute content hash before saving
    const contentHash = await computeVaultHash(vaultData)
    const vaultWithHash = { ...vaultData, contentHash }

    // Derive vault encryption key from master key
    const vaultKey = await deriveSubKey(key, 'vault-main', ['encrypt', 'decrypt'])

    const vaultBytes = new TextEncoder().encode(JSON.stringify(vaultWithHash))
    const dataBuffer = vaultBytes.byteLength === vaultBytes.buffer.byteLength
      ? vaultBytes.buffer
      : vaultBytes.buffer.slice(vaultBytes.byteOffset, vaultBytes.byteOffset + vaultBytes.byteLength)

    // LOTUS-009: Use AAD (version + syncVersion) for vault encryption
    const aad = new TextEncoder().encode(`vault:${vaultData.version}:${vaultData.syncVersion}`).buffer as ArrayBuffer
    const encryptedVault = await encrypt(vaultKey, dataBuffer as ArrayBuffer, aad)

    await chrome.storage.local.set({
      vault: Array.from(new Uint8Array(encryptedVault)),
      lastSync: vaultData.lastSync,
      vaultAad: `vault:${vaultData.version}:${vaultData.syncVersion}`,
      vaultSyncVersion: vaultData.syncVersion
    })
  }

  const handlePull = useCallback(async (newVault: Vault) => {
    if (!masterKey) return
    setVault(newVault)
    await saveVault(newVault, masterKey)
  }, [masterKey])

  const { syncStatus, syncError, lastSyncTime } = useSync(vault, masterKey, handlePull)
  const { s3Status } = useS3Sync(vault, masterKey, handlePull)

  const lockVault = useCallback(async () => {
    skipScheduleOnCloseRef.current = true
    setVault(null)
    setIsUnlocked(false)
    setMasterKey(null)
    // Clear sensitive data from memory
    // SECURITY FIX (LOTUS-001): Do NOT remove 'vault' - encrypted vault should persist
    chrome.storage.session.remove(['masterKey', 'masterKeyRaw', 'autofillKey', 'autofillData'])
    // LOTUS-014: Notify background to clear alarm
    await chrome.runtime.sendMessage({ type: 'LOCK_NOW' }).catch(() => {})
  }, [])

  const getIdleTimeoutMs = useCallback(async (): Promise<number> => {
    const result = await chrome.storage.local.get([STORAGE_KEYS.SETTINGS])
    const settings = result[STORAGE_KEYS.SETTINGS]

    if (settings?.encrypted && masterKey) {
      const decrypted = await decryptSettings(masterKey, settings.encrypted as EncryptedSettings)
      const encryptedMinutes = Number(decrypted?.idleTimeoutMinutes)
      if (Number.isFinite(encryptedMinutes) && encryptedMinutes > 0) {
        return encryptedMinutes * 60 * 1000
      }
    }

    const plainMinutes = Number(settings?.idleTimeoutMinutes)
    if (Number.isFinite(plainMinutes) && plainMinutes > 0) {
      return plainMinutes * 60 * 1000
    }

    return 5 * 60 * 1000
  }, [masterKey])

  // Auto-lock functionality using chrome.alarms (LOTUS-014)
  const scheduleLockAlarm = useCallback(async () => {
    const idleTimeoutMs = await getIdleTimeoutMs()
    chrome.runtime.sendMessage({ 
      type: 'SCHEDULE_LOCK', 
      delayMs: idleTimeoutMs 
    }).catch(() => {})
  }, [getIdleTimeoutMs])

  const clearLockAlarm = useCallback(async () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_LOCK' }).catch(() => {})
  }, [])



  const createVault = useCallback(async (password: string) => {
    setIsLoading(true)
    try {
      const salt = await generateSalt()
      const { key, rawBytes } = await deriveKeyFromPasswordWithRaw(password, salt)
      
      const newVault: Vault = {
        version: 1,
        entries: [],
        folders: [],
        lastSync: Date.now(),
        syncVersion: 0
      }
      
      // Save salt separately
      await chrome.storage.local.set({ salt: Array.from(salt) })
      
      setVault(newVault)
      setMasterKey(key)
      setIsUnlocked(true)
      skipScheduleOnCloseRef.current = false
      setVaultExists(true)

      // Store raw key bytes in session storage (NOT the HKDF key which can't be exported)
      await chrome.storage.session.set({ masterKeyRaw: Array.from(rawBytes) })

      await exportAutofillData(newVault, key)
      
      await saveVault(newVault, key)
      await clearLockAlarm()
    } catch (err) {
      console.error(err)
      setError(`Failed to create vault: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsLoading(false)
    }
  }, [clearLockAlarm])

  const exportAutofillData = async (vaultData: Vault, masterKey: CryptoKey) => {
    try {
      const autofillKey = await deriveSubKey(masterKey, 'autofill-only', ['encrypt', 'decrypt'])
      const exportedAutofillKey = await crypto.subtle.exportKey('jwk', autofillKey)
      
      const autofillData = []
      for (const entry of vaultData.entries) {
        if (entry.type === 'login' && entry.login && entry.login.urls && entry.login.urls.length > 0) {
          const data = {
            urls: entry.login.urls,
            username: entry.login.username,
            password: entry.login.password || ''
          }
          const encoded = new TextEncoder().encode(JSON.stringify(data))
          const encrypted = await encrypt(autofillKey, encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer)
          const iv = encrypted.slice(0, 12)
          const ciphertext = encrypted.slice(12)
          autofillData.push({
            urls: entry.login.urls,
            iv: bufferToBase64(iv),
            ciphertext: bufferToBase64(ciphertext)
          })
        }
      }
      
      await chrome.storage.session.set({ 
        autofillKey: exportedAutofillKey,
        autofillData 
      })
    } catch (err) {
      console.error('Failed to export autofill data:', err)
    }
  }

  const unlockVault = useCallback(async (password: string): Promise<boolean> => {
    setIsLoading(true)
    setError(null)

    try {
      // Get stored vault data
      const result = await chrome.storage.local.get(['vault', 'salt', 'vaultAad', 'vaultSyncVersion'])
      if (!result.vault || !result.salt) {
        throw new Error('No vault found')
      }

      const salt = new Uint8Array(result.salt)
      const { key, rawBytes } = await deriveKeyFromPasswordWithRaw(password, salt)

      const vaultKey = await deriveSubKey(key, 'vault-main', ['encrypt', 'decrypt'])
      const encryptedVault = new Uint8Array(result.vault)
      const decryptedData = await decryptVaultPayload(
        vaultKey,
        encryptedVault,
        typeof result.vaultAad === 'string' ? result.vaultAad : undefined,
        typeof result.vaultSyncVersion === 'number' ? result.vaultSyncVersion : undefined
      )

      if (!decryptedData) {
        throw new Error('Unable to decrypt vault - password may be incorrect or vault is corrupted')
      }

      const vaultData = JSON.parse(new TextDecoder().decode(decryptedData))

      const isValid = await verifyVaultIntegrity(vaultData)
      if (!isValid) {
        throw new Error('Vault integrity check failed - possible tampering detected')
      }

      setVault(vaultData)
      setMasterKey(key)
      setIsUnlocked(true)
      skipScheduleOnCloseRef.current = false

      // Store raw key bytes in session storage for grace period restoration
      await chrome.storage.session.set({ masterKeyRaw: Array.from(rawBytes) })

      // Export autofill data for background script
      await exportAutofillData(vaultData, key)
      await clearLockAlarm()

      return true
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      console.error('Unlock error:', errorMsg)
      setError(`Failed to unlock: ${errorMsg}`)
      return false
    } finally {
           setIsLoading(false)
    }
  }, [clearLockAlarm])

  const unlockWithBiometric = useCallback(async (): Promise<boolean> => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await chrome.storage.local.get(['vault', 'vaultAad', 'vaultSyncVersion'])
      if (!result.vault) {
        throw new Error('No vault found')
      }

      const key = await authenticateWithBiometric()
      if (!key) {
        throw new Error('Biometric authentication failed')
      }

      const vaultKey = await deriveSubKey(key, 'vault-main', ['encrypt', 'decrypt'])
      const encryptedVault = new Uint8Array(result.vault)
      const decryptedData = await decryptVaultPayload(
        vaultKey,
        encryptedVault,
        typeof result.vaultAad === 'string' ? result.vaultAad : undefined,
        typeof result.vaultSyncVersion === 'number' ? result.vaultSyncVersion : undefined
      )

      if (!decryptedData) {
        throw new Error('Unable to decrypt vault with biometric')
      }

      const vaultData = JSON.parse(new TextDecoder().decode(decryptedData))

      const isValid = await verifyVaultIntegrity(vaultData)
      if (!isValid) {
        throw new Error('Vault integrity check failed')
      }

      setVault(vaultData)
      setMasterKey(key)
      setIsUnlocked(true)
      skipScheduleOnCloseRef.current = false

      // Note: For biometric auth, we cannot easily get the raw bytes
      // The biometric credential stores the encrypted raw bytes internally
      await exportAutofillData(vaultData, key)
      await clearLockAlarm()

      return true
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      console.error('Biometric unlock error:', errorMsg)
      setError(`Biometric unlock failed: ${errorMsg}`)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [clearLockAlarm])

  const unlockWithPin = useCallback(async (pin: string): Promise<boolean> => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await chrome.storage.local.get(['vault', 'vaultAad', 'vaultSyncVersion'])
      if (!result.vault) {
        throw new Error('No vault found')
      }

      const { decryptMasterKeyWithPin, getPinLockoutStatus, recordFailedPinAttempt, clearPinLockout } = await import('../../lib/pin')
      const lockout = await getPinLockoutStatus()
      if (lockout.isLocked) {
        throw new Error(`Too many PIN attempts. Try again in ${formatRemaining(lockout.remainingMs)}`)
      }

      const rawMasterKey = await decryptMasterKeyWithPin(pin)
      if (!rawMasterKey) {
        const attempt = await recordFailedPinAttempt()
        if (attempt.isLocked) {
          throw new Error(`Too many PIN attempts. Try again in ${formatRemaining(attempt.remainingMs)}`)
        }
        const remainingBeforeLock = Math.max(0, 5 - attempt.failedAttempts)
        if (remainingBeforeLock > 0) {
          throw new Error(`Invalid PIN. ${remainingBeforeLock} attempts remaining before temporary lock.`)
        }
        throw new Error('Invalid PIN')
      }

      const key = await crypto.subtle.importKey(
        'raw',
        rawMasterKey.buffer as ArrayBuffer,
        { name: 'HKDF' },
        false,
        ['deriveKey']
      )

      const vaultKey = await deriveSubKey(key, 'vault-main', ['encrypt', 'decrypt'])
      const encryptedVault = new Uint8Array(result.vault)
      const decryptedData = await decryptVaultPayload(
        vaultKey,
        encryptedVault,
        typeof result.vaultAad === 'string' ? result.vaultAad : undefined,
        typeof result.vaultSyncVersion === 'number' ? result.vaultSyncVersion : undefined
      )

      if (!decryptedData) {
        throw new Error('Unable to decrypt vault with PIN')
      }

      const vaultData = JSON.parse(new TextDecoder().decode(decryptedData))

      const isValid = await verifyVaultIntegrity(vaultData)
      if (!isValid) {
        throw new Error('Vault integrity check failed')
      }

      setVault(vaultData)
      setMasterKey(key)
      setIsUnlocked(true)
      skipScheduleOnCloseRef.current = false

      await clearPinLockout()
      await chrome.storage.session.set({ masterKeyRaw: Array.from(rawMasterKey) })
      await exportAutofillData(vaultData, key)
      await clearLockAlarm()

      return true
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      console.error('PIN unlock error:', errorMsg)
      setError(`PIN unlock failed: ${errorMsg}`)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [clearLockAlarm])

  const addEntry = useCallback(async (entry: VaultEntry) => {
    if (!vault || !masterKey) return

    const newVault = {
      ...vault,
      entries: [...vault.entries, entry],
      lastSync: Date.now(),
      syncVersion: vault.syncVersion + 1
    }

    setVault(newVault)
    await saveVault(newVault, masterKey)
    await exportAutofillData(newVault, masterKey)
  }, [vault, masterKey])

  const updateEntry = useCallback(async (entry: VaultEntry) => {
    if (!vault || !masterKey) return

    const newVault = {
      ...vault,
      entries: vault.entries.map(e => e.id === entry.id ? entry : e),
      lastSync: Date.now(),
      syncVersion: vault.syncVersion + 1
    }

    setVault(newVault)
    await saveVault(newVault, masterKey)
    await exportAutofillData(newVault, masterKey)
  }, [vault, masterKey])

  const deleteEntry = useCallback(async (entryId: string) => {
    if (!vault || !masterKey) return

    const newVault = {
      ...vault,
      entries: vault.entries.filter(e => e.id !== entryId),
      lastSync: Date.now(),
      syncVersion: vault.syncVersion + 1
    }

    setVault(newVault)
    await saveVault(newVault, masterKey)
    await exportAutofillData(newVault, masterKey)
  }, [vault, masterKey])

  const getEntry = useCallback((entryId: string): VaultEntry | null => {
    if (!vault) return null
    return vault.entries.find(e => e.id === entryId) || null
  }, [vault])

  const searchEntries = useCallback((query: string): VaultEntry[] => {
    if (!vault) return []
    if (!query) return vault.entries
    
    const lowerQuery = query.toLowerCase()
    return vault.entries.filter(entry => 
      entry.name.toLowerCase().includes(lowerQuery) ||
      entry.type.toLowerCase().includes(lowerQuery) ||
      entry.tags.some(tag => tag.toLowerCase().includes(lowerQuery)) ||
      (entry.login?.username.toLowerCase().includes(lowerQuery)) ||
      (entry.login?.urls.some(url => url.toLowerCase().includes(lowerQuery)))
    )
  }, [vault])

  const encryptValue = useCallback(async (value: string, entryId: string, modified?: number): Promise<string> => {
    if (!masterKey) throw new Error('Vault locked')
    const entryKey = await deriveSubKey(masterKey, `entry-${entryId}`, ['encrypt', 'decrypt'])
    const encoded = new TextEncoder().encode(value)
    // LOTUS-009: Use AAD (entry ID + timestamp) to bind ciphertext to context
    const aadData = `${entryId}:${modified || Date.now()}`
    const aad = new TextEncoder().encode(aadData).buffer as ArrayBuffer
    const encrypted = await encrypt(entryKey, encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer, aad)
    return bufferToBase64(encrypted)
  }, [masterKey])

  const decryptValue = useCallback(async (ciphertext: string, entryId: string, modified?: number): Promise<string> => {
    if (!masterKey) throw new Error('Vault locked')
    const entryKey = await deriveSubKey(masterKey, `entry-${entryId}`, ['encrypt', 'decrypt'])
    const buffer = base64ToBuffer(ciphertext)
    // LOTUS-009: Pass AAD for integrity verification
    let aad: ArrayBuffer | undefined
    if (modified) {
      const aadData = `${entryId}:${modified}`
      aad = new TextEncoder().encode(aadData).buffer as ArrayBuffer
    }
    const decrypted = await decrypt(entryKey, buffer, aad)
    return new TextDecoder().decode(decrypted)
  }, [masterKey])

  const importEntries = useCallback(async (entries: VaultEntry[]) => {
    if (!vault || !masterKey) return
    
    // Encrypt sensitive fields for all entries
    // Note: We use encryptValue which derives a key per entry
    const encryptedEntries = await Promise.all(entries.map(async (entry) => {
      const encryptedEntry = { ...entry }
      
      if (entry.login) {
        encryptedEntry.login = { ...entry.login }
        if (entry.login.password) {
          encryptedEntry.login.password = await encryptValue(entry.login.password, entry.id)
        }
        if (entry.login.totp?.secret) {
          encryptedEntry.login.totp = { ...entry.login.totp }
          encryptedEntry.login.totp.secret = await encryptValue(entry.login.totp.secret, entry.id)
        }
      }
      
      if (entry.note?.content) {
        encryptedEntry.note = { ...entry.note }
        encryptedEntry.note.content = await encryptValue(entry.note.content, entry.id)
      }
      
      return encryptedEntry
    }))

    const newVault = {
      ...vault,
      entries: [...vault.entries, ...encryptedEntries],
      lastSync: Date.now(),
      syncVersion: vault.syncVersion + 1
    }

    setVault(newVault)
    await saveVault(newVault, masterKey)
    await exportAutofillData(newVault, masterKey)
  }, [vault, masterKey, encryptValue])

  const clearPendingSave = useCallback(() => {
    setPendingSave(null)
    chrome.storage.session.remove('pendingSave')
  }, [])

  const encryptSettingsData = useCallback(async (settings: Record<string, string>): Promise<EncryptedSettings | null> => {
    if (!masterKey) return null
    return encryptSettings(masterKey, settings)
  }, [masterKey])

  const decryptSettingsData = useCallback(async (encrypted: EncryptedSettings): Promise<Record<string, string> | null> => {
    if (!masterKey) return null
    return decryptSettings(masterKey, encrypted)
  }, [masterKey])

  // Check for pending saves
  useEffect(() => {
    chrome.storage.session.get('pendingSave').then(res => {
      if (res.pendingSave) {
        setPendingSave(res.pendingSave)
        chrome.action.setBadgeText({ text: '' })
      }
    })
  }, [])

  // Grace period starts when popup closes (not when user unlocks).
  useEffect(() => {
    if (!isUnlocked) return

    const scheduleOnHide = () => {
      if (skipScheduleOnCloseRef.current) return
      if (document.visibilityState === 'hidden') {
        void scheduleLockAlarm()
      }
    }

    const scheduleOnClose = () => {
      if (skipScheduleOnCloseRef.current) return
      void scheduleLockAlarm()
    }

    void clearLockAlarm()
    document.addEventListener('visibilitychange', scheduleOnHide)
    window.addEventListener('pagehide', scheduleOnClose)
    window.addEventListener('beforeunload', scheduleOnClose)

    return () => {
      document.removeEventListener('visibilitychange', scheduleOnHide)
      window.removeEventListener('pagehide', scheduleOnClose)
      window.removeEventListener('beforeunload', scheduleOnClose)
      if (!skipScheduleOnCloseRef.current) {
        void scheduleLockAlarm()
      }
    }
  }, [isUnlocked, clearLockAlarm, scheduleLockAlarm])

  // Initialize vault on mount - check for existing session
  useEffect(() => {
    const init = async () => {
      const localResult = await chrome.storage.local.get(['vault'])
      const hasVault = !!localResult.vault
      setVaultExists(hasVault)
      
      const sessionResult = await chrome.storage.session.get(['masterKeyRaw'])
      if (sessionResult.masterKeyRaw && hasVault) {
        try {
          const rawBytes = new Uint8Array(sessionResult.masterKeyRaw)
          const key = await crypto.subtle.importKey(
            'raw',
            rawBytes,
            { name: 'HKDF' },
            false,
            ['deriveKey']
          )
          
          const vaultResult = await chrome.storage.local.get(['vault', 'vaultAad', 'vaultSyncVersion'])
          if (vaultResult.vault) {
            const encryptedVault = new Uint8Array(vaultResult.vault)
            const vaultKey = await deriveSubKey(key, 'vault-main', ['encrypt', 'decrypt'])
            const decryptedData = await decryptVaultPayload(
              vaultKey,
              encryptedVault,
              typeof vaultResult.vaultAad === 'string' ? vaultResult.vaultAad : undefined,
              typeof vaultResult.vaultSyncVersion === 'number' ? vaultResult.vaultSyncVersion : undefined
            )
            
            if (decryptedData) {
              const vaultData = JSON.parse(new TextDecoder().decode(decryptedData))
              if (await verifyVaultIntegrity(vaultData)) {
                setVault(vaultData)
                setMasterKey(key)
                setIsUnlocked(true)
                skipScheduleOnCloseRef.current = false
                await exportAutofillData(vaultData, key)
                await clearLockAlarm()
              }
            }
          }
        } catch (err) {
          console.error('Failed to restore session:', err)
        }
      }
      
      setIsLoading(false)
    }
    
    init()
  }, [clearLockAlarm])

  const value: VaultContextType = {
    vault,
    isUnlocked,
    masterKey,
    unlockVault,
    unlockWithBiometric,
    unlockWithPin,
    lockVault,
    createVault,
    addEntry,
    importEntries,
    updateEntry,
    deleteEntry,
    getEntry,
    searchEntries,
    encryptValue,
    decryptValue,
    isLoading,
    error,
    vaultExists,
    syncStatus,
    syncError,
    lastSyncTime,
    s3SyncStatus: s3Status,
    pendingSave,
    clearPendingSave,
    encryptSettingsData,
    decryptSettingsData
  }

  return (
    <VaultContext.Provider value={value}>
      {children}
    </VaultContext.Provider>
  )
}