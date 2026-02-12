package com.lotus.android.sync

import kotlinx.serialization.Serializable

@Serializable
data class SyncOperation(
  val id: String,
  val seq: Long,
  val kind: SyncOperationKind,
  val entityId: String? = null,
  val payloadHash: String? = null,
  val queuedAt: Long
)

@Serializable
enum class SyncOperationKind { ENTRY_UPSERT, ENTRY_DELETE, VAULT_WRITE }

@Serializable
data class SyncEvent(
  val id: String,
  val timestamp: Long,
  val type: SyncEventType,
  val status: SyncStatus,
  val detail: String
)

@Serializable
enum class SyncEventType {
  SYNC_START, SYNC_PUSH, SYNC_PULL, SYNC_MERGE, SYNC_CONFLICT, SYNC_SUCCESS, SYNC_ERROR, SYNC_QUEUED
}

@Serializable
enum class SyncStatus { INFO, WARNING, ERROR }
