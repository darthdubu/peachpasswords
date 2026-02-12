import type { VaultEntry } from '@lotus/shared'
import { STORAGE_KEYS } from './constants'
import { logSecurityEvent } from './security-events'

export type SyncConflictSource = 'server' | 's3'

export interface SyncConflictRecord {
  id: string
  timestamp: number
  source: SyncConflictSource
  entryId: string
  localEntry: VaultEntry | null
  remoteEntry: VaultEntry | null
  baseEntry: VaultEntry | null
}

const MAX_CONFLICTS = 200

export async function readUnresolvedConflicts(): Promise<SyncConflictRecord[]> {
  const result = await chrome.storage.local.get([STORAGE_KEYS.SYNC_CONFLICTS])
  const value = result[STORAGE_KEYS.SYNC_CONFLICTS]
  if (!Array.isArray(value)) return []
  return value as SyncConflictRecord[]
}

export async function appendUnresolvedConflicts(
  source: SyncConflictSource,
  conflicts: Array<{
    entryId: string
    localEntry: VaultEntry | null
    remoteEntry: VaultEntry | null
    baseEntry: VaultEntry | null
  }>
): Promise<void> {
  if (conflicts.length === 0) return
  const existing = await readUnresolvedConflicts()
  const nextMap = new Map<string, SyncConflictRecord>()
  for (const record of existing) {
    nextMap.set(`${record.source}:${record.entryId}`, record)
  }
  const now = Date.now()
  for (const conflict of conflicts) {
    const key = `${source}:${conflict.entryId}`
    nextMap.set(key, {
      id: crypto.randomUUID(),
      timestamp: now,
      source,
      entryId: conflict.entryId,
      localEntry: conflict.localEntry,
      remoteEntry: conflict.remoteEntry,
      baseEntry: conflict.baseEntry
    })
  }
  const next = Array.from(nextMap.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_CONFLICTS)
  await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_CONFLICTS]: next })
  
  // Log security events for sync conflicts
  for (const conflict of conflicts) {
    await logSecurityEvent('sync-conflict-detected', 'warning', {
      entryId: conflict.entryId,
      source,
      hasLocalEntry: !!conflict.localEntry,
      hasRemoteEntry: !!conflict.remoteEntry,
      hasBaseEntry: !!conflict.baseEntry
    })
  }
}

export async function clearUnresolvedConflicts(entryIds?: string[]): Promise<void> {
  if (!entryIds || entryIds.length === 0) {
    await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_CONFLICTS]: [] })
    return
  }
  const existing = await readUnresolvedConflicts()
  const idSet = new Set(entryIds)
  const filtered = existing.filter((record) => !idSet.has(record.entryId))
  await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_CONFLICTS]: filtered })
  
  // Log security events for resolved conflicts
  for (const entryId of entryIds) {
    await logSecurityEvent('sync-conflict-resolved', 'info', { entryId })
  }
}
