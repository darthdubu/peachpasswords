import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Vault, VaultEntry, EncryptedEntryMetadata } from '@lotus/shared'
import { deriveKeyFromPasswordWithRaw, encrypt, decrypt, generateSalt, bufferToBase64, base64ToBuffer, deriveSubKey, encryptSettings, decryptSettings, EncryptedSettings, computeVaultHash, verifyVaultIntegrity, buildVaultAad, deriveVaultAadFromVault, secureWipe, loadVaultHeader, saveVaultHeader, attemptVaultUnlockWithMigration, migrateKdf, needsKdfMigration, createVaultHeader, parseVaultHeader, CURRENT_KDF_VERSION, padVaultPlaintext, unpadVaultPlaintext, encryptS3Config, type S3SessionConfig, decryptEntryMetadata, hasEncryptedMetadata, prepareEntryForStorage } from '../../lib/crypto-utils'
import { authenticateWithBiometric, getLastBiometricError, hasBiometricCredential, registerBiometric } from '../../lib/biometric'
import { STORAGE_KEYS } from '../../lib/constants'
import { getEntryNameMatchScore, getUrlMatchScore, normalizeStoredUrl } from '../../lib/url-match'
import { useSync } from '../hooks/useSync'
import { useS3Sync } from '../hooks/useS3Sync'
import { CURRENT_VAULT_SCHEMA_VERSION, migrateVaultWithRecovery, recoverIncompleteMigration, encryptMetadataForAllEntries, hasEntriesNeedingMetadataMigration, hydrateEntriesWithMetadata } from '../../lib/migration'
import { enqueueSyncOperation } from '../../lib/sync-ops'
import { VAULT_HEADER_KEY } from '../../lib/vault-version'
import { appendSyncEvent, readSyncTimeline } from '../../lib/sync-observability'
import type { SyncEvent } from '../../lib/sync-types'
import { readUnresolvedConflicts } from '../../lib/sync-conflicts'
import type { SyncConflictRecord } from '../../lib/sync-conflicts'
import { logSecurityEvent } from '../../lib/security-events'

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
  importEntries: (entries: VaultEntry[], options?: { mode?: 'append' | 'merge' }) => Promise<{ created: number; merged: number; skipped: number }>
  updateEntry: (entry: VaultEntry) => Promise<void>
  deleteEntry: (entryId: string) => Promise<void>
  restoreEntry: (entryId: string) => Promise<void>
  permanentlyDeleteEntry: (entryId: string) => Promise<void>
  getEntry: (entryId: string) => VaultEntry | null
  getTrashedEntries: () => VaultEntry[]
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
  s3LastSyncTime: number | null
  s3IsSyncing: boolean
  pendingSave: { url: string, username: string, password: string } | null
  clearPendingSave: () => void
  encryptSettingsData: (settings: Record<string, string>) => Promise<EncryptedSettings | null>
  decryptSettingsData: (encrypted: EncryptedSettings) => Promise<Record<string, string> | null>
  syncTimeline: SyncEvent[]
  refreshSyncTimeline: () => Promise<void>
  unresolvedConflicts: SyncConflictRecord[]
  unresolvedConflictCount: number
  refreshUnresolvedConflicts: () => Promise<void>
}

type VaultStateContextType = Pick<
  VaultContextType,
  | 'vault'
  | 'isUnlocked'
  | 'masterKey'
  | 'isLoading'
  | 'error'
  | 'vaultExists'
  | 'syncStatus'
  | 'syncError'
  | 'lastSyncTime'
  | 's3SyncStatus'
  | 's3LastSyncTime'
  | 's3IsSyncing'
  | 'pendingSave'
  | 'syncTimeline'
  | 'unresolvedConflicts'
  | 'unresolvedConflictCount'
>

type VaultActionsContextType = Pick<
  VaultContextType,
  | 'unlockVault'
  | 'unlockWithBiometric'
  | 'unlockWithPin'
  | 'lockVault'
  | 'createVault'
  | 'addEntry'
  | 'importEntries'
  | 'updateEntry'
  | 'deleteEntry'
  | 'restoreEntry'
  | 'permanentlyDeleteEntry'
  | 'getEntry'
  | 'getTrashedEntries'
  | 'searchEntries'
  | 'encryptValue'
  | 'decryptValue'
  | 'clearPendingSave'
  | 'encryptSettingsData'
  | 'decryptSettingsData'
  | 'refreshSyncTimeline'
  | 'refreshUnresolvedConflicts'
>

// S3SessionConfig is now imported from crypto-utils.ts

let refreshBadgesTimer: number | null = null

async function notifyActiveTabAutofillRefresh() {
  if (refreshBadgesTimer !== null) {
    window.clearTimeout(refreshBadgesTimer)
  }
  refreshBadgesTimer = window.setTimeout(async () => {
    refreshBadgesTimer = null
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      const activeTabId = tabs[0]?.id
      if (typeof activeTabId === 'number') {
        await chrome.tabs.sendMessage(activeTabId, { type: 'PEACH_REFRESH_FORM_BADGES' }).catch(() => undefined)
      }
    } catch {
      // Ignore if tabs API isn't available in this context.
    }
  }, 140)
}

const VaultContext = createContext<VaultContextType | undefined>(undefined)
const VaultStateContext = createContext<VaultStateContextType | undefined>(undefined)
const VaultActionsContext = createContext<VaultActionsContextType | undefined>(undefined)

export const useVault = () => {
  const context = useContext(VaultContext)
  if (!context) {
    throw new Error('useVault must be used within a VaultProvider')
  }
  return context
}

export const useVaultState = () => {
  const context = useContext(VaultStateContext)
  if (!context) {
    throw new Error('useVaultState must be used within a VaultProvider')
  }
  return context
}

