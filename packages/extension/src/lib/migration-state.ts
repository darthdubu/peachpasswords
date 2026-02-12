const MIGRATION_STATE_KEY = 'lotus_migration_state'
const MIGRATION_VERSION_KEY = 'lotus_migration_version'
const MIGRATION_BACKUP_KEY = 'lotus_vault_backup'
const MIGRATION_BACKUP_AAD_KEY = 'lotus_vault_backup_aad'
const MIGRATION_BACKUP_SYNC_VERSION_KEY = 'lotus_vault_backup_sync_version'

export type MigrationState = 'normal' | 'migrating' | 'rolling_back'

export interface MigrationSnapshot {
  state: MigrationState
  targetVersion: number
  backupVault?: number[]
  backupAad?: string
  backupSyncVersion?: number
}

export async function getMigrationSnapshot(): Promise<MigrationSnapshot> {
  const result = await chrome.storage.local.get([
    MIGRATION_STATE_KEY,
    MIGRATION_VERSION_KEY,
    MIGRATION_BACKUP_KEY,
    MIGRATION_BACKUP_AAD_KEY,
    MIGRATION_BACKUP_SYNC_VERSION_KEY
  ])

  return {
    state: (result[MIGRATION_STATE_KEY] as MigrationState | undefined) || 'normal',
    targetVersion: Number(result[MIGRATION_VERSION_KEY] || 0),
    backupVault: result[MIGRATION_BACKUP_KEY] as number[] | undefined,
    backupAad: result[MIGRATION_BACKUP_AAD_KEY] as string | undefined,
    backupSyncVersion: result[MIGRATION_BACKUP_SYNC_VERSION_KEY] as number | undefined
  }
}

export async function beginMigration(targetVersion: number, backup?: { vault?: number[]; aad?: string; syncVersion?: number }) {
  await chrome.storage.local.set({
    [MIGRATION_STATE_KEY]: 'migrating',
    [MIGRATION_VERSION_KEY]: targetVersion,
    [MIGRATION_BACKUP_KEY]: backup?.vault,
    [MIGRATION_BACKUP_AAD_KEY]: backup?.aad,
    [MIGRATION_BACKUP_SYNC_VERSION_KEY]: backup?.syncVersion
  })
}

export async function completeMigration() {
  await chrome.storage.local.set({
    [MIGRATION_STATE_KEY]: 'normal',
    [MIGRATION_VERSION_KEY]: 0
  })
  await chrome.storage.local.remove([
    MIGRATION_BACKUP_KEY,
    MIGRATION_BACKUP_AAD_KEY,
    MIGRATION_BACKUP_SYNC_VERSION_KEY
  ])
}

export async function setRollingBack() {
  await chrome.storage.local.set({ [MIGRATION_STATE_KEY]: 'rolling_back' })
}
