export const STORAGE_KEYS = {
  SETTINGS: 'peach_settings',
  SYNC_BASE: 'peach_sync_base',
  SECURITY_EVENTS: 'peach_security_events',
  SYNC_TIMELINE: 'peach_sync_timeline',
  SYNC_CONFLICTS: 'peach_sync_conflicts',
  IV_HISTORY: 'peach_recent_ivs'
} as const;

export const APP_CONSTANTS = {
  MAX_SECURITY_EVENTS: 100,
  MAX_STORED_IVS: 10000,
  MAX_IV_RETRY_ATTEMPTS: 5,
  DEFAULT_IDLE_TIMEOUT_MINUTES: 5,
  DEFAULT_TRASH_RETENTION_DAYS: 30,
  DECRYPT_CACHE_MAX_ENTRIES: 400,
  METADATA_CACHE_MAX_ENTRIES: 500
} as const;
