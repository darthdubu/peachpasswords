package com.lotus.android.core.repository

import com.lotus.android.core.crypto.CryptoEngine
import com.lotus.android.core.migration.MigrationManager
import com.lotus.android.core.model.Vault
import com.lotus.android.core.model.VaultEntry
import com.lotus.android.core.storage.SecureLocalStore
import kotlinx.serialization.json.Json

private const val VAULT_BLOB_KEY = "vault_blob"
private const val VAULT_AAD_KEY = "vault_aad"

class VaultRepository(
  private val secureStore: SecureLocalStore,
  private val cryptoEngine: CryptoEngine,
  private val migrationManager: MigrationManager
) {
  private val json = Json { ignoreUnknownKeys = true }

  fun readVault(masterKey: ByteArray): Vault? {
    val payload = secureStore.read(VAULT_BLOB_KEY) ?: return null
    val plain = cryptoEngine.decryptUtf8(payload, masterKey)
    return json.decodeFromString(Vault.serializer(), plain)
  }

  fun saveVault(vault: Vault, masterKey: ByteArray) {
    val normalized = vault.copy(
      contentHash = cryptoEngine.computeIntegrityHash(vault.entries.map(VaultEntry::id), vault.syncVersion)
    )
    val serialized = json.encodeToString(Vault.serializer(), normalized)
    val payload = cryptoEngine.encryptUtf8(serialized, masterKey)
    secureStore.write(VAULT_BLOB_KEY, payload)
  }

  fun migrateWithRecovery(
    current: Vault,
    masterKey: ByteArray,
    migrate: (Vault) -> Vault
  ): Vault {
    val currentSerialized = json.encodeToString(Vault.serializer(), current)
    val currentPayload = cryptoEngine.encryptUtf8(currentSerialized, masterKey)
    migrationManager.beginMigration(
      fromVersion = current.version,
      targetVersion = current.version + 1,
      backupCiphertext = currentPayload,
      backupAad = null,
      backupSyncVersion = current.syncVersion
    )
    return runCatching {
      val migrated = migrate(current)
      saveVault(migrated, masterKey)
      migrationManager.completeMigration()
      migrated
    }.getOrElse { error ->
      migrationManager.markRollingBack()
      val snapshot = migrationManager.getSnapshot()
      if (snapshot?.backupCiphertext != null) {
        secureStore.write(VAULT_BLOB_KEY, snapshot.backupCiphertext)
      }
      migrationManager.completeMigration()
      throw error
    }
  }
}
