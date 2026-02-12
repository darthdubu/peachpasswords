package com.lotus.android.core.model

import kotlinx.serialization.Serializable

@Serializable
data class Vault(
  val version: Int = 1,
  val entries: List<VaultEntry> = emptyList(),
  val folders: List<VaultFolder> = emptyList(),
  val lastSync: Long = 0L,
  val syncVersion: Long = 0L,
  val contentHash: String? = null
)

@Serializable
data class VaultFolder(
  val id: String,
  val name: String
)

@Serializable
data class VaultEntry(
  val id: String,
  val type: EntryType,
  val name: String,
  val favorite: Boolean = false,
  val created: Long,
  val modified: Long,
  val login: LoginFields? = null,
  val card: CardFields? = null,
  val identity: IdentityFields? = null,
  val note: NoteFields? = null,
  val tags: List<String> = emptyList()
)

@Serializable
enum class EntryType { LOGIN, CARD, IDENTITY, NOTE }

@Serializable
data class LoginFields(
  val urls: List<String> = emptyList(),
  val username: String = "",
  val password: String = "",
  val totp: TotpFields? = null,
  val passkey: PasskeyFields? = null,
  val customFields: List<CustomField> = emptyList()
)

@Serializable
data class TotpFields(
  val secret: String,
  val algorithm: String = "SHA1",
  val digits: Int = 6,
  val period: Int = 30,
  val issuer: String? = null
)

@Serializable
data class PasskeyFields(
  val credentialId: String,
  val rpId: String,
  val rpName: String,
  val userHandle: String,
  val userName: String,
  val privateKey: String,
  val publicKey: String,
  val signCount: Long,
  val created: Long
)

@Serializable
data class CustomField(
  val name: String,
  val value: String,
  val hidden: Boolean = false
)

@Serializable
data class CardFields(
  val holder: String,
  val number: String,
  val expMonth: String,
  val expYear: String,
  val cvv: String,
  val brand: String? = null
)

@Serializable
data class IdentityFields(
  val firstName: String,
  val lastName: String,
  val email: String,
  val phone: String? = null,
  val address: AddressFields? = null
)

@Serializable
data class AddressFields(
  val street: String,
  val city: String,
  val state: String,
  val zip: String,
  val country: String
)

@Serializable
data class NoteFields(
  val content: String
)

@Serializable
data class EncryptedBlobPayload(
  val v: Int,
  val alg: String,
  val iv: String,
  val ct: String,
  val tag: String,
  val aad: String? = null
)

@Serializable
data class MigrationSnapshot(
  val state: String = "none",
  val fromVersion: Int = 0,
  val targetVersion: Int = 0,
  val backupCiphertext: String? = null,
  val backupAad: String? = null,
  val backupSyncVersion: Long? = null,
  val startedAt: Long? = null
)
