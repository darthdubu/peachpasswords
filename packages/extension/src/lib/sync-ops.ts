import type { SyncOperation } from './sync-types'

const SYNC_OP_QUEUE_KEY = 'lotus_sync_op_queue'

export async function enqueueSyncOperation(operation: Omit<SyncOperation, 'id' | 'queuedAt' | 'seq'>) {
  const result = await chrome.storage.local.get(SYNC_OP_QUEUE_KEY)
  const queue = (result[SYNC_OP_QUEUE_KEY] as SyncOperation[] | undefined) ?? []
  const nextSeq = queue.length ? Math.max(...queue.map((q) => q.seq)) + 1 : 1
  const next: SyncOperation = {
    id: crypto.randomUUID(),
    queuedAt: Date.now(),
    seq: nextSeq,
    ...operation
  }
  await chrome.storage.local.set({ [SYNC_OP_QUEUE_KEY]: [...queue, next] })
}

export async function getSyncOperationQueue(): Promise<SyncOperation[]> {
  const result = await chrome.storage.local.get(SYNC_OP_QUEUE_KEY)
  return ((result[SYNC_OP_QUEUE_KEY] as SyncOperation[] | undefined) ?? []).sort((a, b) => a.seq - b.seq)
}

export async function clearSyncOperationQueue() {
  await chrome.storage.local.remove(SYNC_OP_QUEUE_KEY)
}
