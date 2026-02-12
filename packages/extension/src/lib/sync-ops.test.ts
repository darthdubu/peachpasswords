import { beforeEach, describe, expect, it } from 'vitest'
import { enqueueSyncOperation, getSyncOperationQueue, clearSyncOperationQueue } from './sync-ops'

const storage: Record<string, unknown> = {}

describe('sync operation queue', () => {
  beforeEach(() => {
    for (const key of Object.keys(storage)) delete storage[key]
    ;(chrome.storage.local.get as any).mockImplementation(async (keys: string) => ({ [keys]: storage[keys] }))
    ;(chrome.storage.local.set as any).mockImplementation(async (items: Record<string, unknown>) => {
      Object.assign(storage, items)
    })
    ;(chrome.storage.local.remove as any).mockImplementation(async (key: string) => {
      delete storage[key]
    })
  })

  it('stores operations in deterministic sequence order', async () => {
    await enqueueSyncOperation({ kind: 'entry-upsert', entityId: 'a' })
    await enqueueSyncOperation({ kind: 'entry-delete', entityId: 'b' })
    const queue = await getSyncOperationQueue()
    expect(queue).toHaveLength(2)
    expect(queue[0].seq).toBe(1)
    expect(queue[1].seq).toBe(2)
  })

  it('clears queue content', async () => {
    await enqueueSyncOperation({ kind: 'vault-write' })
    await clearSyncOperationQueue()
    const queue = await getSyncOperationQueue()
    expect(queue).toHaveLength(0)
  })
})
