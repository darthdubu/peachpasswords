export type SyncOperationKind = 'entry-upsert' | 'entry-delete' | 'vault-write'

export interface SyncOperation {
  id: string
  seq: number
  kind: SyncOperationKind
  entityId?: string
  payloadHash?: string
  queuedAt: number
}

export type SyncEventType =
  | 'sync-start'
  | 'sync-push'
  | 'sync-pull'
  | 'sync-merge'
  | 'sync-conflict'
  | 'sync-success'
  | 'sync-error'
  | 'sync-queued'
  | 'migration'

export interface SyncEvent {
  id: string
  timestamp: number
  type: SyncEventType
  status: 'info' | 'warning' | 'error'
  detail: string
}

export interface SecurityScore {
  score: number
  maxScore: number
  weakPasswords: number
  reusedPasswords: number
  missingTotp: number
}
