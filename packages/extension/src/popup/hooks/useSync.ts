import { useEffect, useRef, useState, useCallback } from 'react'
import { Vault } from '@lotus/shared'
import { STORAGE_KEYS } from '../../lib/constants'
import { bufferToBase64, base64ToBuffer, decrypt, deriveSubKey, decryptSettings, EncryptedSettings } from '../../lib/crypto-utils'

// LOTUS-018: Generate nonce for replay protection
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

export function useSync(
  vault: Vault | null, 
  masterKey: CryptoKey | null,
  onPull: (vaultData: Vault) => Promise<void>
) {
  const wsRef = useRef<WebSocket | null>(null)
  const [syncStatus, setSyncStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected')
  const isSyncing = useRef(false)

  const sync = useCallback(async () => {
    if (!vault || !masterKey || isSyncing.current) return

    const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS)
    let settings: SyncSettings = {}

    if (result[STORAGE_KEYS.SETTINGS]?.encrypted) {
      const decrypted = await decryptSettings(masterKey, result[STORAGE_KEYS.SETTINGS].encrypted as EncryptedSettings)
      settings = decrypted || {}
    } else {
      settings = result[STORAGE_KEYS.SETTINGS] || {}
    }

    const { serverUrl, syncSecret } = settings
    if (!serverUrl || !syncSecret) return

    let httpUrl = serverUrl
    if (httpUrl.startsWith('ws')) httpUrl = httpUrl.replace('ws', 'http')
    if (httpUrl.endsWith('/api/sync')) httpUrl = httpUrl.replace('/api/sync', '')

    isSyncing.current = true
    try {
      // 1. Check server version
      const nonce = generateNonce()
      const versionRes = await fetch(`${httpUrl}/api/vault/version`, {
        headers: {
          'X-Lotus-Secret': syncSecret,
          'X-Request-Nonce': nonce
        }
      })
      if (!versionRes.ok) throw new Error('Failed to fetch version')
      
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
        
        // Decrypt
        const encryptedBuffer = base64ToBuffer(blob)
        const vaultKey = await deriveSubKey(masterKey, 'vault-main', ['encrypt', 'decrypt'])
        const decryptedData = await decrypt(vaultKey, encryptedBuffer)
        const vaultData = JSON.parse(new TextDecoder().decode(decryptedData))
        
        await onPull(vaultData)
      } else if (vault.syncVersion > serverVersion) {
        const stored = await chrome.storage.local.get(['vault'])
        if (stored.vault) {
           const u8 = new Uint8Array(stored.vault)
           // Create a copy of the buffer to ensure we have an ArrayBuffer
           const buffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
           const blob = bufferToBase64(buffer)
           
            await fetch(`${httpUrl}/api/vault`, {
               method: 'PUT',
               headers: {
                 'Content-Type': 'application/json',
                 'X-Lotus-Secret': syncSecret,
                 'X-Request-Nonce': generateNonce()
               },
               body: JSON.stringify({ blob, version: vault.syncVersion })
             })
        }
      }
    } catch (e) {
      console.error('Sync error:', e)
      setSyncStatus('error')
    } finally {
      isSyncing.current = false
    }
  }, [vault, masterKey, onPull])

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
        }
        
        wsRef.current = ws
      } catch (e) {
        console.error('Sync setup error', e)
        setSyncStatus('error')
      }
    }

    connect()

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [masterKey]) // Only reconnect if masterKey changes (unlock/lock)

  return { syncStatus }
}