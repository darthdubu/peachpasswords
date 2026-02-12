package com.lotus.android.sync

import com.lotus.android.core.model.S3Settings
import com.lotus.android.core.model.Vault
import java.util.UUID

class LotusSyncRepository(
  private val queueStore: SyncQueueStore,
  private val serverClient: LotusServerClient,
  private val s3SyncClient: S3SyncClient
) {
  suspend fun replayQueue(localVault: Vault, baseVault: Vault?, settings: S3Settings, masterKey: ByteArray, salt: ByteArray): Vault {
    queueStore.appendEvent(
      SyncEvent(
        id = UUID.randomUUID().toString(),
        timestamp = System.currentTimeMillis(),
        type = SyncEventType.SYNC_START,
        status = SyncStatus.INFO,
        detail = "Replaying queued sync operations"
      )
    )

    val serverResult = serverClient.sync(localVault)
    val s3Result = s3SyncClient.sync(serverResult, baseVault, settings, masterKey, salt)

    queueStore.clearQueue()
    queueStore.appendEvent(
      SyncEvent(
        id = UUID.randomUUID().toString(),
        timestamp = System.currentTimeMillis(),
        type = SyncEventType.SYNC_SUCCESS,
        status = SyncStatus.INFO,
        detail = "Server and S3 sync completed"
      )
    )
    return s3Result.vault ?: serverResult
  }
}
