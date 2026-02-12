import { useEffect, useRef, useState, useCallback } from 'react'
import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { Vault } from '@lotus/shared'
import { STORAGE_KEYS } from '../../lib/constants'
import { bufferToBase64, base64ToBuffer, decrypt, deriveSubKey, decryptSettings, EncryptedSettings, unpadVaultPlaintext } from '../../lib/crypto-utils'
import { appendSyncEvent } from '../../lib/sync-observability'
import { threeWayMerge } from '../../lib/three-way-merge'
import { appendUnresolvedConflicts } from '../../lib/sync-conflicts'
import { logSecurityEvent } from '../../lib/security-events'

interface S3Settings {
  s3Endpoint?: string
  s3Region?: string
  s3AccessKey?: string
  s3SecretKey?: string
  s3Bucket?: string
}

function parseRemoteEncryptedBlob(payload: unknown): { blob: string; version: number } | null {
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as { blob?: unknown; version?: unknown; _pad?: unknown }
  if (typeof candidate.blob !== 'string') return null
  const version = typeof candidate.version === 'number' ? candidate.version : Number(candidate.version)
  if (!Number.isFinite(version)) return null
  return { blob: candidate.blob, version }
}

function padPayload(payload: string): string {
  const targetSize = Math.ceil(payload.length / 1024) * 1024
  if (targetSize === payload.length) return payload
  // Add padding as a JSON field that gets ignored on parse
  const paddingLength = targetSize - payload.length - 6 // account for JSON overhead
  if (paddingLength > 0) {
    const padding = 'A'.repeat(paddingLength)
    return payload.slice(0, -1) + `,"_pad":"${padding}"}`
  }
  return payload
}

