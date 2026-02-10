// TypeScript interfaces for extension
import { Vault, VaultEntry } from '@lotus/shared'

export type { Vault, VaultEntry }

export interface ExtensionSettings {
  serverUrl: string
  autoLockTimeout: number
  theme: 'dark' | 'light' | 'system'
  biometricUnlock: boolean
}

export interface VaultState {
  isUnlocked: boolean
  lastSync: number | null
  error: string | null
}

export interface SyncStatus {
  status: 'idle' | 'syncing' | 'error' | 'offline'
  lastSyncedAt: number
  error?: string
}