import { decrypt, base64ToBuffer } from '../lib/crypto-utils'
import { getEntryNameMatchScore, getUrlMatchScore } from '../lib/url-match'

function getDomainMismatchLevel(storedUrl: string, currentUrl: string): 'none' | 'subdomain' | 'different' {
  try {
    const stored = new URL(storedUrl).hostname.toLowerCase()
    const current = new URL(currentUrl).hostname.toLowerCase()
    if (stored === current) return 'none'
    if (stored.endsWith('.' + current) || current.endsWith('.' + stored)) return 'subdomain'
    return 'different'
  } catch {
    return 'different'
  }
}
import { S3Client, GetObjectCommand, PutObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3"
import { appendSyncEvent } from '../lib/sync-observability'
import { appendExtensionError } from '../lib/error-log'

const LOCK_ALARM_NAME = 'lotus-auto-lock'
const S3_SYNC_ALARM_NAME = 'lotus-s3-sync'
const PASSKEY_STRATEGY_STATS_KEY = 'peach_passkey_strategy_stats'

self.addEventListener('error', (event) => {
  void appendExtensionError({
    source: 'background',
    category: 'runtime',
    message: event.message || 'Unknown service worker error',
    details: `${event.filename || 'unknown'}:${event.lineno || 0}:${event.colno || 0}`
  })
})

self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  const reason = event.reason
  void appendExtensionError({
    source: 'background',
    category: 'unhandledrejection',
    message: reason instanceof Error ? reason.message : String(reason || 'Unknown promise rejection'),
    details: reason instanceof Error ? reason.stack : undefined
  })
})

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

chrome.runtime.onInstalled.addListener(() => {})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LOCK_ALARM_NAME) {
    chrome.storage.session.remove(['autofillKey', 'autofillData', 'pendingSave'])
    chrome.action.setBadgeText({ text: '' })
    chrome.alarms.clear(S3_SYNC_ALARM_NAME)
    void appendSyncEvent('sync-queued', 'Auto-lock cleared active session')
  }

  if (alarm.name === S3_SYNC_ALARM_NAME) {
    void appendSyncEvent('sync-start', 'Background S3 alarm triggered')
    void syncS3EncryptedBlob()
  }
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SCHEDULE_LOCK') {
    const delayMs = message.delayMs || (5 * 60 * 1000)
    chrome.alarms.create(LOCK_ALARM_NAME, { delayInMinutes: delayMs / 60000 })
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'CLEAR_LOCK') {
    chrome.alarms.clear(LOCK_ALARM_NAME)
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'S3_SYNC_START') {
    chrome.alarms.create(S3_SYNC_ALARM_NAME, { periodInMinutes: 1 })
    void syncS3EncryptedBlob()
    void appendSyncEvent('sync-start', 'Enabled background S3 sync')
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'S3_SYNC_STOP') {
    chrome.alarms.clear(S3_SYNC_ALARM_NAME)
    void appendSyncEvent('sync-queued', 'Stopped background S3 sync')
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'S3_SYNC_NOW') {
    syncS3EncryptedBlob()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err?.message || 'S3 sync failed' }))
    return true
  }

  if (message.type === 'S3_SYNC_TEST') {
    testS3Connection((message.config || {}) as S3SessionConfig)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err?.message || 'S3 connection test failed' }))
    return true
  }

  if (message.type === 'LOCK_NOW') {
    chrome.storage.session.remove(['autofillKey', 'autofillData', 'pendingSave'])
    chrome.action.setBadgeText({ text: '' })
    chrome.alarms.clear(LOCK_ALARM_NAME)
    chrome.alarms.clear(S3_SYNC_ALARM_NAME)
    void appendSyncEvent('sync-queued', 'Vault locked, sync halted')
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'STORE_AUTOFILL_KEY') {
    chrome.storage.session.set({ autofillKey: message.key })
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'OPEN_POPUP') {
    if (!chrome.action.openPopup) {
      sendResponse({ success: false, error: 'openPopup not supported' })
      return true
    }
    chrome.action.openPopup()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err?.message || 'Failed to open popup' }))
    return true
  }

  if (message.type === 'MARK_AUTOFILL_USED') {
    const id = String(message.entryId || '')
    if (id) {
      chrome.storage.local.get('lotus_autofill_last_used').then((res) => {
        const map = (res.lotus_autofill_last_used as Record<string, number> | undefined) ?? {}
        map[id] = Date.now()
        return chrome.storage.local.set({ lotus_autofill_last_used: map })
      }).then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err?.message || 'Failed to update usage' }))
      return true
    }
    sendResponse({ success: false, error: 'Missing entryId' })
    return true
  }
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'REQUEST_CREDENTIALS') {
    handleGetCredentials(message.url)
      .then(sendResponse)
      .catch(err => {
        console.error('Autofill error:', err)
        void appendExtensionError({
          source: 'background',
          category: 'autofill-request',
          message: err?.message || 'Failed to resolve credentials',
          details: String(message.url || '')
        })
        sendResponse({ success: false, error: err.message })
      })
    return true
  }

  if (message.type === 'REQUEST_CREDENTIAL_COUNT') {
    handleGetCredentialCount(message.url)
      .then(sendResponse)
      .catch(err => {
        console.error('Autofill count error:', err)
        sendResponse({ success: false, error: err.message })
      })
    return true
  }

  if (message.type === 'REQUEST_PASSKEY_HINT') {
    getPreferredPasskeyStrategy(String(message.domain || ''))
      .then((preferredStrategy) => sendResponse({ success: true, preferredStrategy }))
      .catch((err) => sendResponse({ success: false, error: err?.message || 'Passkey hint failed' }))
    return true
  }

  if (message.type === 'REPORT_PASSKEY_TRIGGER_RESULT') {
    recordPasskeyStrategyResult(String(message.domain || ''), String(message.strategy || ''), !!message.success)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err?.message || 'Passkey telemetry failed' }))
    return true
  }

  if (message.type === 'PROMPT_SAVE') {
    const timestamp = Date.now()
    // Store pending save in session with timestamp
    chrome.storage.session.set({
      pendingSave: {
        ...message.data,
        _timestamp: timestamp
      }
    })
    // Set badge to indicate action needed
    chrome.action.setBadgeText({ text: '!' })
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' })

    // LOTUS-013: Auto-clear pending save after 5 minutes
    setTimeout(() => {
      chrome.storage.session.get('pendingSave').then((result) => {
        if (result.pendingSave?._timestamp === timestamp) {
          chrome.storage.session.remove('pendingSave')
          chrome.action.setBadgeText({ text: '' })
        }
      })
    }, 5 * 60 * 1000)

    return true
  }
})

