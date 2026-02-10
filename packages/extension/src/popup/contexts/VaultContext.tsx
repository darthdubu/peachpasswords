import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { Vault, VaultEntry } from '@lotus/shared'
import { deriveKeyFromPassword, encrypt, decrypt, generateSalt, bufferToBase64, base64ToBuffer, deriveSubKey, encryptSettings, decryptSettings, EncryptedSettings, computeVaultHash, verifyVaultIntegrity } from '../../lib/crypto-utils'
import { VAULT_IDLE_TIMEOUT } from '../../lib/constants'
import { useSync } from '../hooks/useSync'
import { useS3Sync } from '../hooks/useS3Sync'

interface VaultContextType {
  vault: Vault | null
  isUnlocked: boolean
  masterKey: CryptoKey | null
  unlockVault: (password: string) => Promise<boolean>
  lockVault: () => void
  createVault: (password: string) => Promise<void>
  addEntry: (entry: VaultEntry) => Promise<void>
  importEntries: (entries: VaultEntry[]) => Promise<void>
  updateEntry: (entry: VaultEntry) => Promise<void>
  deleteEntry: (entryId: string) => Promise<void>
  getEntry: (entryId: string) => VaultEntry | null
  searchEntries: (query: string) => VaultEntry[]
  encryptValue: (value: string, entryId: string) => Promise<string>
  decryptValue: (ciphertext: string, entryId: string) => Promise<string>
  isLoading: boolean
  error: string | null
  vaultExists: boolean
  syncStatus: 'disconnected' | 'connecting' | 'connected' | 'error'
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

export const VaultProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [vault, setVault] = useState<Vault | null>(null)
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [idleTimer, setIdleTimer] = useState<NodeJS.Timeout | null>(null)
  const [vaultExists, setVaultExists] = useState(false)
  const [pendingSave, setPendingSave] = useState<{ url: string, username: string, password: string } | null>(null)
  
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

    const encryptedVault = await encrypt(vaultKey, dataBuffer)

    await chrome.storage.local.set({
      vault: Array.from(new Uint8Array(encryptedVault)),
      lastSync: vaultData.lastSync
    })
  }

  const handlePull = useCallback(async (newVault: Vault) => {
    if (!masterKey) return
    setVault(newVault)
    await saveVault(newVault, masterKey)
  }, [masterKey])

  const { syncStatus } = useSync(vault, masterKey, handlePull)
  const { s3Status } = useS3Sync(vault, masterKey, handlePull)

  const lockVault = useCallback(async () => {
    setVault(null)
    setIsUnlocked(false)
    setMasterKey(null)
    if (idleTimer) clearTimeout(idleTimer)
    setIdleTimer(null)
    // Clear sensitive data from memory
    // SECURITY FIX (LOTUS-001): Do NOT remove 'vault' - encrypted vault should persist
    // Only remove the masterKey from session storage
    chrome.storage.session.remove(['masterKey'])
    // LOTUS-014: Notify background to clear alarm
    await chrome.runtime.sendMessage({ type: 'LOCK_NOW' }).catch(() => {})
  }, [idleTimer])

  // Auto-lock functionality using chrome.alarms (LOTUS-014)
  const resetIdleTimer = useCallback(() => {
    // Clear any existing local timer
    if (idleTimer) clearTimeout(idleTimer)

    // Schedule background alarm
    chrome.runtime.sendMessage({ type: 'SCHEDULE_LOCK' }).catch(() => {})

    // Also set a local timer as fallback for when popup is open
    const timer = setTimeout(() => {
      lockVault()
    }, VAULT_IDLE_TIMEOUT)
    setIdleTimer(timer)
  }, [idleTimer, lockVault])



  const createVault = useCallback(async (password: string) => {
    setIsLoading(true)
    try {
      const salt = await generateSalt()
      const key = await deriveKeyFromPassword(password, salt)
      
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
      setVaultExists(true)
      
      // Store key in session for background script (autofill)
      const exportedKey = await crypto.subtle.exportKey('jwk', key)
      await chrome.storage.session.set({ masterKey: exportedKey })
      
      await saveVault(newVault, key)
      resetIdleTimer()
    } catch (err) {
      console.error(err)
      setError(`Failed to create vault: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsLoading(false)
    }
  }, [resetIdleTimer])

  const unlockVault = useCallback(async (password: string): Promise<boolean> => {
    setIsLoading(true)
    setError(null)
    
    try {
      // Get stored vault data
      const result = await chrome.storage.local.get(['vault', 'salt'])
      if (!result.vault || !result.salt) {
        throw new Error('No vault found')
      }

      const salt = new Uint8Array(result.salt)
      const key = await deriveKeyFromPassword(password, salt)
      
      // Derive vault encryption key
      const vaultKey = await deriveSubKey(key, 'vault-main', ['encrypt', 'decrypt'])
      
      // Decrypt vault
      const encryptedVault = new Uint8Array(result.vault)
      const decryptedData = await decrypt(vaultKey, encryptedVault.buffer)
      const vaultData = JSON.parse(new TextDecoder().decode(decryptedData))

      // LOTUS-005: Verify vault integrity
      const isValid = await verifyVaultIntegrity(vaultData)
      if (!isValid) {
        throw new Error('Vault integrity check failed - possible tampering detected')
      }

      setVault(vaultData)
      setMasterKey(key)
      setIsUnlocked(true)
      
      // Store key in session for background script (autofill)
      const exportedKey = await crypto.subtle.exportKey('jwk', key)
      await chrome.storage.session.set({ masterKey: exportedKey })

      resetIdleTimer()
      
      return true
    } catch (err) {
      setError('Invalid password')
      return false
    } finally {
           setIsLoading(false)
    }
  }, [resetIdleTimer])

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

  const encryptValue = useCallback(async (value: string, entryId: string): Promise<string> => {
    if (!masterKey) throw new Error('Vault locked')
    const entryKey = await deriveSubKey(masterKey, `entry-${entryId}`, ['encrypt', 'decrypt'])
    const encoded = new TextEncoder().encode(value)
    const encrypted = await encrypt(entryKey, encoded.buffer)
    return bufferToBase64(encrypted)
  }, [masterKey])

  const decryptValue = useCallback(async (ciphertext: string, entryId: string): Promise<string> => {
    if (!masterKey) throw new Error('Vault locked')
    const entryKey = await deriveSubKey(masterKey, `entry-${entryId}`, ['encrypt', 'decrypt'])
    const buffer = base64ToBuffer(ciphertext)
    const decrypted = await decrypt(entryKey, buffer)
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

  // Initialize vault on mount
  useEffect(() => {
    // Check if vault exists
    chrome.storage.local.get(['vault']).then(result => {
      setVaultExists(!!result.vault)
      setIsLoading(false)
    })
  }, [])

  const value: VaultContextType = {
    vault,
    isUnlocked,
    masterKey,
    unlockVault,
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