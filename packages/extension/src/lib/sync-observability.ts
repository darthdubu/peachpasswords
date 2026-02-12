import type { SyncEvent, SyncEventType } from './sync-types'

const SYNC_TIMELINE_KEY = 'lotus_sync_timeline'
const SYNC_TIMELINE_MAX = 120

export async function appendSyncEvent(
  type: SyncEventType,
  detail: string,
  status: 'info' | 'warning' | 'error' = 'info'
) {
  const result = await chrome.storage.local.get(SYNC_TIMELINE_KEY)
  const timeline = (result[SYNC_TIMELINE_KEY] as SyncEvent[] | undefined) ?? []
  const event: SyncEvent = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    type,
    status,
    detail
  }
  const next = [event, ...timeline].slice(0, SYNC_TIMELINE_MAX)
  await chrome.storage.local.set({ [SYNC_TIMELINE_KEY]: next })
}

export async function readSyncTimeline(): Promise<SyncEvent[]> {
  const result = await chrome.storage.local.get(SYNC_TIMELINE_KEY)
  return (result[SYNC_TIMELINE_KEY] as SyncEvent[] | undefined) ?? []
}
