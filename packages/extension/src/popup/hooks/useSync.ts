import { useEffect, useRef, useState, useCallback } from 'react'
import { Vault } from '@lotus/shared'
import { STORAGE_KEYS } from '../../lib/constants'
import { bufferToBase64, base64ToBuffer, decrypt, deriveSubKey, decryptSettings, EncryptedSettings } from '../../lib/crypto-utils'

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

interface QueuedOperation {
  type: 'push' | 'pull'
  timestamp: number
  retryCount: number
}

const MAX_RETRIES = 3
const RETRY_DELAY_BASE = 1000
const OFFLINE_QUEUE_KEY = 'lotus-sync-queue'

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
  const offlineQueue = useRef<QueuedOperation[]>([])

  useEffect(() => {
    chrome.storage.local.get(OFFLINE_QUEUE_KEY).then(result => {
      if (result[OFFLINE_QUEUE_KEY]) {
        offlineQueue.current = result[OFFLINE_QUEUE_KEY]
      }
    })
  }, [])

  const saveQueue = useCallback(async () => {
    await chrome.storage.local.set({ [OFFLINE_QUEUE_KEY]: offlineQueue.current })
  }, [])

  const processOfflineQueue = useCallback(async () => {
    if (offlineQueue.current.length === 0) return
    
    const queue = [...offlineQueue.current]
    offlineQueue.current = []
    await saveQueue()
    
    for (const op of queue) {
      if (op.type === 'push') {
        await syncWithRetry()
      }
    }
  }, [])

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
    
    try {
      if (!navigator.onLine) {
        setSyncStatus('offline')
        offlineQueue.current.push({ type: 'push', timestamp: Date.now(), retryCount: 0 })
        await saveQueue()
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
        
        const { blob } = await vaultRes.json()
        
        const encryptedBuffer = base64ToBuffer(blob)
        const vaultKey = await deriveSubKey(masterKey, 'vault-main', ['encrypt', 'decrypt'])
        const decryptedData = await decrypt(vaultKey, encryptedBuffer)
        const vaultData = JSON.parse(new TextDecoder().decode(decryptedData))
        
        await onPull(vaultData)
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
               throw new Error(`Push failed: ${pushRes.status}`)
             }
        }
      }
      
      setLastSyncTime(Date.now())
      setSyncStatus('connected')
      setSyncError(null)
      
      await processOfflineQueue()
      
      return true
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Sync failed'
      console.error('Sync error:', e)
      
      if (!navigator.onLine || errorMessage.includes('fetch') || errorMessage.includes('network')) {
        setSyncStatus('offline')
        setSyncError('Working offline - changes will sync when connection is restored')
        
        offlineQueue.current.push({ type: 'push', timestamp: Date.now(), retryCount })
        await saveQueue()
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
      }
      
      return false
    } finally {
      isSyncing.current = false
    }
  }, [vault, masterKey, onPull, processOfflineQueue, saveQueue])

  const sync = useCallback(() => syncWithRetry(0), [syncWithRetry])

  // Initial sync and auto-sync on change
  useEffect(() => {
    if (syncStatus === 'connected') {
      sync()
    }
  }, [syncStatus, vault?.syncVersion, sync])

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
      const { serverUrl, syncSecret } = result[STORAGE_KEYS.SETTINGS] || {}

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