async function handleGetCredentials(url: string) {
  try {
    const session = await chrome.storage.session.get(['autofillKey', 'autofillData'])
    if (!session.autofillKey) return { success: false, error: 'Vault locked' }

    const autofillKey = await crypto.subtle.importKey(
      'jwk',
      session.autofillKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    )

    if (!session.autofillData) return { success: false, error: 'No autofill data' }

    const local = await chrome.storage.local.get('lotus_autofill_last_used')
    const lastUsedMap = (local.lotus_autofill_last_used as Record<string, number> | undefined) ?? {}

    const NAME_MATCH_THRESHOLD = 70
    const credentials: Array<{
      entryId: string
      name?: string
      username: string
      password: string
      lastUsedAt?: number
      matchScore: number
      urls: string[]
      totp?: { secret: string; algorithm: 'SHA1' | 'SHA256' | 'SHA512'; digits: 6 | 8; period: number; issuer?: string }
    }> = []
    for (const item of session.autofillData) {
      const urls = Array.isArray(item.urls) ? item.urls as string[] : []
      let bestMatchScore = 0
      for (const storedUrl of urls) {
        const score = getUrlMatchScore(storedUrl, url)
        if (score > bestMatchScore) bestMatchScore = score
      }

      const iv = base64ToBuffer(item.iv)
      const ciphertext = base64ToBuffer(item.ciphertext)
      const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength)
      combined.set(new Uint8Array(iv), 0)
      combined.set(new Uint8Array(ciphertext), iv.byteLength)

      const decrypted = await decrypt(autofillKey, combined.buffer)
      const data = JSON.parse(new TextDecoder().decode(decrypted)) as {
        entryId?: string
        name?: string
        username?: string
        password?: string
        totp?: { secret: string; algorithm: 'SHA1' | 'SHA256' | 'SHA512'; digits: 6 | 8; period: number; issuer?: string }
      }

      const nameScore = data.name ? getEntryNameMatchScore(data.name, url) : 0
      const finalMatchScore = Math.max(bestMatchScore, nameScore)
      if (finalMatchScore <= 0 || (bestMatchScore <= 0 && nameScore < NAME_MATCH_THRESHOLD)) {
        continue
      }

      // Determine domain mismatch level
      let mismatchLevel: 'none' | 'subdomain' | 'different' = 'none'
      for (const storedUrl of urls) {
        const level = getDomainMismatchLevel(storedUrl, url)
        if (level === 'none') {
          mismatchLevel = 'none'
          break
        }
        if (level === 'different' && mismatchLevel !== 'different') {
          mismatchLevel = 'different'
        } else if (level === 'subdomain' && mismatchLevel === 'none') {
          mismatchLevel = 'subdomain'
        }
      }

      credentials.push({
        entryId: data.entryId || item.entryId || `${data.username || 'unknown'}-${credentials.length}`,
        name: data.name,
        username: data.username || '',
        password: data.password || '',
        lastUsedAt: data.entryId ? lastUsedMap[data.entryId] : undefined,
        matchScore: finalMatchScore,
        urls,
        totp: data.totp
      })
    }

    if (credentials.length === 0) {
      return { success: false, error: 'No credentials found' }
    }

    credentials.sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore
      return (b.lastUsedAt || 0) - (a.lastUsedAt || 0)
    })

    // Calculate domain mismatch for top credential
    const topCredential = credentials[0]
    let domainMismatch: 'none' | 'subdomain' | 'different' = 'none'
    for (const storedUrl of topCredential.urls) {
      const level = getDomainMismatchLevel(storedUrl, url)
      if (level === 'none') {
        domainMismatch = 'none'
        break
      }
      if (level === 'different') {
        domainMismatch = 'different'
      } else if (level === 'subdomain' && domainMismatch === 'none') {
        domainMismatch = 'subdomain'
      }
    }

    return {
      success: true,
      credentials: credentials.map((credential) => ({
        entryId: credential.entryId,
        name: credential.name,
        username: credential.username,
        password: credential.password,
        lastUsedAt: credential.lastUsedAt,
        totp: credential.totp
      })),
      domainMismatch
    }
  } catch (e) {
    return { success: false, error: 'Decryption failed' }
  }
}

