// Constants for Peach extension

export const DEFAULT_IDLE_TIMEOUT = 5 * 60 * 1000 // 5 minutes default
export const CLIPBOARD_CLEAR_TIMEOUT = 30 * 1000 // 30 seconds
export const SYNC_INTERVAL = 60 * 1000 // 1 minute
export const BACKUP_INTERVAL = 6 * 60 * 60 * 1000 // 6 hours

export const STORAGE_KEYS = {
  VAULT: 'peach_vault',
  SETTINGS: 'peach_settings',
  AUTO_COPY_TOTP: 'peach_auto_copy_totp',
  AUTH_TOKEN: 'peach_auth_token',
  SYNC_STATE: 'peach_sync_state',
  SYNC_QUEUE: 'lotus_sync_op_queue',
  SYNC_TIMELINE: 'lotus_sync_timeline',
  SYNC_BASE: 'lotus_sync_base_vault',
  SYNC_CONFLICTS: 'lotus_sync_conflicts',
  ERROR_LOGS: 'lotus_extension_errors',
  SECURITY_EVENTS: 'peach_security_events'
}

export const MESSAGE_TYPES = {
  UNLOCK_VAULT: 'UNLOCK_VAULT',
  LOCK_VAULT: 'LOCK_VAULT',
  GET_VAULT_STATUS: 'GET_VAULT_STATUS',
  SYNC_VAULT: 'SYNC_VAULT',
  REQUEST_CREDENTIALS: 'REQUEST_CREDENTIALS',
  PASSKEY_CREATE: 'PASSKEY_CREATE',
  PASSKEY_GET: 'PASSKEY_GET'
}