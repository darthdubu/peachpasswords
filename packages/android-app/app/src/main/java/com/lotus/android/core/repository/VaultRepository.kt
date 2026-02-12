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
    val aad = secureStore.read(VAULT_AAD_KEY) ?: buildVaultAad(syncVersion = 0)
    val plain = cryptoEngine.decryptUtf8(cryptoEngine.parsePayload(payload), masterKey, aad)
    return json.decodeFromString(Vault.serializer(), plain)
  }

  fun saveVault(vault: Vault, masterKey: ByteArray) {
    val normalized = vault.copy(
      contentHash = cryptoEngine.computeIntegrityHash(vault.entries.map(VaultEntry::id), vault.syncVersion)
    )
    val aad = buildVaultAad(normalized.syncVersion)
    val serialized = json.encodeToString(Vault.serializer(), normalized)
    val payload = cryptoEngine.encryptUtf8(serialized, masterKey, aad)
    secureStore.write(VAULT_BLOB_KEY, cryptoEngine.serializePayload(payload))
    secureStore.write(VAULT_AAD_KEY, aad)
  }

  fun migrateWithRecovery(
    current: Vault,
    masterKey: ByteArray,
    migrate: (Vault) -> Vault
  ): Vault {
    val currentAad = buildVaultAad(current.syncVersion)
    val currentSerialized = json.encodeToString(Vault.serializer(), current)
    val currentPayload = cryptoEngine.encryptUtf8(currentSerialized, masterKey, currentAad)
    migrationManager.beginMigration(
      fromVersion = current.version,
      targetVersion = current.version + 1,
      backupCiphertext = cryptoEngine.serializePayload(currentPayload),
      backupAad = currentAad,
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
      if (snapshot?.backupCiphertext != null && snapshot.backupAad != null) {
        secureStore.write(VAULT_BLOB_KEY, snapshot.backupCiphertext)
        secureStore.write(VAULT_AAD_KEY, snapshot.backupAad)
      }
      migrationManager.completeMigration()
      throw error
    }
  }

  private fun buildVaultAad(syncVersion: Long): String = "lotus.vault.v1:$syncVersion"
}