async function getPreferredPasskeyStrategy(domain: string): Promise<string | null> {
  const normalizedDomain = domain.trim().toLowerCase()
  if (!normalizedDomain) return null
  const result = await chrome.storage.local.get([PASSKEY_STRATEGY_STATS_KEY])
  const allStats = (result[PASSKEY_STRATEGY_STATS_KEY] as Record<string, Record<string, number>> | undefined) ?? {}
  const domainStats = allStats[normalizedDomain]
  if (!domainStats) return null

  let bestStrategy: string | null = null
  let bestScore = -1
  for (const [strategy, count] of Object.entries(domainStats)) {
    if (typeof count !== 'number') continue
    if (count > bestScore) {
      bestScore = count
      bestStrategy = strategy
    }
  }
  return bestStrategy
}

async function recordPasskeyStrategyResult(domain: string, strategy: string, success: boolean): Promise<void> {
  if (!success) return
  const normalizedDomain = domain.trim().toLowerCase()
  const normalizedStrategy = strategy.trim()
  if (!normalizedDomain || !normalizedStrategy) return

  const result = await chrome.storage.local.get([PASSKEY_STRATEGY_STATS_KEY])
  const allStats = (result[PASSKEY_STRATEGY_STATS_KEY] as Record<string, Record<string, number>> | undefined) ?? {}
  const domainStats = { ...(allStats[normalizedDomain] || {}) }
  domainStats[normalizedStrategy] = (domainStats[normalizedStrategy] || 0) + 1
  allStats[normalizedDomain] = domainStats
  await chrome.storage.local.set({ [PASSKEY_STRATEGY_STATS_KEY]: allStats })
}

