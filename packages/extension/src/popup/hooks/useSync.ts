import { useEffect, useRef, useState, useCallback } from 'react'
import { Vault } from '@lotus/shared'
import { STORAGE_KEYS } from '../../lib/constants'
import { bufferToBase64, base64ToBuffer, decrypt, deriveSubKey, decryptSettings, EncryptedSettings, assertEncryptedBlobPayload } from '../../lib/crypto-utils'
import { appendSyncEvent } from '../../lib/sync-observability'
import { clearSyncOperationQueue, getSyncOperationQueue } from '../../lib/sync-ops'
import { threeWayMerge } from '../../lib/three-way-merge'
import { appendUnresolvedConflicts } from '../../lib/sync-conflicts'

function generateNonce(): string {
  const timestamp = Date.now().toString(36)
  const random = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(36).padStart(2, '0'))
    .join('')
  return `${timestamp}-${random}`
}

interface SyncSettings {
  serverUrl?: string
  syncSecret?: string
}

const MAX_RETRIES = 3
const RETRY_DELAY_BASE = 1000

export function useSync(
  vault: Vault | null, 
  masterKey: CryptoKey | null,
  onPull: (vaultData: Vault) => Promise<void>
) {
  const wsRef = useRef<WebSocket | null>(null)
  const [syncStatus, setSyncStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error' | 'offline'>('disconnected')
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const isSyncing = useRef(false)
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const syncWithRetry = useCallback(async (retryCount = 0): Promise<boolean> => {
    if (!vault || !masterKey || isSyncing.current) return false

    const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS)
    let settings: SyncSettings = {}

    if (result[STORAGE_KEYS.SETTINGS]?.encrypted) {
      const decrypted = await decryptSettings(masterKey, result[STORAGE_KEYS.SETTINGS].encrypted as EncryptedSettings)
      settings = decrypted || {}
    } else {
      settings = result[STORAGE_KEYS.SETTINGS] || {}
    }

    const { serverUrl, syncSecret } = settings
    if (!serverUrl || !syncSecret) return false

    let httpUrl = serverUrl
    if (httpUrl.startsWith('ws')) httpUrl = httpUrl.replace('ws', 'http')
    if (httpUrl.endsWith('/api/sync')) httpUrl = httpUrl.replace('/api/sync', '')

    isSyncing.current = true
    setSyncError(null)
    await appendSyncEvent('sync-start', 'Starting server sync')
    
    try {
      if (!navigator.onLine) {
        setSyncStatus('offline')
        await appendSyncEvent('sync-queued', 'Offline: queued for replay', 'warning')
        return false
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)

      const versionRes = await fetch(`${httpUrl}/api/vault/version`, {
        headers: {
          'X-Lotus-Secret': syncSecret,
          'X-Request-Nonce': generateNonce()
        },
        signal: controller.signal
      })
      clearTimeout(timeoutId)
      
      if (!versionRes.ok) throw new Error(`Server error: ${versionRes.status}`)
      
      const { version: serverVersion } = await versionRes.json()
      
      if (serverVersion > vault.syncVersion) {
        const vaultRes = await fetch(`${httpUrl}/api/vault`, {
           headers: {
             'X-Lotus-Secret': syncSecret,
             'X-Request-Nonce': generateNonce()
           }
        })
        if (!vaultRes.ok) throw new Error('Failed to fetch vault')
        
        const remotePayload = await vaultRes.json()
        assertEncryptedBlobPayload(remotePayload)
        
        const encryptedBuffer = base64ToBuffer(remotePayload.blob)
        const vaultKey = await deriveSubKey(masterKey, 'vault-main', ['encrypt', 'decrypt'])
        const decryptedData = await decrypt(vaultKey, encryptedBuffer)
        const vaultData = JSON.parse(new TextDecoder().decode(decryptedData)) as Vault
        
        await onPull(vaultData)
        await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_BASE]: vaultData })
        await appendSyncEvent('sync-pull', `Pulled server v${remotePayload.version}`)
      } else if (vault.syncVersion > serverVersion) {
        const stored = await chrome.storage.local.get(['vault'])
        if (stored.vault) {
           const u8 = new Uint8Array(stored.vault)
           const buffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
           const blob = bufferToBase64(buffer)
           
            const pushRes = await fetch(`${httpUrl}/api/vault`, {
               method: 'PUT',
               headers: {
                 'Content-Type': 'application/json',
                 'X-Lotus-Secret': syncSecret,
                 'X-Request-Nonce': generateNonce()
               },
               body: JSON.stringify({ blob, version: vault.syncVersion })
             })
             
             if (!pushRes.ok) {
               if (pushRes.status === 409) {
                 const conflict = await pushRes.json()
                 assertEncryptedBlobPayload(conflict)
                 const vaultKey = await deriveSubKey(masterKey, 'vault-main', ['encrypt', 'decrypt'])
                 const remoteDecrypted = await decrypt(vaultKey, base64ToBuffer(conflict.blob))
                 const remoteVault = JSON.parse(new TextDecoder().decode(remoteDecrypted)) as Vault
                 const baseResult = await chrome.storage.local.get(STORAGE_KEYS.SYNC_BASE)
                 const baseVault = (baseResult[STORAGE_KEYS.SYNC_BASE] as Vault | undefined) ?? vault
                 const merged = await threeWayMerge(vault, remoteVault, baseVault)
                 await appendSyncEvent('sync-merge', `3-way merge completed (${merged.conflicts.length} conflicts)`, merged.conflicts.length ? 'warning' : 'info')
                 if (merged.conflicts.length > 0) {
                   await appendSyncEvent('sync-conflict', `${merged.conflicts.length} unresolved conflicts`, 'warning')
                  await appendUnresolvedConflicts('server', merged.conflicts)
                 }
                 await onPull(merged.vault)
               } else {
                 throw new Error(`Push failed: ${pushRes.status}`)
               }
             } else {
               await appendSyncEvent('sync-push', `Pushed server v${vault.syncVersion}`)
               await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_BASE]: vault })
             }
        }
      }
      
      setLastSyncTime(Date.now())
      setSyncStatus('connected')
      setSyncError(null)
      await clearSyncOperationQueue()
      await appendSyncEvent('sync-success', 'Server sync completed')
      
      return true
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Sync failed'
      console.error('Sync error:', e)
      
      if (!navigator.onLine || errorMessage.includes('fetch') || errorMessage.includes('network')) {
        setSyncStatus('offline')
        setSyncError('Working offline - changes will sync when connection is restored')
        await appendSyncEvent('sync-queued', 'Network unavailable, keeping queue', 'warning')
      } else if (retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAY_BASE * Math.pow(2, retryCount)
        setSyncError(`Sync failed, retrying in ${delay/1000}s...`)
        
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current)
        }
        
        retryTimeoutRef.current = setTimeout(() => {
          syncWithRetry(retryCount + 1)
        }, delay)
      } else {
        setSyncStatus('error')
        setSyncError(errorMessage)
        await appendSyncEvent('sync-error', errorMessage, 'error')
      }
      
      return false
    } finally {
      isSyncing.current = false
    }
  }, [vault, masterKey, onPull])

  const sync = useCallback(() => syncWithRetry(0), [syncWithRetry])

  // Track last triggered sync version to prevent loops
  const lastTriggeredSyncVersionRef = useRef<number>(0)
  const lastSyncStatusRef = useRef(syncStatus)
  
  useEffect(() => {
    lastSyncStatusRef.current = syncStatus
  }, [syncStatus])
  
  // Initial sync and auto-sync on change
  useEffect(() => {
    if (syncStatus !== 'connected') return
    if (!vault) return
    // Prevent triggering sync multiple times for the same version
    if (vault.syncVersion === lastTriggeredSyncVersionRef.current) return
    lastTriggeredSyncVersionRef.current = vault.syncVersion
    sync()
  }, [syncStatus, vault?.syncVersion])  // Removed sync from deps to prevent loops

  useEffect(() => {
    const replay = async () => {
      if (!masterKey || !vault) return
      const queue = await getSyncOperationQueue()
      if (queue.length === 0) return
      await appendSyncEvent('sync-start', `Replaying ${queue.length} queued operations`)
      await syncWithRetry(0)
    }
    void replay()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterKey, vault?.syncVersion])  // syncWithRetry removed to prevent loops - function uses refs internally

  useEffect(() => {
    if (!masterKey) {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      setSyncStatus('disconnected')
      return
    }

    const connect = async () => {
      const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS)
      let settings: SyncSettings = {}
      if (result[STORAGE_KEYS.SETTINGS]?.encrypted) {
        settings = (await decryptSettings(masterKey, result[STORAGE_KEYS.SETTINGS].encrypted as EncryptedSettings)) || {}
      } else {
        settings = result[STORAGE_KEYS.SETTINGS] || {}
      }
      const { serverUrl, syncSecret } = settings

      if (!serverUrl || !syncSecret) return

      setSyncStatus('connecting')
      
      try {
        let url = serverUrl
        if (url.startsWith('http')) url = url.replace('http', 'ws')
        if (!url.endsWith('/api/sync')) url = `${url}/api/sync`

        const ws = new WebSocket(url)
        
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'auth', token: syncSecret, nonce: generateNonce() }))
        }

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data)
            
            if (msg.type === 'auth_success') {
              setSyncStatus('connected')
            } else if (msg.type === 'auth_failed') {
              setSyncStatus('error')
              ws.close()
            } else if (msg.type === 'vault_updated') {
              // Trigger sync when server notifies of update
              sync()
            }
          } catch (e) {
            console.error('Sync message error', e)
          }
        }

        ws.onerror = (e) => {
          console.error('Sync connection error', e)
          setSyncStatus('error')
        }

        ws.onclose = () => {
          if (syncStatus !== 'error') setSyncStatus('disconnected')
          wsRef.current = null
          
          setTimeout(() => {
            if (masterKey) {
              connect()
            }
          }, 5000)
        }
        
        wsRef.current = ws
      } catch (e) {
        console.error('Sync setup error', e)
        setSyncStatus('error')
        setSyncError('Failed to connect')
      }
    }

    connect()

    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [masterKey])

  useEffect(() => {
    const handleOnline = () => {
      setSyncStatus('connecting')
      syncWithRetry(0)
    }
    
    const handleOffline = () => {
      setSyncStatus('offline')
    }
    
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [syncWithRetry])

  return { syncStatus, lastSyncTime, syncError, sync }
}