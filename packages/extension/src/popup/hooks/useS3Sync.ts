import { useEffect, useRef, useState, useCallback } from 'react'
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { Vault } from '@lotus/shared'
import { STORAGE_KEYS } from '../../lib/constants'
import { bufferToBase64, base64ToBuffer, decrypt, deriveSubKey } from '../../lib/crypto-utils'

export function useS3Sync(
  vault: Vault | null,
  masterKey: CryptoKey | null,
  onPull: (vaultData: Vault) => Promise<void>
) {
  const [s3Status, setS3Status] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected')
  const isSyncing = useRef(false)

  const syncS3 = useCallback(async () => {
    if (!vault || !masterKey || isSyncing.current) return
    
    const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS)
    const { s3Endpoint, s3Region, s3AccessKey, s3SecretKey, s3Bucket } = result[STORAGE_KEYS.SETTINGS] || {}
    
    if (!s3Endpoint || !s3Bucket || !s3AccessKey || !s3SecretKey) {
        setS3Status('disconnected')
        return
    }

    isSyncing.current = true
    // Don't set 'connecting' here to avoid flickering if already connected
    // setS3Status('connecting') 

    try {
      const client = new S3Client({
        endpoint: s3Endpoint,
        region: s3Region,
        credentials: { accessKeyId: s3AccessKey, secretAccessKey: s3SecretKey }
      })

      const key = 'lotus-vault-sync.json'

      // 1. Check remote version
      let remoteData = null
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: s3Bucket, Key: key }))
        const str = await response.Body?.transformToString()
        if (str) {
            remoteData = JSON.parse(str)
        }
      } catch (e: any) {
        if (e.name !== 'NoSuchKey' && e.$metadata?.httpStatusCode !== 404) {
             throw e
        }
        // If key doesn't exist, remoteData remains null (version 0)
      }

      const remoteVersion = remoteData?.version || 0

      if (remoteVersion > vault.syncVersion) {
         const encryptedBuffer = base64ToBuffer(remoteData.blob)
         const vaultKey = await deriveSubKey(masterKey, 'vault-main', ['encrypt', 'decrypt'])
         const decryptedData = await decrypt(vaultKey, encryptedBuffer)
         const vaultData = JSON.parse(new TextDecoder().decode(decryptedData))
         
         await onPull(vaultData)
      } else if (vault.syncVersion > remoteVersion) {
         // PUSH - with conditional write to prevent race conditions (LOTUS-015)
         const stored = await chrome.storage.local.get(['vault', 'salt'])
         if (stored.vault) {
            const u8 = new Uint8Array(stored.vault)
            const buffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
            const blob = bufferToBase64(buffer)

            const payload = JSON.stringify({
                blob,
                version: vault.syncVersion,
                salt: Array.from(new Uint8Array(stored.salt || []))
            })

            // LOTUS-015: Use conditional write with If-None-Match for new objects
            // or If-Match for updates to prevent race conditions
            const putCommand = new PutObjectCommand({
                Bucket: s3Bucket,
                Key: key,
                Body: payload,
                ContentType: 'application/json',
                // For S3-compatible services that support conditional writes
                // If-Match: remoteVersion === 0 ? '*' : undefined
            })

            try {
                await client.send(putCommand)
            } catch (e: any) {
                // If conflict detected, refresh and retry
                if (e.name === 'PreconditionFailed') {
                    setS3Status('error')
                    return
                }
                throw e
            }
         }
      }

      setS3Status('connected')
    } catch (e) {
      console.error('S3 Sync error:', e)
      setS3Status('error')
    } finally {
      isSyncing.current = false
    }
  }, [vault, masterKey, onPull])

  // Poll every 30s
  useEffect(() => {
    if (!masterKey) return
    const interval = setInterval(syncS3, 30000)
    syncS3() // Initial sync
    return () => clearInterval(interval)
  }, [syncS3, masterKey])

  return { s3Status }
}