async function handleGetCredentialCount(url: string) {
  try {
    const session = await chrome.storage.session.get(['autofillKey', 'autofillData'])
    if (!session.autofillData || !Array.isArray(session.autofillData) || !session.autofillKey) {
      return { success: true, count: 0 }
    }

    const autofillKey = await crypto.subtle.importKey(
      'jwk',
      session.autofillKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    )
    const NAME_MATCH_THRESHOLD = 70
    let count = 0
    for (const item of session.autofillData) {
      const urlScore = Array.isArray(item.urls)
        ? item.urls.reduce((best: number, u: string) => Math.max(best, getUrlMatchScore(u, url)), 0)
        : 0
      if (urlScore > 0) {
        count += 1
        continue
      }

      const iv = base64ToBuffer(item.iv)
      const ciphertext = base64ToBuffer(item.ciphertext)
      const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength)
      combined.set(new Uint8Array(iv), 0)
      combined.set(new Uint8Array(ciphertext), iv.byteLength)
      const decrypted = await decrypt(autofillKey, combined.buffer)
      const data = JSON.parse(new TextDecoder().decode(decrypted)) as { name?: string }
      if (typeof data.name === 'string' && getEntryNameMatchScore(data.name, url) >= NAME_MATCH_THRESHOLD) {
        count += 1
      }
    }

    return { success: true, count }
  } catch (e) {
    return { success: false, error: 'Credential count failed' }
  }
}

interface S3SessionConfig {
  s3Endpoint?: string
  s3Region?: string
  s3AccessKey?: string
  s3SecretKey?: string
  s3Bucket?: string
}

function sanitizeS3Config(input: S3SessionConfig): S3SessionConfig {
  return {
    s3Endpoint: input.s3Endpoint?.trim(),
    s3Region: input.s3Region?.trim(),
    s3AccessKey: input.s3AccessKey?.trim(),
    s3SecretKey: input.s3SecretKey?.trim(),
    s3Bucket: input.s3Bucket?.trim()
  }
}

async function testS3Connection(config: S3SessionConfig): Promise<{ success: true } | { success: false; error: string }> {
  const cfg = sanitizeS3Config(config)
  if (!cfg.s3Endpoint || !cfg.s3Bucket || !cfg.s3AccessKey || !cfg.s3SecretKey) {
    return { success: false, error: 'Missing S3 endpoint, bucket, or credentials' }
  }

  try {
    const client = new S3Client({
      endpoint: cfg.s3Endpoint,
      region: cfg.s3Region || 'auto',
      forcePathStyle: true,
      credentials: {
        accessKeyId: cfg.s3AccessKey,
        secretAccessKey: cfg.s3SecretKey
      }
    })

    await client.send(new HeadBucketCommand({ Bucket: cfg.s3Bucket }))
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unable to connect to S3 bucket'
    }
  }
}

function parseRemoteEncryptedBlob(payload: unknown): { blob: string; version: number } | null {
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as { blob?: unknown; version?: unknown }
  if (typeof candidate.blob !== 'string') return null
  const version = typeof candidate.version === 'number' ? candidate.version : Number(candidate.version)
  if (!Number.isFinite(version)) return null
  return { blob: candidate.blob, version }
}

async function syncS3EncryptedBlob() {
  // LOTUS-004: Try to get decrypted S3 config from popup via message passing first
  let cfg: S3SessionConfig | null = null
  
  try {
    const response = await chrome.runtime.sendMessage({ type: 'REQUEST_S3_CREDENTIALS' })
    if (response?.success && response.config) {
      cfg = response.config as S3SessionConfig
    }
  } catch {
    // Popup not available, fall back to encrypted config
  }
  
  // LOTUS-007: No longer storing masterKeyRaw in session storage
  // If popup is not available and we don't have decrypted config, skip sync
  if (!cfg) {
    await appendSyncEvent('sync-queued', 'S3 sync skipped: vault locked, credentials not available')
    return
  }
  
  if (!cfg?.s3Endpoint || !cfg?.s3Bucket || !cfg?.s3AccessKey || !cfg?.s3SecretKey) return

  const local = await chrome.storage.local.get(['vault', 'vaultSyncVersion', 'salt'])
  if (!local.vault) return
  const localVersion = Number(local.vaultSyncVersion || 0)

  const client = new S3Client({
    endpoint: cfg.s3Endpoint.trim(),
    region: cfg.s3Region || 'auto',
    forcePathStyle: true,
    credentials: {
      accessKeyId: cfg.s3AccessKey,
      secretAccessKey: cfg.s3SecretKey
    }
  })

  const key = 'lotus-vault-sync.json'
  let remoteVersion = 0

  try {
    const response = await client.send(new GetObjectCommand({ Bucket: cfg.s3Bucket, Key: key }))
    const str = await response.Body?.transformToString()
    if (str) {
      const parsed = JSON.parse(str)
      const remote = parseRemoteEncryptedBlob(parsed)
      if (remote) {
        remoteVersion = remote.version
      } else {
        await appendSyncEvent('sync-queued', 'Background sync found legacy S3 object, replacing with encrypted blob', 'warning')
      }
    }
  } catch (e: any) {
    if (e?.name !== 'NoSuchKey' && e?.$metadata?.httpStatusCode !== 404) {
      throw e
    }
  }

  if (localVersion <= remoteVersion) return

  const vaultBytes = new Uint8Array(local.vault)
  const payload = JSON.stringify({
    blob: bytesToBase64(vaultBytes),
    version: localVersion,
    salt: Array.from(new Uint8Array(local.salt || [])),
    updatedAt: Date.now()
  })

  await client.send(new PutObjectCommand({
    Bucket: cfg.s3Bucket,
    Key: key,
    Body: payload,
    ContentType: 'application/json'
  }))
  await appendSyncEvent('sync-success', `Background S3 push v${localVersion}`)
}