export function useS3Sync(
  vault: Vault | null,
  masterKey: CryptoKey | null,
  onPull: (vaultData: Vault) => Promise<void>
) {
  const [s3Status, setS3Status] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected')
  const [s3LastSyncTime, setS3LastSyncTime] = useState<number | null>(null)
  const [s3IsSyncing, setS3IsSyncing] = useState(false)
  const isSyncing = useRef(false)
  const lastPulledVersionRef = useRef<number>(0)
  const lastPushedVersionRef = useRef<number>(-1)
  const lastRemoteEtagRef = useRef<string | null>(null)
  const lastRemoteVersionRef = useRef<number>(0)
  const vaultRef = useRef<Vault | null>(vault)
  const masterKeyRef = useRef<CryptoKey | null>(masterKey)
  const onPullRef = useRef(onPull)
  // Use refs for status to avoid dependency cycles
  const s3StatusRef = useRef(s3Status)

  useEffect(() => {
    vaultRef.current = vault
  }, [vault])

  useEffect(() => {
    masterKeyRef.current = masterKey
  }, [masterKey])

  useEffect(() => {
    onPullRef.current = onPull
  }, [onPull])

  useEffect(() => {
    s3StatusRef.current = s3Status
  }, [s3Status])

  const syncS3 = useCallback(async (trigger: 'local-change' | 'remote-check' = 'remote-check') => {
    const currentVault = vaultRef.current
    const currentMasterKey = masterKeyRef.current
    if (!currentVault || !currentMasterKey || isSyncing.current) return

    const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS)
    let settings: S3Settings = {}

    if (result[STORAGE_KEYS.SETTINGS]?.encrypted) {
      const decrypted = await decryptSettings(currentMasterKey, result[STORAGE_KEYS.SETTINGS].encrypted as EncryptedSettings)
      settings = decrypted || {}
    } else {
      settings = result[STORAGE_KEYS.SETTINGS] || {}
    }

    const { s3Endpoint, s3Region, s3AccessKey, s3SecretKey, s3Bucket } = settings

    if (!s3Endpoint || !s3Bucket || !s3AccessKey || !s3SecretKey) {
      setS3Status('disconnected')
      return
    }

    if (trigger === 'local-change' && currentVault.syncVersion <= lastPushedVersionRef.current) {
      // No local changes since our last successful push.
      return
    }

    isSyncing.current = true
    setS3IsSyncing(true)
    const currentS3Status = s3StatusRef.current
    if (currentS3Status === 'disconnected' || currentS3Status === 'error') {
      setS3Status('connecting')
    }

    try {
      const client = new S3Client({
        endpoint: s3Endpoint.trim(),
        region: s3Region || 'auto',
        forcePathStyle: true,
        credentials: { accessKeyId: s3AccessKey, secretAccessKey: s3SecretKey }
      })

      const key = 'lotus-vault-sync.json'

      // 1) Detect if remote object changed since last check.
      let remoteEtag: string | null = null
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: s3Bucket, Key: key }))
        remoteEtag = typeof head.ETag === 'string' ? head.ETag.replace(/"/g, '') : null
      } catch (e: unknown) {
        const err = e as { name?: string; $metadata?: { httpStatusCode?: number } }
        if (err.name !== 'NotFound' && err.$metadata?.httpStatusCode !== 404 && err.name !== 'NoSuchKey') {
          throw e
        }
      }

      const shouldFetchRemote =
        trigger === 'local-change' ||
        !!remoteEtag && remoteEtag !== lastRemoteEtagRef.current ||
        (remoteEtag === null && lastRemoteEtagRef.current !== null)

      let remoteData: { blob: string; version: number } | null = null
      if (shouldFetchRemote) {
        try {
          const response = await client.send(new GetObjectCommand({ Bucket: s3Bucket, Key: key }))
          const str = await response.Body?.transformToString()
          if (str) {
            const parsed = JSON.parse(str)
            remoteData = parseRemoteEncryptedBlob(parsed)
            if (!remoteData) {
              await appendSyncEvent('sync-queued', 'S3 object is legacy/plain format; replacing with encrypted blob', 'warning')
            }
          }
        } catch (e: unknown) {
          const err = e as { name?: string; $metadata?: { httpStatusCode?: number } }
          if (err.name !== 'NoSuchKey' && err.$metadata?.httpStatusCode !== 404 && err.name !== 'NotFound') {
            throw e
          }
        }
      }

      const remoteVersion = remoteData?.version ?? lastRemoteVersionRef.current
      if (remoteData) {
        lastRemoteVersionRef.current = remoteVersion
      }
      lastRemoteEtagRef.current = remoteEtag

      let actionTaken = false
      if (remoteData && remoteVersion > currentVault.syncVersion) {
        if (lastPulledVersionRef.current === remoteVersion) {
          setS3Status('connected')
          setS3LastSyncTime(Date.now())
          return
        }
        lastPulledVersionRef.current = remoteVersion
        const encryptedBuffer = base64ToBuffer(remoteData.blob)
        const vaultKey = await deriveSubKey(currentMasterKey, 'vault-main', ['encrypt', 'decrypt'])
        const decryptedData = await decrypt(vaultKey, encryptedBuffer)
        const unpaddedData = unpadVaultPlaintext(new Uint8Array(decryptedData))
        const vaultData = JSON.parse(new TextDecoder().decode(unpaddedData))

        await onPullRef.current(vaultData)
        await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_BASE]: vaultData })
        await appendSyncEvent('sync-pull', `Pulled S3 v${remoteVersion}`)
        actionTaken = true
      } else if (currentVault.syncVersion > remoteVersion) {
        // PUSH only when local changed since last successful push.
        if (currentVault.syncVersion > lastPushedVersionRef.current) {
          const stored = await chrome.storage.local.get(['vault', 'salt'])
          if (stored.vault) {
            const u8 = new Uint8Array(stored.vault)
            const buffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
            const blob = bufferToBase64(buffer)

            const payload = padPayload(JSON.stringify({
              blob,
              version: currentVault.syncVersion,
              salt: Array.from(new Uint8Array(stored.salt || []))
            }))

            const putCommand = new PutObjectCommand({
              Bucket: s3Bucket,
              Key: key,
              Body: payload,
              ContentType: 'application/octet-stream'
            })

            try {
              await client.send(putCommand)
              lastPushedVersionRef.current = currentVault.syncVersion
              await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_BASE]: currentVault })
              await appendSyncEvent('sync-push', `Pushed S3 v${currentVault.syncVersion}`)
              actionTaken = true
            } catch (e: unknown) {
              const err = e as { name?: string }
              // If conflict detected, refresh and retry
              if (err.name === 'PreconditionFailed') {
                if (remoteData?.blob) {
                  const vaultKey = await deriveSubKey(currentMasterKey, 'vault-main', ['encrypt', 'decrypt'])
                  const decryptedData = await decrypt(vaultKey, base64ToBuffer(remoteData.blob))
                  const remoteVault = JSON.parse(new TextDecoder().decode(decryptedData)) as Vault
                  const baseResult = await chrome.storage.local.get(STORAGE_KEYS.SYNC_BASE)
                  const baseVault = (baseResult[STORAGE_KEYS.SYNC_BASE] as Vault | undefined) ?? currentVault
                  const merged = await threeWayMerge(currentVault, remoteVault, baseVault)
                  await onPullRef.current(merged.vault)
                  await appendSyncEvent('sync-merge', `Merged with S3 (${merged.conflicts.length} conflicts)`, merged.conflicts.length ? 'warning' : 'info')
                  if (merged.conflicts.length > 0) {
                    await appendUnresolvedConflicts('s3', merged.conflicts)
                    await appendSyncEvent('sync-conflict', `${merged.conflicts.length} unresolved S3 conflicts`, 'warning')
                  }
                  actionTaken = true
                }
                return
              }
              throw e
            }
          }
        }
      }

      setS3Status('connected')
      setS3LastSyncTime(Date.now())
      if (actionTaken) {
        await appendSyncEvent('sync-success', 'S3 sync completed')
      }
    } catch (e) {
      console.error('S3 Sync error:', e)
      setS3Status('error')
      const isStackOverflow = e instanceof RangeError || (e instanceof Error && /maximum call stack/i.test(e.message))
      const detail = isStackOverflow
        ? 'S3 sync hit a stack overflow; sync loop guard triggered'
        : (e instanceof Error ? e.message : 'S3 sync failed')
      await appendSyncEvent('sync-error', detail, 'error')
      await logSecurityEvent('s3-sync-failure', 'error', {
        error: detail,
        isStackOverflow
      })
    } finally {
      isSyncing.current = false
      setS3IsSyncing(false)
    }
  }, [])  // Empty deps - uses refs for all mutable values

  // Push quickly on local vault changes.
  // Use a ref to track last synced version to prevent loops
  const lastTriggeredVersionRef = useRef<number>(0)
  useEffect(() => {
    if (!masterKey || !vault) return
    // Only trigger if syncVersion changed since last trigger
    if (vault.syncVersion === lastTriggeredVersionRef.current) return
    lastTriggeredVersionRef.current = vault.syncVersion
    void syncS3('local-change')
  }, [masterKey, vault?.syncVersion])

  // Lightweight periodic check for remote changes (e.g., updates from phone).
  useEffect(() => {
    if (!masterKey) return
    const interval = setInterval(() => {
      void syncS3('remote-check')
    }, 90000)
    void syncS3('remote-check') // Initial remote check
    return () => clearInterval(interval)
  }, [masterKey])  // Remove syncS3 from deps to prevent recreating interval

  return { s3Status, s3LastSyncTime, s3IsSyncing }
}
