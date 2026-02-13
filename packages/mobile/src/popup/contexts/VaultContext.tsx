import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { Vault, VaultEntry } from '@lotus/shared'
import { storage } from '../../lib/storage'
import { STORAGE_KEYS } from '../../lib/constants'
import type { EncryptedSettings } from '../../lib/crypto-utils'

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
  updateEntry: (entry: VaultEntry) => Promise<void>
  deleteEntry: (entryId: string) => Promise<void>
  restoreEntry: (entryId: string) => Promise<void>
  permanentlyDeleteEntry: (entryId: string) => Promise<void>
  getEntry: (entryId: string) => VaultEntry | null
  getTrashedEntries: () => VaultEntry[]
  searchEntries: (query: string) => VaultEntry[]
  isLoading: boolean
  error: string | null
  vaultExists: boolean
  hasBiometric: () => Promise<boolean>
  hasPin: () => Promise<boolean>
}

const VaultContext = createContext<VaultContextType | undefined>(undefined)

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const [vault, setVault] = useState<Vault | null>(null)
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [vaultExists, setVaultExists] = useState(false)
  const vaultRef = useRef<Vault | null>(null)
  const masterKeyRef = useRef<CryptoKey | null>(null)

  useEffect(() => {
    vaultRef.current = vault
  }, [vault])

  useEffect(() => {
    masterKeyRef.current = masterKey
  }, [masterKey])

  useEffect(() => {
    checkVaultExists()
  }, [])

  const checkVaultExists = async () => {
    try {
      const result = await storage.local.get(['vault', 'salt'])
      setVaultExists(!!result.vault && !!result.salt)
    } catch (err) {
      console.error('Error checking vault:', err)
      setVaultExists(false)
    } finally {
      setIsLoading(false)
    }
  }

  const unlockVault = useCallback(async (password: string): Promise<boolean> => {
    setIsLoading(true)
    setError(null)
    try {
      // TODO: Implement crypto unlock
      // For now, simulate success
      setIsUnlocked(true)
      setVault({
        version: 2,
        entries: [],
        folders: [],
        lastSync: Date.now(),
        syncVersion: 0
      })
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unlock failed')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [])

  const unlockWithBiometric = useCallback(async (): Promise<boolean> => {
    setIsLoading(true)
    try {
      // TODO: Implement biometric unlock via Capacitor plugin
      return false
    } catch (err) {
      return false
    } finally {
      setIsLoading(false)
    }
  }, [])

  const unlockWithPin = useCallback(async (pin: string): Promise<boolean> => {
    setIsLoading(true)
    try {
      // TODO: Implement PIN unlock
      return false
    } catch (err) {
      return false
    } finally {
      setIsLoading(false)
    }
  }, [])

  const lockVault = useCallback(() => {
    setVault(null)
    setIsUnlocked(false)
    setMasterKey(null)
    storage.session.clear()
  }, [])

  const createVault = useCallback(async (password: string) => {
    setIsLoading(true)
    try {
      const newVault: Vault = {
        version: 2,
        entries: [],
        folders: [],
        lastSync: Date.now(),
        syncVersion: 0
      }
      
      // TODO: Implement crypto creation
      
      await storage.local.set({
        salt: Array.from(new Uint8Array(32)),
        [STORAGE_KEYS.SYNC_BASE]: newVault
      })
      
      setVault(newVault)
      setIsUnlocked(true)
      setVaultExists(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create vault')
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [])

  const addEntry = useCallback(async (entry: VaultEntry) => {
    const currentVault = vaultRef.current
    if (!currentVault) return

    const newVault = {
      ...currentVault,
      entries: [...currentVault.entries, entry],
      lastSync: Date.now(),
      syncVersion: currentVault.syncVersion + 1
    }

    setVault(newVault)
    await storage.local.set({ [STORAGE_KEYS.SYNC_BASE]: newVault })
  }, [])

  const updateEntry = useCallback(async (entry: VaultEntry) => {
    const currentVault = vaultRef.current
    if (!currentVault) return

    const newVault = {
      ...currentVault,
      entries: currentVault.entries.map(e => e.id === entry.id ? entry : e),
      lastSync: Date.now(),
      syncVersion: currentVault.syncVersion + 1
    }

    setVault(newVault)
    await storage.local.set({ [STORAGE_KEYS.SYNC_BASE]: newVault })
  }, [])

  const deleteEntry = useCallback(async (entryId: string) => {
    const currentVault = vaultRef.current
    if (!currentVault) return

    const now = Date.now()
    const newVault = {
      ...currentVault,
      entries: currentVault.entries.map(e =>
        e.id === entryId ? { ...e, trashedAt: now, trashExpiresAt: now + 30 * 24 * 60 * 60 * 1000 } : e
      ),
      lastSync: now,
      syncVersion: currentVault.syncVersion + 1
    }

    setVault(newVault)
    await storage.local.set({ [STORAGE_KEYS.SYNC_BASE]: newVault })
  }, [])

  const restoreEntry = useCallback(async (entryId: string) => {
    const currentVault = vaultRef.current
    if (!currentVault) return

    const now = Date.now()
    const newVault = {
      ...currentVault,
      entries: currentVault.entries.map(e =>
        e.id === entryId ? { ...e, trashedAt: undefined, trashExpiresAt: undefined } : e
      ),
      lastSync: now,
      syncVersion: currentVault.syncVersion + 1
    }

    setVault(newVault)
    await storage.local.set({ [STORAGE_KEYS.SYNC_BASE]: newVault })
  }, [])

  const permanentlyDeleteEntry = useCallback(async (entryId: string) => {
    const currentVault = vaultRef.current
    if (!currentVault) return

    const newVault = {
      ...currentVault,
      entries: currentVault.entries.filter(e => e.id !== entryId),
      lastSync: Date.now(),
      syncVersion: currentVault.syncVersion + 1
    }

    setVault(newVault)
    await storage.local.set({ [STORAGE_KEYS.SYNC_BASE]: newVault })
  }, [])

  const getEntry = useCallback((entryId: string): VaultEntry | null => {
    return vaultRef.current?.entries.find(e => e.id === entryId) || null
  }, [])

  const getTrashedEntries = useCallback((): VaultEntry[] => {
    return vaultRef.current?.entries.filter(e => (e as VaultEntry & { trashedAt?: number }).trashedAt) || []
  }, [])

  const searchEntries = useCallback((query: string): VaultEntry[] => {
    const entries = vaultRef.current?.entries.filter(e => !(e as VaultEntry & { trashedAt?: number }).trashedAt) || []
    if (!query) return entries
    
    const lowerQuery = query.toLowerCase()
    return entries.filter(e => 
      e.name?.toLowerCase().includes(lowerQuery) ||
      e.login?.username?.toLowerCase().includes(lowerQuery)
    )
  }, [])

  const hasBiometric = useCallback(async (): Promise<boolean> => {
    // TODO: Check biometric availability
    return false
  }, [])

  const hasPin = useCallback(async (): Promise<boolean> => {
    const result = await storage.local.get(['pinEnabled'])
    return !!result.pinEnabled
  }, [])

  return (
    <VaultContext.Provider value={{
      vault,
      isUnlocked,
      masterKey,
      unlockVault,
      unlockWithBiometric,
      unlockWithPin,
      lockVault,
      createVault,
      addEntry,
      updateEntry,
      deleteEntry,
      restoreEntry,
      permanentlyDeleteEntry,
      getEntry,
      getTrashedEntries,
      searchEntries,
      isLoading,
      error,
      vaultExists,
      hasBiometric,
      hasPin
    }}>
      {children}
    </VaultContext.Provider>
  )
}

export function useVault() {
  const context = useContext(VaultContext)
  if (!context) {
    throw new Error('useVault must be used within a VaultProvider')
  }
  return context
}