interface AutofillEntryResponse {
  entryId: string
  name: string
  username: string
  iconUrl?: string
}

interface StoredAutofillData {
  entryId: string
  iv: string
  ciphertext: string
  urls: string[]
}

async function isVaultUnlocked(): Promise<boolean> {
  const session = await chrome.storage.session.get(['autofillKey'])
  return !!session.autofillKey
}

async function getAutofillData(): Promise<StoredAutofillData[]> {
  const session = await chrome.storage.session.get(['autofillData'])
  return session.autofillData || []
}

async function getMatchingEntriesForBadge(url: string): Promise<number> {
  try {
    if (!url.startsWith('http')) return 0
    
    const unlocked = await isVaultUnlocked()
    if (!unlocked) return 0
    
    const autofillData = await getAutofillData()
    if (!autofillData.length) return 0
    
    const autofillKey = await crypto.subtle.importKey(
      'jwk',
      (await chrome.storage.session.get(['autofillKey'])).autofillKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    )
    
    const NAME_MATCH_THRESHOLD = 70
    let count = 0
    
    for (const item of autofillData) {
      const urlScore = Array.isArray(item.urls)
        ? item.urls.reduce((best: number, u: string) => Math.max(best, getUrlMatchScore(u, url)), 0)
        : 0
      
      if (urlScore > 0) {
        count++
        continue
      }
      
      try {
        const iv = base64ToBuffer(item.iv)
        const ciphertext = base64ToBuffer(item.ciphertext)
        const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength)
        combined.set(new Uint8Array(iv), 0)
        combined.set(new Uint8Array(ciphertext), iv.byteLength)
        
        const decrypted = await decrypt(autofillKey, combined.buffer)
        const data = JSON.parse(new TextDecoder().decode(decrypted)) as { name?: string }
        
        if (typeof data.name === 'string' && getEntryNameMatchScore(data.name, url) >= NAME_MATCH_THRESHOLD) {
          count++
        }
      } catch {
        continue
      }
    }
    
    return count
  } catch {
    return 0
  }
}

async function updateBadgeForTab(tabId: number, url: string): Promise<void> {
  try {
    if (!url.startsWith('http')) {
      await chrome.action.setBadgeText({ text: '', tabId })
      return
    }
    
    const unlocked = await isVaultUnlocked()
    if (!unlocked) {
      await chrome.action.setBadgeText({ text: '', tabId })
      return
    }
    
    const count = await getMatchingEntriesForBadge(url)
    
    if (count > 0) {
      await chrome.action.setBadgeText({ text: count.toString(), tabId })
      await chrome.action.setBadgeBackgroundColor({ color: '#FF9A6C', tabId })
    } else {
      await chrome.action.setBadgeText({ text: '', tabId })
    }
  } catch (error) {
    console.error('Error updating badge:', error)
  }
}

async function updateAllTabBadges(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({})
    for (const tab of tabs) {
      if (tab.id && tab.url) {
        await updateBadgeForTab(tab.id, tab.url)
      }
    }
  } catch (error) {
    console.error('Error updating all tab badges:', error)
  }
}

async function clearAllBadges(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({})
    for (const tab of tabs) {
      if (tab.id) {
        await chrome.action.setBadgeText({ text: '', tabId: tab.id })
      }
    }
  } catch (error) {
    console.error('Error clearing badges:', error)
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    void updateBadgeForTab(tabId, tab.url)
  }
})

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId)
    if (tab.url) {
      await updateBadgeForTab(activeInfo.tabId, tab.url)
    }
  } catch (error) {
    console.error('Error handling tab activation:', error)
  }
})

