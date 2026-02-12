import { beforeEach, describe, expect, it } from 'vitest'
import { beginMigration, completeMigration, getMigrationSnapshot } from './migration-state'
import { CURRENT_VAULT_SCHEMA_VERSION, migrateVaultWithRecovery, recoverIncompleteMigration } from './migration'
import type { Vault } from '@lotus/shared'

const storage: Record<string, unknown> = {}

describe('migration safety', () => {
  beforeEach(() => {
    for (const key of Object.keys(storage)) delete storage[key]

    ;(chrome.storage.local.get as any).mockImplementation(async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys]
      const result: Record<string, unknown> = {}
      for (const key of list) result[key] = storage[key]
      return result
    })
    ;(chrome.storage.local.set as any).mockImplementation(async (items: Record<string, unknown>) => {
      Object.assign(storage, items)
    })
    ;(chrome.storage.local.remove as any).mockImplementation(async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys]
      for (const key of list) delete storage[key]
    })
  })

  it('migrates legacy vault to current schema', async () => {
    const legacy: Vault = {
      version: 1,
      entries: [],
      folders: [],
      lastSync: Date.now(),
      syncVersion: 3
    }
    const migrated = await migrateVaultWithRecovery(legacy, {})
    expect(migrated.version).toBe(CURRENT_VAULT_SCHEMA_VERSION)
  })

  it('restores backup after interrupted migration', async () => {
    await beginMigration(2, { vault: [1, 2, 3], aad: 'vault:1:1', syncVersion: 1 })
    const recovered = await recoverIncompleteMigration()
    expect(recovered.restored).toBe(true)
    expect(recovered.vault).toEqual([1, 2, 3])
    const snapshot = await getMigrationSnapshot()
    expect(snapshot.state).toBe('normal')
  })

  it('clears backup state on completion', async () => {
    await beginMigration(2, { vault: [9], aad: 'x', syncVersion: 2 })
    await completeMigration()
    const snapshot = await getMigrationSnapshot()
    expect(snapshot.backupVault).toBeUndefined()
  })
})
