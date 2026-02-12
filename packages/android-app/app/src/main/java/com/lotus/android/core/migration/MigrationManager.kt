package com.lotus.android.core.migration

import com.lotus.android.core.model.MigrationSnapshot
import com.lotus.android.core.storage.SecureLocalStore
import kotlinx.serialization.json.Json

private const val MIGRATION_STATE_KEY = "android_migration_state"

class MigrationManager(private val secureStore: SecureLocalStore) {
  private val json = Json { ignoreUnknownKeys = true }

  fun beginMigration(fromVersion: Int, targetVersion: Int, backupCiphertext: String, backupAad: String, backupSyncVersion: Long) {
    val snapshot = MigrationSnapshot(
      state = "in_progress",
      fromVersion = fromVersion,
      targetVersion = targetVersion,
      backupCiphertext = backupCiphertext,
      backupAad = backupAad,
      backupSyncVersion = backupSyncVersion,
      startedAt = System.currentTimeMillis()
    )
    secureStore.write(MIGRATION_STATE_KEY, json.encodeToString(MigrationSnapshot.serializer(), snapshot))
  }

  fun completeMigration() {
    secureStore.remove(MIGRATION_STATE_KEY)
  }

  fun markRollingBack() {
    val snapshot = getSnapshot() ?: return
    secureStore.write(
      MIGRATION_STATE_KEY,
      json.encodeToString(MigrationSnapshot.serializer(), snapshot.copy(state = "rolling_back"))
    )
  }

  fun getSnapshot(): MigrationSnapshot? {
    val raw = secureStore.read(MIGRATION_STATE_KEY) ?: return null
    return runCatching { json.decodeFromString(MigrationSnapshot.serializer(), raw) }.getOrNull()
  }
}