async function handleGetAutofillEntries(url: string): Promise<{ success: boolean; entries?: AutofillEntryResponse[]; error?: string }> {
  try {
    const session = await chrome.storage.session.get(['autofillKey', 'autofillData'])
    if (!session.autofillKey) {
      return { success: false, error: 'Vault locked' }
    }
    
    if (!session.autofillData || !Array.isArray(session.autofillData)) {
      return { success: false, error: 'No autofill data' }
    }
    
    const autofillKey = await crypto.subtle.importKey(
      'jwk',
      session.autofillKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    )
    
    const entries: AutofillEntryResponse[] = []
    
    for (const item of session.autofillData as StoredAutofillData[]) {
      const urls = Array.isArray(item.urls) ? item.urls : []
      let bestMatchScore = 0
      
      for (const storedUrl of urls) {
        const score = getUrlMatchScore(storedUrl, url)
        if (score > bestMatchScore) bestMatchScore = score
      }
      
      if (bestMatchScore < 74) continue
      
      try {
        const iv = base64ToBuffer(item.iv)
        const ciphertext = base64ToBuffer(item.ciphertext)
        const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength)
        combined.set(new Uint8Array(iv), 0)
        combined.set(new Uint8Array(ciphertext), iv.byteLength)
        
        const decrypted = await decrypt(autofillKey, combined.buffer)
        const data = JSON.parse(new TextDecoder().decode(decrypted)) as {
          entryId?: string
          name?: string
          username?: string
        }
        
        entries.push({
          entryId: data.entryId || item.entryId,
          name: data.name || 'Unknown',
          username: data.username || ''
        })
      } catch {
        continue
      }
    }
    
    return { success: true, entries }
  } catch (error) {
    return { success: false, error: 'Failed to get entries' }
  }
}

async function handleGetAutofillCredentials(entryId: string): Promise<{ success: boolean; credentials?: { username: string; password: string }; error?: string }> {
  try {
    const session = await chrome.storage.session.get(['autofillKey', 'autofillData'])
    if (!session.autofillKey) {
      return { success: false, error: 'Vault locked' }
    }
    
    if (!session.autofillData || !Array.isArray(session.autofillData)) {
      return { success: false, error: 'No autofill data' }
    }
    
    const autofillKey = await crypto.subtle.importKey(
      'jwk',
      session.autofillKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    )
    
    for (const item of session.autofillData as StoredAutofillData[]) {
      try {
        const iv = base64ToBuffer(item.iv)
        const ciphertext = base64ToBuffer(item.ciphertext)
        const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength)
        combined.set(new Uint8Array(iv), 0)
        combined.set(new Uint8Array(ciphertext), iv.byteLength)
        
        const decrypted = await decrypt(autofillKey, combined.buffer)
        const data = JSON.parse(new TextDecoder().decode(decrypted)) as {
          entryId?: string
          username?: string
          password?: string
        }
        
        if (data.entryId === entryId || item.entryId === entryId) {
          return {
            success: true,
            credentials: {
              username: data.username || '',
              password: data.password || ''
            }
          }
        }
      } catch {
        continue
      }
    }
    
    return { success: false, error: 'Entry not found' }
  } catch (error) {
    return { success: false, error: 'Failed to get credentials' }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'AUTOFILL_GET_ENTRIES') {
    const url = message.payload?.url
    if (!url) {
      sendResponse({ success: false, error: 'No URL provided' })
      return true
    }
    
    handleGetAutofillEntries(url)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err?.message || 'Failed to get entries' }))
    return true
  }
  
  if (message.type === 'AUTOFILL_FILL') {
    const entryId = message.payload?.entryId
    if (!entryId) {
      sendResponse({ success: false, error: 'No entryId provided' })
      return true
    }
    
    handleGetAutofillCredentials(entryId)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err?.message || 'Failed to get credentials' }))
    return true
  }
  
  if (message.type === 'AUTOFILL_PAGE_LOADED') {
    const tabId = sender.tab?.id
    const url = message.payload?.url || sender.tab?.url
    
    if (tabId && url) {
      void updateBadgeForTab(tabId, url)
    }
    
    sendResponse({ success: true })
    return false
  }
  
  if (message.type === 'VAULT_UNLOCKED') {
    void updateAllTabBadges()
    sendResponse({ success: true })
    return false
  }
  
  if (message.type === 'VAULT_LOCKED') {
    void clearAllBadges()
    sendResponse({ success: true })
    return false
  }
  
  return false
})