export const useVaultActions = () => {
  const context = useContext(VaultActionsContext)
  if (!context) {
    throw new Error('useVaultActions must be used within a VaultProvider')
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

function isEntryTrashed(entry: VaultEntry): boolean {
  const trashedAt = (entry as VaultEntry & { trashedAt?: number }).trashedAt
  return typeof trashedAt === 'number' && trashedAt > 0
}

function getEntryTrashExpiresAt(entry: VaultEntry): number | undefined {
  return (entry as VaultEntry & { trashExpiresAt?: number }).trashExpiresAt
}

function normalizeEntryUrls(urls: string[] | undefined): string[] {
  if (!Array.isArray(urls)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of urls) {
    const normalized = normalizeStoredUrl(raw)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function urlSetsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const bSet = new Set(b)
  return a.every((value) => bSet.has(value))
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
    const hintedAad = buildVaultAad({ schemaVersion: CURRENT_VAULT_SCHEMA_VERSION, syncVersion: Math.floor(syncVersionHint) })
    const decryptedWithSyncHint = await tryWithAad(hintedAad)
    if (decryptedWithSyncHint) return decryptedWithSyncHint
  }

  for (let syncVersion = 0; syncVersion <= 10; syncVersion += 1) {
    const decrypted =
      (await tryWithAad(buildVaultAad({ schemaVersion: CURRENT_VAULT_SCHEMA_VERSION, syncVersion }))) ||
      (await tryWithAad(`vault:1:${syncVersion}`))
    if (decrypted) return decrypted
  }

  // Migration recovery path for old installs that lack stored AAD hints.
  // Limited to 100 iterations to prevent excessive unlock latency.
  // Most users will have syncVersion < 50, so 100 covers edge cases.
  for (let syncVersion = 11; syncVersion <= 100; syncVersion += 1) {
    const decrypted =
      (await tryWithAad(buildVaultAad({ schemaVersion: CURRENT_VAULT_SCHEMA_VERSION, syncVersion }))) ||
      (await tryWithAad(`vault:1:${syncVersion}`))
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
  const [syncTimeline, setSyncTimeline] = useState<SyncEvent[]>([])
  const [unresolvedConflicts, setUnresolvedConflicts] = useState<SyncConflictRecord[]>([])
  const skipScheduleOnCloseRef = useRef(false)
  const vaultRef = useRef<Vault | null>(null)
  const masterKeyRef = useRef<CryptoKey | null>(null)
  const searchIndexRef = useRef<Map<string, string>>(new Map())
  const decryptCacheRef = useRef<Map<string, string>>(new Map())
  const DECRYPT_CACHE_MAX_ENTRIES = 400
  
  // LOTUS-017: Metadata cache for decrypted entry metadata
  const metadataCacheRef = useRef<Map<string, EncryptedEntryMetadata>>(new Map())
  const METADATA_CACHE_MAX_ENTRIES = 500

  const getMetadataCacheKey = useCallback((entryId: string) => {
    return entryId
  }, [])

  const setMetadataCacheValue = useCallback((key: string, value: EncryptedEntryMetadata) => {
    const cache = metadataCacheRef.current
    if (cache.has(key)) {
      cache.set(key, value)
      return
    }
    if (cache.size >= METADATA_CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value
      if (oldest) cache.delete(oldest)
    }
    cache.set(key, value)
  }, [])

  const clearMetadataCache = useCallback(() => {
    metadataCacheRef.current.clear()
  }, [])

  const getDecryptCacheKey = useCallback((ciphertext: string, entryId: string, modified?: number) => {
    return `${entryId}:${modified ?? 'na'}:${ciphertext}`
  }, [])

  const setDecryptCacheValue = useCallback((key: string, value: string) => {
    const cache = decryptCacheRef.current
    if (cache.has(key)) {
      cache.set(key, value)
      return
    }
    if (cache.size >= DECRYPT_CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value
      if (oldest) cache.delete(oldest)
    }
    cache.set(key, value)
  }, [])

  const clearDecryptCache = useCallback(() => {
    decryptCacheRef.current.clear()
  }, [])

  // LOTUS-017: Decrypt metadata for search indexing
  useEffect(() => {
    vaultRef.current = vault
    
    const buildSearchIndex = async () => {
      const nextIndex = new Map<string, string>()
      const entries = Array.isArray(vault?.entries) ? vault.entries : []
      const key = masterKeyRef.current
      
      for (const entry of entries) {
        const tokens: string[] = []
        
        // Try to get decrypted metadata
        let metadata: EncryptedEntryMetadata | null = null
        if (key && hasEncryptedMetadata(entry)) {
          const cacheKey = getMetadataCacheKey(entry.id)
          const cached = metadataCacheRef.current.get(cacheKey)
          if (cached) {
            metadata = cached
          } else {
            metadata = await decryptEntryMetadata(key, entry.id, entry.encryptedMetadata)
            if (metadata) {
              setMetadataCacheValue(cacheKey, metadata)
            }
          }
        }
        
        // Use decrypted metadata or fall back to legacy fields
        const name = metadata?.name ?? entry.name ?? ''
        const tags = metadata?.tags ?? entry.tags ?? []
        const username = metadata?.username ?? entry.login?.username ?? ''
        const urls = metadata?.urls ?? entry.login?.urls ?? []
        
        if (typeof name === 'string') tokens.push(name)
        if (typeof entry.type === 'string') tokens.push(entry.type)
        if (Array.isArray(tags)) tokens.push(...tags.filter((tag): tag is string => typeof tag === 'string'))
        if (typeof username === 'string') tokens.push(username)
        if (Array.isArray(urls)) tokens.push(...urls.filter((url): url is string => typeof url === 'string'))
        nextIndex.set(entry.id, tokens.join(' ').toLowerCase())
      }
      searchIndexRef.current = nextIndex
    }
    
    void buildSearchIndex()
  }, [vault, getMetadataCacheKey, setMetadataCacheValue])

  useEffect(() => {
    masterKeyRef.current = masterKey
  }, [masterKey])

  const refreshSyncTimeline = useCallback(async () => {
    setSyncTimeline(await readSyncTimeline())
  }, [])

  const refreshUnresolvedConflicts = useCallback(async () => {
    setUnresolvedConflicts(await readUnresolvedConflicts())
  }, [])

  const saveVault = useCallback(async (
    vaultData: Vault,
    key: CryptoKey,
    options?: { triggerS3Sync?: boolean; skipMetadataMigration?: boolean }
  ) => {
    let vaultToSave = vaultData
    
    // LOTUS-017: Encrypt metadata for any entries that still need it
    if (!options?.skipMetadataMigration && hasEntriesNeedingMetadataMigration(vaultData)) {
      try {
        vaultToSave = await encryptMetadataForAllEntries(vaultData, key)
        await appendSyncEvent('migration', 'Encrypted metadata for legacy entries')
      } catch (migrationError) {
        console.error('Metadata encryption migration failed:', migrationError)
        // Continue with original vault if migration fails
      }
    }
    
    const currentStored = await chrome.storage.local.get(['vault', 'vaultAad', 'vaultSyncVersion'])
    const migratedVault = await migrateVaultWithRecovery(vaultToSave, {
      vault: currentStored.vault as number[] | undefined,
      aad: currentStored.vaultAad as string | undefined,
      syncVersion: currentStored.vaultSyncVersion as number | undefined
    })
    const contentHash = await computeVaultHash(migratedVault)
    const vaultWithHash = { ...migratedVault, contentHash }

    // Derive vault encryption key from master key
    const vaultKey = await deriveSubKey(key, 'vault-main', ['encrypt', 'decrypt'])

    const vaultBytes = new TextEncoder().encode(JSON.stringify(vaultWithHash))
    
    // Pad plaintext to 4KB boundary for size privacy (LOTUS-011)
    const paddedBytes = padVaultPlaintext(vaultBytes)
    
    const dataBuffer = paddedBytes.byteLength === paddedBytes.buffer.byteLength
      ? paddedBytes.buffer
      : paddedBytes.buffer.slice(paddedBytes.byteOffset, paddedBytes.byteOffset + paddedBytes.byteLength)

    const vaultAad = deriveVaultAadFromVault(vaultWithHash)
    const aad = new TextEncoder().encode(vaultAad).buffer as ArrayBuffer
    const encryptedVault = await encrypt(vaultKey, dataBuffer as ArrayBuffer, aad)

    await chrome.storage.local.set({
      vault: Array.from(new Uint8Array(encryptedVault)),
      lastSync: vaultWithHash.lastSync,
      vaultAad,
      vaultSyncVersion: vaultWithHash.syncVersion,
      [STORAGE_KEYS.SYNC_BASE]: vaultWithHash
    })
    if (options?.triggerS3Sync !== false) {
      await chrome.runtime.sendMessage({ type: 'S3_SYNC_NOW' }).catch(() => {})
    }
    await appendSyncEvent('sync-success', `Saved vault v${vaultWithHash.syncVersion}`)
    await refreshSyncTimeline()
  }, [refreshSyncTimeline])

  const handlePull = useCallback(async (newVault: Vault) => {
    if (!masterKey) return
    clearDecryptCache()
    setVault(newVault)
    await saveVault(newVault, masterKey, { triggerS3Sync: false })
    await appendSyncEvent('sync-pull', `Pulled remote vault v${newVault.syncVersion}`)
    await refreshSyncTimeline()
  }, [masterKey, refreshSyncTimeline, saveVault, clearDecryptCache])

  const { syncStatus, syncError, lastSyncTime } = useSync(vault, masterKey, handlePull)
  const { s3Status, s3LastSyncTime, s3IsSyncing } = useS3Sync(vault, masterKey, handlePull)

  const lockVault = useCallback(async () => {
    skipScheduleOnCloseRef.current = true
    clearDecryptCache()
    setVault(null)
    setIsUnlocked(false)
    setMasterKey(null)
    s3ConfigRef.current = null
    // Clear sensitive data from memory
    // SECURITY FIX (LOTUS-001): Do NOT remove 'vault' - encrypted vault should persist
    // SECURITY FIX (LOTUS-004): Remove encrypted S3 config from session storage
    chrome.storage.session.remove(['masterKey', 'masterKeyRaw', 'autofillKey', 'autofillData', 's3SyncConfig', 's3SyncConfigEncrypted'])
    // LOTUS-014: Notify background to clear alarm
    await chrome.runtime.sendMessage({ type: 'LOCK_NOW' }).catch(() => {})
    await logSecurityEvent('vault-locked', 'info')
  }, [clearDecryptCache])

  // LOTUS-004: Handle requests for S3 credentials from background script
  useEffect(() => {
    const listener = (message: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => {
      if (typeof message === 'object' && message !== null && (message as { type: string }).type === 'REQUEST_S3_CREDENTIALS') {
        // Only provide credentials if vault is unlocked
        if (!isUnlocked || !masterKeyRef.current || !s3ConfigRef.current) {
          sendResponse({ success: false, error: 'Vault locked or no S3 config' })
          return true
        }
        // Return the in-memory S3 config
        sendResponse({ success: true, config: s3ConfigRef.current })
        return true
      }
      return false
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [isUnlocked])

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

  const getTrashRetentionDays = useCallback(async (key: CryptoKey | null): Promise<number> => {
    const result = await chrome.storage.local.get([STORAGE_KEYS.SETTINGS])
    const settings = result[STORAGE_KEYS.SETTINGS]

    let configuredValue: number | null = null
    if (settings?.encrypted && key) {
      const decrypted = await decryptSettings(key, settings.encrypted as EncryptedSettings)
      const encryptedDays = Number(decrypted?.trashRetentionDays)
      if (Number.isFinite(encryptedDays)) {
        configuredValue = encryptedDays
      }
    } else {
      const plainDays = Number(settings?.trashRetentionDays)
      if (Number.isFinite(plainDays)) {
        configuredValue = plainDays
      }
    }

    const normalized = Math.floor(configuredValue ?? 30)
    if (normalized < 1) return 1
    if (normalized > 365) return 365
    return normalized
  }, [])

  // LOTUS-004: Store encrypted S3 config in memory only (not in session storage)
  // This prevents plaintext credential exposure in session storage
  const s3ConfigRef = useRef<S3SessionConfig | null>(null)

  const hydrateS3SyncSession = useCallback(async (key: CryptoKey | null) => {
    const result = await chrome.storage.local.get([STORAGE_KEYS.SETTINGS])
    const settings = result[STORAGE_KEYS.SETTINGS]
    if (!settings) {
      s3ConfigRef.current = null
      await chrome.storage.session.remove('s3SyncConfig')
      await chrome.runtime.sendMessage({ type: 'S3_SYNC_STOP' }).catch(() => {})
      return
    }

    let source: Record<string, string> | null = null
    if (settings.encrypted && key) {
      source = await decryptSettings(key, settings.encrypted as EncryptedSettings)
    } else if (!settings.encrypted) {
      source = settings
    }

    const cfg: S3SessionConfig = {
      s3Endpoint: source?.s3Endpoint,
      s3Region: source?.s3Region,
      s3AccessKey: source?.s3AccessKey,
      s3SecretKey: source?.s3SecretKey,
      s3Bucket: source?.s3Bucket
    }

    if (cfg.s3Endpoint && cfg.s3AccessKey && cfg.s3SecretKey && cfg.s3Bucket) {
      // Store in memory only (ref) - not in session storage for security
      s3ConfigRef.current = cfg
      // Also store encrypted version in session storage for background sync
      if (key) {
        const encrypted = await encryptS3Config(key, cfg)
        await chrome.storage.session.set({ s3SyncConfigEncrypted: encrypted })
      }
      await chrome.runtime.sendMessage({ type: 'S3_SYNC_START' }).catch(() => {})
      await chrome.runtime.sendMessage({ type: 'S3_SYNC_NOW' }).catch(() => {})
    } else {
      s3ConfigRef.current = null
      await chrome.storage.session.remove('s3SyncConfig')
      await chrome.storage.session.remove('s3SyncConfigEncrypted')
      await chrome.runtime.sendMessage({ type: 'S3_SYNC_STOP' }).catch(() => {})
    }
  }, [])

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
      const { key, rawBytes } = await deriveKeyFromPasswordWithRaw(password, salt, CURRENT_KDF_VERSION)
      
      const newVault: Vault = {
        version: CURRENT_VAULT_SCHEMA_VERSION,
        entries: [],
        folders: [],
        lastSync: Date.now(),
        syncVersion: 0
      }
      
      // Save salt separately and create vault header with current KDF
      const vaultHeader = createVaultHeader()
      await chrome.storage.local.set({ salt: Array.from(salt) })
      await saveVaultHeader(vaultHeader)
      
      setVault(newVault)
      clearDecryptCache()
      setMasterKey(key)
      setIsUnlocked(true)
      skipScheduleOnCloseRef.current = false
      setVaultExists(true)

      // LOTUS-007: Do NOT store masterKeyRaw in session storage
      // Session is lost when popup closes, user must unlock again

      await exportAutofillData(newVault, key)
      
      await saveVault(newVault, key)
      await hydrateS3SyncSession(key)
      await clearLockAlarm()
      await appendSyncEvent('migration', 'Initialized vault schema v2')
      await logSecurityEvent('vault-created', 'info')
      secureWipe(rawBytes)
      secureWipe(salt)
    } catch (err) {
      console.error(err)
      setError(`Failed to create vault: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsLoading(false)
    }
  }, [clearDecryptCache, clearLockAlarm, hydrateS3SyncSession, refreshSyncTimeline])

  const exportAutofillData = useCallback(async (vaultData: Vault, masterKey: CryptoKey) => {
    try {
      const autofillKey = await deriveSubKey(masterKey, 'autofill-only', ['encrypt', 'decrypt'], true)
      const exportedAutofillKey = await crypto.subtle.exportKey('jwk', autofillKey)
      
      const autofillData = []
      for (const entry of vaultData.entries) {
        if (isEntryTrashed(entry)) continue
        if (entry.type !== 'login' || !entry.login) continue
        
        // LOTUS-017: Get metadata for autofill
        let metadata: EncryptedEntryMetadata | null = null
        if (hasEncryptedMetadata(entry)) {
          metadata = await decryptEntryMetadata(masterKey, entry.id, entry.encryptedMetadata)
        }
        
        const urls = metadata?.urls ?? entry.login.urls ?? []
        if (urls.length === 0) continue
        
        let decryptedPassword = entry.login.password || ''
        let decryptedTotpSecret = ''
        if (decryptedPassword) {
          try {
            const entryKey = await deriveSubKey(masterKey, `entry-${entry.id}`, ['encrypt', 'decrypt'])
            const ciphertext = base64ToBuffer(decryptedPassword)
            let decrypted: ArrayBuffer
            if (entry.modified) {
              const aad = new TextEncoder().encode(`${entry.id}:${entry.modified}`).buffer as ArrayBuffer
              decrypted = await decrypt(entryKey, ciphertext, aad)
            } else {
              decrypted = await decrypt(entryKey, ciphertext)
            }
            decryptedPassword = new TextDecoder().decode(decrypted)
          } catch {
            // Keep original value if it was already plaintext.
          }
        }
        if (entry.login.totp?.secret) {
          try {
            const entryKey = await deriveSubKey(masterKey, `entry-${entry.id}`, ['encrypt', 'decrypt'])
            const ciphertext = base64ToBuffer(entry.login.totp.secret)
            let decrypted: ArrayBuffer
            if (entry.modified) {
              const aad = new TextEncoder().encode(`${entry.id}:${entry.modified}`).buffer as ArrayBuffer
              decrypted = await decrypt(entryKey, ciphertext, aad)
            } else {
              decrypted = await decrypt(entryKey, ciphertext)
            }
            decryptedTotpSecret = new TextDecoder().decode(decrypted)
          } catch {
            decryptedTotpSecret = ''
          }
        }
        const data = {
          entryId: entry.id,
          name: metadata?.name ?? entry.name ?? '',
          urls: urls,
          username: metadata?.username ?? entry.login.username ?? '',
          password: decryptedPassword,
          totp: decryptedTotpSecret
            ? {
                secret: decryptedTotpSecret,
                algorithm: entry.login.totp?.algorithm || 'SHA1',
                digits: entry.login.totp?.digits || 6,
                period: entry.login.totp?.period || 30,
                issuer: metadata?.totpIssuer ?? entry.login.totp?.issuer ?? ''
              }
            : undefined
        }
        const encoded = new TextEncoder().encode(JSON.stringify(data))
        const encrypted = await encrypt(autofillKey, encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer)
        const iv = encrypted.slice(0, 12)
        const ciphertext = encrypted.slice(12)
        autofillData.push({
          entryId: entry.id,
          urls: urls,
          iv: bufferToBase64(iv),
          ciphertext: bufferToBase64(ciphertext)
        })
      }
      
      await chrome.storage.session.set({ 
        autofillKey: exportedAutofillKey,
        autofillData 
      })
      await notifyActiveTabAutofillRefresh()
    } catch (err) {
      console.error('Failed to export autofill data:', err)
    }
  }, [])

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
      const vaultHeader = await loadVaultHeader()
      
      // Attempt unlock with automatic KDF migration detection
      const unlockAttempt = await attemptVaultUnlockWithMigration(password, salt, vaultHeader)
      if (!unlockAttempt.success || !unlockAttempt.result) {
        throw new Error('Unable to decrypt vault - password may be incorrect or vault is corrupted')
      }
      
      let { key, rawBytes } = unlockAttempt.result
      let kdfNeedsMigration = unlockAttempt.needsMigration || needsKdfMigration(vaultHeader)

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

      // Unpad decrypted data (LOTUS-011)
      const unpaddedData = unpadVaultPlaintext(new Uint8Array(decryptedData))
      const decodedVault = JSON.parse(new TextDecoder().decode(unpaddedData)) as Vault
      const migrated = decodedVault.version < CURRENT_VAULT_SCHEMA_VERSION
      let vaultData = migrated
        ? await migrateVaultWithRecovery(decodedVault, { vault: result.vault, aad: result.vaultAad, syncVersion: result.vaultSyncVersion })
        : decodedVault
      
      // LOTUS-017: Hydrate entries with decrypted metadata if needed
      // This fixes entries that were saved with encrypted metadata but missing plaintext fields
      vaultData = await hydrateEntriesWithMetadata(vaultData, key)

      const isValid = await verifyVaultIntegrity(vaultData)
      if (!isValid) {
        throw new Error('Vault integrity check failed - possible tampering detected')
      }

      // Perform silent KDF migration if needed
      if (kdfNeedsMigration) {
        try {
          const { newKey, newRawBytes, newHeader } = await migrateKdf(password, salt)

          // Update to new key and header
          await saveVaultHeader(newHeader)
          key = newKey
          rawBytes = newRawBytes

          // Re-encrypt vault with new key
          await saveVault(vaultData, key)

          const hasBiometric = await hasBiometricCredential()
          if (hasBiometric) {
            try {
              await registerBiometric(key, rawBytes.buffer as ArrayBuffer)
              await appendSyncEvent('migration', 'Biometric credential updated with new KDF key')
            } catch (bioError) {
              console.error('Failed to update biometric credential after KDF migration:', bioError)
              await appendSyncEvent('migration', 'Biometric credential update failed - please re-register biometric', 'warning')
            }
          }

          const { hasPin, clearPin } = await import('../../lib/pin')
          const hasPinEnabled = await hasPin()
          if (hasPinEnabled) {
            await clearPin()
            await appendSyncEvent('migration', 'PIN cleared - please re-set your PIN after migration', 'warning')
          }

          const result = await chrome.storage.local.get([STORAGE_KEYS.SETTINGS])
          const settings = result[STORAGE_KEYS.SETTINGS]
          if (settings?.encrypted) {
            try {
              const decrypted = await decryptSettings(key, settings.encrypted as EncryptedSettings)
              if (decrypted) {
                const reEncrypted = await encryptSettings(key, decrypted)
                await chrome.storage.local.set({
                  [STORAGE_KEYS.SETTINGS]: { encrypted: reEncrypted }
                })
                await appendSyncEvent('migration', 'Settings re-encrypted with new KDF key')
              }
            } catch (settingsError) {
              console.error('Failed to re-encrypt settings after KDF migration:', settingsError)
              await appendSyncEvent('migration', 'Settings re-encryption failed', 'warning')
            }
          }

          await appendSyncEvent('migration', `KDF migrated to v${CURRENT_KDF_VERSION} (256 MiB)`)
          console.log(`KDF migrated from v${vaultHeader?.kdfVersion ?? 1} to v${CURRENT_KDF_VERSION}`)
        } catch (migrationError) {
          // Log but don't fail - user can still use vault with old KDF
          console.error('KDF migration failed (non-fatal):', migrationError)
          await appendSyncEvent('migration', 'KDF migration failed (vault still usable)', 'warning')
        }
      }

      setVault(vaultData)
      clearDecryptCache()
      setMasterKey(key)
      setIsUnlocked(true)
      skipScheduleOnCloseRef.current = false

      // LOTUS-007: Do NOT store masterKeyRaw in session storage
      // Session is lost when popup closes, user must unlock again

      // Export autofill data for background script
      await exportAutofillData(vaultData, key)
      await hydrateS3SyncSession(key)
      await clearLockAlarm()
      await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_BASE]: vaultData })
      if (migrated && !kdfNeedsMigration) {
        await saveVault(vaultData, key)
      }
      secureWipe(rawBytes)
      secureWipe(salt)

      await logSecurityEvent('vault-unlock-success', 'info')
      return true
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      console.error('Unlock error:', errorMsg)
      setError(`Failed to unlock: ${errorMsg}`)
      await logSecurityEvent('vault-unlock-failure', 'warning', { errorType: 'password', error: errorMsg })
      return false
    } finally {
           setIsLoading(false)
    }
  }, [clearDecryptCache, clearLockAlarm, hydrateS3SyncSession])

  const unlockWithBiometric = useCallback(async (): Promise<boolean> => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await chrome.storage.local.get(['vault', 'vaultAad', 'vaultSyncVersion', VAULT_HEADER_KEY])
      if (!result.vault) {
        throw new Error('No vault found')
      }

      const key = await authenticateWithBiometric()
      if (!key) {
        throw new Error(getLastBiometricError() || 'Biometric authentication failed')
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
        const vaultHeader = parseVaultHeader(result[VAULT_HEADER_KEY])
        if (needsKdfMigration(vaultHeader)) {
          throw new Error('Biometric unlock unavailable until vault migration is completed. Please unlock with your master password first.')
        }
        throw new Error('Unable to decrypt vault with biometric')
      }

      // Unpad decrypted data (LOTUS-011)
      const unpaddedData = unpadVaultPlaintext(new Uint8Array(decryptedData))
      const decodedVault = JSON.parse(new TextDecoder().decode(unpaddedData)) as Vault
      const migrated = decodedVault.version < CURRENT_VAULT_SCHEMA_VERSION
      let vaultData = migrated
        ? await migrateVaultWithRecovery(decodedVault, { vault: result.vault, aad: result.vaultAad, syncVersion: result.vaultSyncVersion })
        : decodedVault
      
      // LOTUS-017: Hydrate entries with decrypted metadata if needed
      vaultData = await hydrateEntriesWithMetadata(vaultData, key)

      const isValid = await verifyVaultIntegrity(vaultData)
      if (!isValid) {
        throw new Error('Vault integrity check failed')
      }

      setVault(vaultData)
      clearDecryptCache()
      setMasterKey(key)
      setIsUnlocked(true)
      skipScheduleOnCloseRef.current = false

      await exportAutofillData(vaultData, key)
      await hydrateS3SyncSession(key)
      await clearLockAlarm()
      await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_BASE]: vaultData })
      if (migrated) {
        await saveVault(vaultData, key)
      }

      await logSecurityEvent('biometric-auth-success', 'info')
      return true
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      console.error('Biometric unlock error:', errorMsg)
      setError(`Biometric unlock failed: ${errorMsg}`)
      await logSecurityEvent('biometric-auth-failure', 'warning', { error: errorMsg })
      return false
    } finally {
      setIsLoading(false)
    }
  }, [clearDecryptCache, clearLockAlarm, hydrateS3SyncSession])

  const unlockWithPin = useCallback(async (pin: string): Promise<boolean> => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await chrome.storage.local.get(['vault', 'vaultAad', 'vaultSyncVersion', VAULT_HEADER_KEY])
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
        const vaultHeader = parseVaultHeader(result[VAULT_HEADER_KEY])
        if (needsKdfMigration(vaultHeader)) {
          throw new Error('PIN unlock unavailable until vault migration is completed. Please unlock with your master password first.')
        }
        const { hasPin } = await import('../../lib/pin')
        const hasPinEnabled = await hasPin()
        if (hasPinEnabled) {
          throw new Error('PIN unlock failed. Your vault was recently migrated and your PIN needs to be reset. Please unlock with your master password, then disable and re-enable PIN in Settings.')
        }
        throw new Error('Unable to decrypt vault with PIN')
      }

      // Unpad decrypted data (LOTUS-011)
      const unpaddedData = unpadVaultPlaintext(new Uint8Array(decryptedData))
      const decodedVault = JSON.parse(new TextDecoder().decode(unpaddedData)) as Vault
      const migrated = decodedVault.version < CURRENT_VAULT_SCHEMA_VERSION
      let vaultData = migrated
        ? await migrateVaultWithRecovery(decodedVault, { vault: result.vault, aad: result.vaultAad, syncVersion: result.vaultSyncVersion })
        : decodedVault
      
      // LOTUS-017: Hydrate entries with decrypted metadata if needed
      vaultData = await hydrateEntriesWithMetadata(vaultData, key)

      const isValid = await verifyVaultIntegrity(vaultData)
      if (!isValid) {
        throw new Error('Vault integrity check failed')
      }

      setVault(vaultData)
      clearDecryptCache()
      setMasterKey(key)
      setIsUnlocked(true)
      skipScheduleOnCloseRef.current = false

      await clearPinLockout()
      // LOTUS-007: Do NOT store masterKeyRaw in session storage
      await exportAutofillData(vaultData, key)
      await hydrateS3SyncSession(key)
      await clearLockAlarm()
      await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_BASE]: vaultData })
      if (migrated) {
        await saveVault(vaultData, key)
      }
      secureWipe(rawMasterKey)

      await logSecurityEvent('pin-auth-success', 'info')
      return true
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      console.error('PIN unlock error:', errorMsg)
      setError(`PIN unlock failed: ${errorMsg}`)
      await logSecurityEvent('pin-auth-failure', 'warning', { error: errorMsg })
      return false
    } finally {
      setIsLoading(false)
    }
  }, [clearDecryptCache, clearLockAlarm, hydrateS3SyncSession])

  const addEntry = useCallback(async (entry: VaultEntry) => {
    const currentVault = vaultRef.current
    const key = masterKeyRef.current
    if (!currentVault || !key) return

    // LOTUS-017: Encrypt metadata before saving
    const entryWithEncryptedMetadata = await prepareEntryForStorage(key, entry)
    
    const normalizedEntry = {
      ...entryWithEncryptedMetadata,
      trashedAt: undefined,
      trashExpiresAt: undefined
    } as VaultEntry

    const newVault = {
      ...currentVault,
      entries: [...currentVault.entries, normalizedEntry],
      lastSync: Date.now(),
      syncVersion: currentVault.syncVersion + 1
    }

    setVault(newVault)
    clearDecryptCache()
    clearMetadataCache()
    await enqueueSyncOperation({ kind: 'entry-upsert', entityId: normalizedEntry.id })
    await saveVault(newVault, key)
    await exportAutofillData(newVault, key)
    await logSecurityEvent('entry-created', 'info', { entryId: normalizedEntry.id, entryType: normalizedEntry.type })
  }, [clearDecryptCache, clearMetadataCache, exportAutofillData, saveVault])

  const updateEntry = useCallback(async (entry: VaultEntry) => {
    const currentVault = vaultRef.current
    const key = masterKeyRef.current
    if (!currentVault || !key) return

    const existing = currentVault.entries.find((candidate) => candidate.id === entry.id) || null
    
    // LOTUS-017: Encrypt metadata before saving
    const entryWithEncryptedMetadata = await prepareEntryForStorage(key, entry)
    
    const normalizedEntry = {
      ...entryWithEncryptedMetadata,
      trashedAt: existing ? (existing as VaultEntry & { trashedAt?: number }).trashedAt : undefined,
      trashExpiresAt: existing ? (existing as VaultEntry & { trashExpiresAt?: number }).trashExpiresAt : undefined
    } as VaultEntry

    const newVault = {
      ...currentVault,
      entries: currentVault.entries.map(e => e.id === entry.id ? normalizedEntry : e),
      lastSync: Date.now(),
      syncVersion: currentVault.syncVersion + 1
    }

    setVault(newVault)
    clearDecryptCache()
    clearMetadataCache()
    await enqueueSyncOperation({ kind: 'entry-upsert', entityId: entry.id })
    await saveVault(newVault, key)
    await exportAutofillData(newVault, key)
    await logSecurityEvent('entry-updated', 'info', { entryId: entry.id, entryType: entry.type })
  }, [clearDecryptCache, clearMetadataCache, exportAutofillData, saveVault])

  const deleteEntry = useCallback(async (entryId: string) => {
    const currentVault = vaultRef.current
    const key = masterKeyRef.current
    if (!currentVault || !key) return
    const retentionDays = await getTrashRetentionDays(key)
    const now = Date.now()
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000

    const newVault = {
      ...currentVault,
      entries: currentVault.entries.map((entry) => {
        if (entry.id !== entryId) return entry
        
        // Keep encrypted metadata intact when trashing
        return {
          ...entry,
          modified: now,
          trashedAt: now,
          trashExpiresAt: now + retentionMs
        } as VaultEntry
      }),
      lastSync: now,
      syncVersion: currentVault.syncVersion + 1
    }

    setVault(newVault)
    clearDecryptCache()
    clearMetadataCache()
    await enqueueSyncOperation({ kind: 'entry-upsert', entityId: entryId })
    await appendSyncEvent('sync-queued', `Moved entry to trash: ${entryId}`)
    await saveVault(newVault, key)
    await exportAutofillData(newVault, key)
    await logSecurityEvent('entry-deleted', 'info', { entryId })
  }, [clearDecryptCache, clearMetadataCache, exportAutofillData, getTrashRetentionDays, saveVault])

  const restoreEntry = useCallback(async (entryId: string) => {
    const currentVault = vaultRef.current
    const key = masterKeyRef.current
    if (!currentVault || !key) return

    const now = Date.now()
    const newVault = {
      ...currentVault,
      entries: currentVault.entries.map((entry) => (
        entry.id === entryId
          ? ({
              ...entry,
              modified: now,
              trashedAt: undefined,
              trashExpiresAt: undefined
            } as VaultEntry)
          : entry
      )),
      lastSync: now,
      syncVersion: currentVault.syncVersion + 1
    }

    setVault(newVault)
    clearDecryptCache()
    clearMetadataCache()
    await enqueueSyncOperation({ kind: 'entry-upsert', entityId: entryId })
    await saveVault(newVault, key)
    await exportAutofillData(newVault, key)
    await logSecurityEvent('entry-restored', 'info', { entryId })
  }, [clearDecryptCache, clearMetadataCache, exportAutofillData, saveVault])

  const permanentlyDeleteEntry = useCallback(async (entryId: string) => {
    const currentVault = vaultRef.current
    const key = masterKeyRef.current
    if (!currentVault || !key) return

    const newVault = {
      ...currentVault,
      entries: currentVault.entries.filter((entry) => entry.id !== entryId),
      lastSync: Date.now(),
      syncVersion: currentVault.syncVersion + 1
    }

    setVault(newVault)
    clearDecryptCache()
    clearMetadataCache()
    await enqueueSyncOperation({ kind: 'entry-delete', entityId: entryId })
    await saveVault(newVault, key)
    await exportAutofillData(newVault, key)
    await logSecurityEvent('entry-permanently-deleted', 'warning', { entryId })
  }, [clearDecryptCache, clearMetadataCache, exportAutofillData, saveVault])

  const getEntry = useCallback((entryId: string): VaultEntry | null => {
    const currentVault = vaultRef.current
    if (!currentVault) return null
    return currentVault.entries.find(e => e.id === entryId) || null
  }, [])

  const getTrashedEntries = useCallback((): VaultEntry[] => {
    const currentVault = vaultRef.current
    if (!currentVault) return []
    return currentVault.entries.filter((entry) => isEntryTrashed(entry))
  }, [])

  const searchEntries = useCallback((query: string): VaultEntry[] => {
    const currentVault = vaultRef.current
    if (!currentVault) return []
    const entries = Array.isArray(currentVault.entries)
      ? currentVault.entries.filter((entry) => !isEntryTrashed(entry))
      : []
    if (!query) return entries
    
    const lowerQuery = query.trim().toLowerCase()
    if (!lowerQuery) return entries
    const index = searchIndexRef.current
    return entries.filter((entry) => {
      const haystack = index.get(entry.id)
      if (haystack) return haystack.includes(lowerQuery)
      return (entry.name || '').toLowerCase().includes(lowerQuery)
    })
  }, [])

  const purgeExpiredTrash = useCallback(async () => {
    const currentVault = vaultRef.current
    const key = masterKeyRef.current
    if (!currentVault || !key) return

    const now = Date.now()
    const nextEntries = currentVault.entries.filter((entry) => {
      if (!isEntryTrashed(entry)) return true
      const expiresAt = getEntryTrashExpiresAt(entry)
      if (typeof expiresAt !== 'number') return true
      return expiresAt > now
    })

    if (nextEntries.length === currentVault.entries.length) return

    const newVault: Vault = {
      ...currentVault,
      entries: nextEntries,
      lastSync: now,
      syncVersion: currentVault.syncVersion + 1
    }

    setVault(newVault)
    clearDecryptCache()
    clearMetadataCache()
    await enqueueSyncOperation({ kind: 'vault-write' })
    await saveVault(newVault, key)
    await exportAutofillData(newVault, key)
  }, [clearDecryptCache, clearMetadataCache, exportAutofillData, saveVault])

  const encryptValue = useCallback(async (value: string, entryId: string, modified?: number): Promise<string> => {
    const key = masterKeyRef.current
    if (!key) throw new Error('Vault locked')
    const entryKey = await deriveSubKey(key, `entry-${entryId}`, ['encrypt', 'decrypt'])
    const encoded = new TextEncoder().encode(value)
    const payload = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer
    // Only bind to AAD when a stable modified timestamp is supplied by caller.
    const encrypted = modified
      ? await encrypt(
          entryKey,
          payload,
          new TextEncoder().encode(`${entryId}:${modified}`).buffer as ArrayBuffer
        )
      : await encrypt(entryKey, payload)
    return bufferToBase64(encrypted)
  }, [])

  const decryptValue = useCallback(async (ciphertext: string, entryId: string, modified?: number): Promise<string> => {
    const key = masterKeyRef.current
    if (!key) throw new Error('Vault locked')
    if (!ciphertext) throw new Error('Empty ciphertext')
    
    const cacheKey = getDecryptCacheKey(ciphertext, entryId, modified)
    const cached = decryptCacheRef.current.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }
    
    // Handle legacy plaintext values (not base64 encoded)
    // Encrypted values should be base64 with at least 12 bytes (IV) + 16 bytes (tag) + 1 byte (data)
    // So minimum valid base64 length for encrypted data is 40 chars (29+ bytes)
    if (ciphertext.length < 40) {
      // Likely plaintext, return as-is
      return ciphertext
    }
    
    let buffer: ArrayBuffer
    try {
      buffer = base64ToBuffer(ciphertext)
    } catch (e) {
      // If base64 decoding fails, might be plaintext
      console.warn('Failed to decode base64, treating as plaintext:', e)
      return ciphertext
    }
    
    // Validate minimum buffer size (12 bytes IV + 16 bytes auth tag = 28 bytes minimum)
    if (buffer.byteLength < 28) {
      console.warn('Buffer too small for encrypted data, treating as plaintext')
      return ciphertext
    }
    
    const entryKey = await deriveSubKey(key, `entry-${entryId}`, ['encrypt', 'decrypt'])
    let decrypted: ArrayBuffer
    
    if (modified) {
      try {
        const aadData = `${entryId}:${modified}`
        const aad = new TextEncoder().encode(aadData).buffer as ArrayBuffer
        decrypted = await decrypt(entryKey, buffer, aad)
      } catch (aadError) {
        // Compatibility fallback for records encrypted without AAD.
        try {
          decrypted = await decrypt(entryKey, buffer)
        } catch (noAadError) {
          const headerResult = await chrome.storage.local.get(VAULT_HEADER_KEY)
          const vaultHeader = parseVaultHeader(headerResult[VAULT_HEADER_KEY])
          if (vaultHeader && needsKdfMigration(vaultHeader)) {
            throw new Error('Decryption failed: Vault needs migration. Please unlock with your master password.')
          }
          console.error(`Decryption failed for entry ${entryId}:`, { modified, hasAad: true, aadError, noAadError })
          throw new Error('Decryption failed: Unable to decrypt field. The encryption key may be incorrect.')
        }
      }
    } else {
      try {
        decrypted = await decrypt(entryKey, buffer)
      } catch (e) {
        const headerResult = await chrome.storage.local.get(VAULT_HEADER_KEY)
        const vaultHeader = parseVaultHeader(headerResult[VAULT_HEADER_KEY])
        if (vaultHeader && needsKdfMigration(vaultHeader)) {
          throw new Error('Decryption failed: Vault needs migration. Please unlock with your master password.')
        }
        console.error(`Decryption failed for entry ${entryId}:`, { modified, error: e })
        throw new Error('Decryption failed: Unable to decrypt field. The encryption key may be incorrect.')
      }
    }
    const value = new TextDecoder().decode(decrypted)
    setDecryptCacheValue(cacheKey, value)
    return value
  }, [getDecryptCacheKey, setDecryptCacheValue])

  const importEntries = useCallback(async (
    entries: VaultEntry[],
    options?: { mode?: 'append' | 'merge' }
  ): Promise<{ created: number; merged: number; skipped: number }> => {
    const currentVault = vaultRef.current
    const key = masterKeyRef.current
    if (!currentVault || !key) return { created: 0, merged: 0, skipped: entries.length }
    const mode = options?.mode || 'append'

    const summary = { created: 0, merged: 0, skipped: 0 }

    const encryptImportedEntry = async (entry: VaultEntry): Promise<VaultEntry> => {
      const encryptedEntry = { ...entry }
      const modifiedAt = entry.modified || Date.now()
      encryptedEntry.modified = modifiedAt
      
      // LOTUS-017: Encrypt sensitive field values
      if (entry.login) {
        encryptedEntry.login = { ...entry.login }
        if (entry.login.password) {
          encryptedEntry.login.password = await encryptValue(entry.login.password, entry.id, modifiedAt)
        }
        if (entry.login.totp?.secret) {
          encryptedEntry.login.totp = { ...entry.login.totp }
          encryptedEntry.login.totp.secret = await encryptValue(entry.login.totp.secret, entry.id, modifiedAt)
        }
      }
      if (entry.note?.content) {
        encryptedEntry.note = { ...entry.note }
        encryptedEntry.note.content = await encryptValue(entry.note.content, entry.id, modifiedAt)
      }
      
      // LOTUS-017: Encrypt metadata
      return await prepareEntryForStorage(key, encryptedEntry)
    }

    const matchImportedToExisting = (imported: VaultEntry, existing: VaultEntry[]): VaultEntry | null => {
      if (imported.type !== 'login' || !imported.login) return null
      const importedUrls = normalizeEntryUrls(imported.login.urls)
      let best: { entry: VaultEntry; score: number } | null = null

      for (const candidate of existing) {
        if (candidate.type !== 'login' || !candidate.login) continue
        if (isEntryTrashed(candidate)) continue
        const candidateUrls = normalizeEntryUrls(candidate.login.urls)

        let bestUrlScore = 0
        for (const importedUrl of importedUrls) {
          for (const candidateUrl of candidateUrls) {
            bestUrlScore = Math.max(bestUrlScore, getUrlMatchScore(candidateUrl, importedUrl))
          }
        }

        const normalizedImportedName = (imported.name || '').trim().toLowerCase()
        const normalizedCandidateName = (candidate.name || '').trim().toLowerCase()
        const strictNameMatch = normalizedImportedName && normalizedCandidateName && normalizedImportedName === normalizedCandidateName
        const nameScore = strictNameMatch
          ? 96
          : getEntryNameMatchScore(candidate.name || '', importedUrls[0] || imported.name || '')
        const score = Math.max(bestUrlScore, nameScore)
        if (bestUrlScore < 96 && nameScore < 90) continue
        if (!best || score > best.score) {
          best = { entry: candidate, score }
        }
      }

      return best?.entry || null
    }
    
    let nextEntries = [...currentVault.entries]
    const entriesToCreate: VaultEntry[] = []

    for (const importedEntry of entries) {
      if (mode !== 'merge') {
        entriesToCreate.push(importedEntry)
        continue
      }

      const match = matchImportedToExisting(importedEntry, nextEntries)
      if (!match || match.type !== 'login' || !match.login || importedEntry.type !== 'login' || !importedEntry.login) {
        entriesToCreate.push(importedEntry)
        continue
      }

      let changed = false
      const updatedModified = Date.now()
      const mergedEntry: VaultEntry = { ...match }
      const mergedLogin = { ...match.login! }

      const importedUsername = (importedEntry.login.username || '').trim()
      if (!mergedLogin.username && importedUsername) {
        mergedLogin.username = importedUsername
        changed = true
      }

      const mergedUrls = Array.from(
        new Set([
          ...normalizeEntryUrls(mergedLogin.urls),
          ...normalizeEntryUrls(importedEntry.login.urls)
        ])
      )
      if (!urlSetsEqual(normalizeEntryUrls(mergedLogin.urls), mergedUrls)) {
        mergedLogin.urls = mergedUrls
        changed = true
      }

      if (!mergedLogin.password && importedEntry.login.password) {
        mergedLogin.password = await encryptValue(importedEntry.login.password, match.id, updatedModified)
        changed = true
      }

      if (!mergedLogin.totp?.secret && importedEntry.login.totp?.secret) {
        mergedLogin.totp = {
          ...importedEntry.login.totp,
          secret: await encryptValue(importedEntry.login.totp.secret, match.id, updatedModified)
        }
        changed = true
      }

      if (mergedEntry.note?.content && importedEntry.note?.content) {
        const encryptedNote = await encryptValue(importedEntry.note.content, match.id, updatedModified)
        mergedEntry.note = { content: encryptedNote }
        changed = true
      }

      const importedTags = importedEntry.tags || []
      const existingTags = mergedEntry.tags || []
      const newTags = importedTags.filter((tag) => !existingTags.includes(tag))
      if (newTags.length > 0) {
        mergedEntry.tags = [...existingTags, ...newTags]
        changed = true
      }

      if (!mergedEntry.favorite && importedEntry.favorite) {
        mergedEntry.favorite = true
        changed = true
      }

      const importedName = (importedEntry.name || '').trim()
      const existingName = (mergedEntry.name || '').trim()
      if (importedName && importedName.length > existingName.length) {
        mergedEntry.name = importedName
        changed = true
      }

      if (changed) {
        mergedEntry.modified = updatedModified
        mergedEntry.login = mergedLogin
        const updated = await prepareEntryForStorage(key, mergedEntry)
        nextEntries = nextEntries.map((entry) => (entry.id === match.id ? updated : entry))
        summary.merged += 1
      } else {
        summary.skipped += 1
      }
    }

    const encryptedEntries = await Promise.all(entriesToCreate.map(encryptImportedEntry))
    summary.created = encryptedEntries.length

    const newVault = {
      ...currentVault,
      entries: [...nextEntries, ...encryptedEntries],
      lastSync: Date.now(),
      syncVersion: currentVault.syncVersion + 1
    }

    setVault(newVault)
    clearDecryptCache()
    clearMetadataCache()
    await enqueueSyncOperation({ kind: 'vault-write' })
    await saveVault(newVault, key)
    await exportAutofillData(newVault, key)
    return summary
  }, [clearDecryptCache, clearMetadataCache, encryptValue, exportAutofillData, saveVault])

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

  useEffect(() => {
    if (!isUnlocked) return
    void purgeExpiredTrash()
  }, [isUnlocked, purgeExpiredTrash, vault?.syncVersion])

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
      const migrationRecovery = await recoverIncompleteMigration()
      if (migrationRecovery.restored && migrationRecovery.vault) {
        await chrome.storage.local.set({
          vault: migrationRecovery.vault,
          vaultAad: migrationRecovery.aad,
          vaultSyncVersion: migrationRecovery.syncVersion
        })
        await appendSyncEvent('migration', 'Recovered from interrupted migration', 'warning')
      }

      const localResult = await chrome.storage.local.get(['vault'])
      const hasVault = !!localResult.vault
      setVaultExists(hasVault)
      await refreshSyncTimeline()
      await refreshUnresolvedConflicts()
      
      // LOTUS-007: Do NOT restore session from masterKeyRaw
      // Session is lost when popup closes for security - user must unlock again

      setIsLoading(false)
    }
    
    init()
  }, [clearDecryptCache, clearLockAlarm, hydrateS3SyncSession, refreshUnresolvedConflicts])

  useEffect(() => {
    const listener: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area !== 'local') return
      if (changes[STORAGE_KEYS.SYNC_CONFLICTS]) {
        void refreshUnresolvedConflicts()
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [refreshUnresolvedConflicts])

  const stateValue = useMemo<VaultStateContextType>(() => ({
    vault,
    isUnlocked,
    masterKey,
    isLoading,
    error,
    vaultExists,
    syncStatus,
    syncError,
    lastSyncTime,
    s3SyncStatus: s3Status,
    s3LastSyncTime,
    s3IsSyncing,
    pendingSave,
    syncTimeline,
    unresolvedConflicts,
    unresolvedConflictCount: unresolvedConflicts.length
  }), [
    vault,
    isUnlocked,
    masterKey,
    isLoading,
    error,
    vaultExists,
    syncStatus,
    syncError,
    lastSyncTime,
    s3Status,
    s3LastSyncTime,
    s3IsSyncing,
    pendingSave,
    syncTimeline,
    unresolvedConflicts
  ])

  const actionsValue = useMemo<VaultActionsContextType>(() => ({
    unlockVault,
    unlockWithBiometric,
    unlockWithPin,
    lockVault,
    createVault,
    addEntry,
    importEntries,
    updateEntry,
    deleteEntry,
    restoreEntry,
    permanentlyDeleteEntry,
    getEntry,
    getTrashedEntries,
    searchEntries,
    encryptValue,
    decryptValue,
    clearPendingSave,
    encryptSettingsData,
    decryptSettingsData,
    refreshSyncTimeline,
    refreshUnresolvedConflicts
  }), [
    unlockVault,
    unlockWithBiometric,
    unlockWithPin,
    lockVault,
    createVault,
    addEntry,
    importEntries,
    updateEntry,
    deleteEntry,
    restoreEntry,
    permanentlyDeleteEntry,
    getEntry,
    getTrashedEntries,
    searchEntries,
    encryptValue,
    decryptValue,
    clearPendingSave,
    encryptSettingsData,
    decryptSettingsData,
    refreshSyncTimeline,
    refreshUnresolvedConflicts
  ])

  const value: VaultContextType = useMemo(() => ({
    ...stateValue,
    ...actionsValue
  }), [stateValue, actionsValue])

  return (
    <VaultStateContext.Provider value={stateValue}>
      <VaultActionsContext.Provider value={actionsValue}>
        <VaultContext.Provider value={value}>
          {children}
        </VaultContext.Provider>
      </VaultActionsContext.Provider>
    </VaultStateContext.Provider>
  )
}