package com.lotus.android.core.crypto

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import java.security.SecureRandom
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Vault Header - Tracks KDF and encryption parameters for migration support
 * Matches browser extension's vault-version.ts
 */
@Serializable
data class VaultHeader(
    val version: Int = 2,
    val kdfAlgorithm: String = "argon2id",
    val kdfParams: KdfParams = KdfParams(),
    val kdfVersion: Int = CURRENT_KDF_VERSION,
    val aead: String = "aes-256-gcm",
    val createdAt: Long = System.currentTimeMillis()
)

@Serializable
data class KdfParams(
    val memory: Int = 262144,      // 256 MiB in KiB
    val iterations: Int = 3,
    val parallelism: Int = 4,
    val hashLength: Int = 32
)

// KDF Version Constants
const val LEGACY_KDF_VERSION = 1
const val CURRENT_KDF_VERSION = 2

val LEGACY_KDF_PARAMS = KdfParams(
    memory = 65536,      // 64 MiB
    iterations = 3,
    parallelism = 4,
    hashLength = 32
)

val CURRENT_KDF_PARAMS = KdfParams(
    memory = 262144,     // 256 MiB
    iterations = 3,
    parallelism = 4,
    hashLength = 32
)

/**
 * Encrypted payload structure matching extension format
 */
@Serializable
data class EncryptedPayload(
    val iv: String,
    val ciphertext: String,
    val tag: String,
    val aad: String? = null
)

/**
 * Result of KDF derivation
 */
data class DerivedKeyResult(
    val key: ByteArray,
    val salt: ByteArray,
    val kdfVersion: Int
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is DerivedKeyResult) return false
        return key.contentEquals(other.key) && 
               salt.contentEquals(other.salt) && 
               kdfVersion == other.kdfVersion
    }

    override fun hashCode(): Int {
        var result = key.contentHashCode()
        result = 31 * result + salt.contentHashCode()
        result = 31 * result + kdfVersion
        return result
    }
}

/**
 * IV Collision Detection for Cross-Device Sync
 * Security fix: AES-GCM fails catastrophically on IV reuse
 */
class IVCollisionDetector(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    
    companion object {
        private const val PREFS_NAME = "lotus_iv_tracker"
        private const val KEY_IVS = "recent_ivs"
        private const val KEY_LAST_ROTATION = "last_rotation"
        private const val MAX_STORED_IVS = 10000
        private const val MAX_IV_RETRY_ATTEMPTS = 5
    }

    /**
     * Check if IV has been used before and record it
     * @return true if IV is unique (safe to use)
     */
    fun checkAndRecordIV(iv: ByteArray): Boolean {
        val ivBase64 = Base64.encodeToString(iv, Base64.NO_WRAP)
        val storedIVs = getStoredIVs()
        
        // Check for collision
        if (ivBase64 in storedIVs) {
            return false // Collision detected
        }
        
        // Add new IV
        val updatedIVs = storedIVs + ivBase64
        
        // Rotate if exceeding max
        val finalIVs = if (updatedIVs.size > MAX_STORED_IVS) {
            updatedIVs.takeLast(MAX_STORED_IVS / 2)
        } else {
            updatedIVs
        }
        
        saveIVs(finalIVs)
        return true
    }

    /**
     * Generate a unique IV with collision retry
     */
    fun generateUniqueIV(): ByteArray {
        val random = SecureRandom()
        repeat(MAX_IV_RETRY_ATTEMPTS) {
            val iv = ByteArray(12).apply { random.nextBytes(this) }
            if (checkAndRecordIV(iv)) {
                return iv
            }
        }
        // Fallback: clear history and try once more
        clearHistory()
        return ByteArray(12).apply { random.nextBytes(this) }.also { checkAndRecordIV(it) }
    }

    fun clearHistory() {
        prefs.edit().remove(KEY_IVS).remove(KEY_LAST_ROTATION).apply()
    }

    private fun getStoredIVs(): List<String> {
        val json = prefs.getString(KEY_IVS, "[]") ?: "[]"
        return try {
            Json.decodeFromString(json)
        } catch (e: Exception) {
            emptyList()
        }
    }

    private fun saveIVs(ivs: List<String>) {
        val json = Json.encodeToString(ivs)
        prefs.edit()
            .putString(KEY_IVS, json)
            .putLong(KEY_LAST_ROTATION, System.currentTimeMillis())
            .apply()
    }
}

/**
 * Crypto Engine - Core cryptographic operations
 * Matches browser extension crypto.ts and crypto-utils.ts
 */
class CryptoEngine(private val context: Context) {
    private val json = Json { ignoreUnknownKeys = true }
    private val ivDetector = IVCollisionDetector(context)
    private val random = SecureRandom()

    /**
     * Derive master key from password using Argon2id
     * Matches extension's deriveKeyFromPasswordWithRaw
     */
    fun deriveMasterKey(
        password: String,
        salt: ByteArray? = null,
        kdfParams: KdfParams = CURRENT_KDF_PARAMS,
        kdfVersion: Int = CURRENT_KDF_VERSION
    ): DerivedKeyResult {
        val actualSalt = salt ?: ByteArray(32).apply { random.nextBytes(this) }
        
        val params = Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
            .withSalt(actualSalt)
            .withParallelism(kdfParams.parallelism)
            .withMemoryAsKB(kdfParams.memory)
            .withIterations(kdfParams.iterations)
            .build()

        val generator = Argon2BytesGenerator()
        generator.init(params)

        val result = ByteArray(kdfParams.hashLength)
        generator.generateBytes(password.toCharArray(), result)

        return DerivedKeyResult(result, actualSalt, kdfVersion)
    }

    /**
     * Derive subkey using HKDF
     * Matches extension's deriveSubKey exactly
     */
    fun deriveSubKey(masterKey: ByteArray, context: String): ByteArray {
        // HKDF-Extract: PRK = HMAC-Hash(salt, IKM)
        val salt = ByteArray(32) { 0 } // Empty salt (Argon2 already salted)
        val prk = hmacSha256(salt, masterKey)
        
        // HKDF-Expand
        val info = context.toByteArray(Charsets.UTF_8)
        return hkdfExpand(prk, info, 32)
    }

    /**
     * Encrypt data with AES-GCM
     * Matches extension's encrypt function
     */
    fun encrypt(
        plaintext: ByteArray,
        key: ByteArray,
        aad: String? = null
    ): EncryptedPayload {
        val iv = ivDetector.generateUniqueIV()
        
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val secretKey = SecretKeySpec(key, "AES")
        val spec = GCMParameterSpec(128, iv)
        
        cipher.init(Cipher.ENCRYPT_MODE, secretKey, spec)
        
        aad?.let {
            cipher.updateAAD(it.toByteArray(Charsets.UTF_8))
        }
        
        val ciphertext = cipher.doFinal(plaintext)
        
        // Split ciphertext and authentication tag
        val ct = ciphertext.copyOfRange(0, ciphertext.size - 16)
        val tag = ciphertext.copyOfRange(ciphertext.size - 16, ciphertext.size)
        
        return EncryptedPayload(
            iv = Base64.encodeToString(iv, Base64.NO_WRAP),
            ciphertext = Base64.encodeToString(ct, Base64.NO_WRAP),
            tag = Base64.encodeToString(tag, Base64.NO_WRAP),
            aad = aad
        )
    }

    /**
     * Encrypt string to JSON payload
     */
    fun encryptUtf8(plaintext: String, key: ByteArray, aad: String? = null): String {
        val payload = encrypt(plaintext.toByteArray(Charsets.UTF_8), key, aad)
        return json.encodeToString(payload)
    }

    /**
     * Decrypt data with AES-GCM
     * Matches extension's decrypt function
     */
    fun decrypt(payload: EncryptedPayload, key: ByteArray): ByteArray {
        val iv = Base64.decode(payload.iv, Base64.NO_WRAP)
        val ct = Base64.decode(payload.ciphertext, Base64.NO_WRAP)
        val tag = Base64.decode(payload.tag, Base64.NO_WRAP)
        
        // Combine ciphertext and tag
        val combined = ct + tag
        
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val secretKey = SecretKeySpec(key, "AES")
        val spec = GCMParameterSpec(128, iv)
        
        cipher.init(Cipher.DECRYPT_MODE, secretKey, spec)
        
        payload.aad?.let {
            cipher.updateAAD(it.toByteArray(Charsets.UTF_8))
        }
        
        return cipher.doFinal(combined)
    }

    /**
     * Decrypt JSON payload to string
     */
    fun decryptUtf8(payloadJson: String, key: ByteArray): String {
        val payload = json.decodeFromString<EncryptedPayload>(payloadJson)
        return String(decrypt(payload, key), Charsets.UTF_8)
    }

    fun parsePayload(payloadJson: String): EncryptedPayload {
        return json.decodeFromString(payloadJson)
    }

    fun serializePayload(payloadJson: String): String {
        return payloadJson
    }

    /**
     * Compute vault integrity hash
     * Matches extension's computeVaultHash
     */
    fun computeIntegrityHash(entryIds: List<String>, syncVersion: Long): String {
        val canonical = entryIds.sorted().joinToString("|") + "|$syncVersion"
        val digest = MessageDigest.getInstance("SHA-256")
        return Base64.encodeToString(
            digest.digest(canonical.toByteArray(Charsets.UTF_8)),
            Base64.NO_WRAP
        )
    }

    /**
     * Generate random salt
     */
    fun generateSalt(size: Int = 32): ByteArray {
        return ByteArray(size).apply { random.nextBytes(this) }
    }

    /**
     * Securely wipe sensitive data from memory
     */
    fun wipe(bytes: ByteArray) {
        for (i in bytes.indices) {
            bytes[i] = 0
        }
    }

    /**
     * Check if KDF migration is needed
     */
    fun needsKdfMigration(header: VaultHeader?): Boolean {
        if (header == null) return true // No header = assume legacy
        return header.kdfVersion < CURRENT_KDF_VERSION
    }

    /**
     * Get KDF params for version
     */
    fun getKdfParamsForVersion(version: Int): KdfParams {
        return when (version) {
            LEGACY_KDF_VERSION -> LEGACY_KDF_PARAMS
            CURRENT_KDF_VERSION -> CURRENT_KDF_PARAMS
            else -> CURRENT_KDF_PARAMS
        }
    }

    // Private helper functions
    private fun hmacSha256(key: ByteArray, data: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(data)
    }

    private fun hkdfExpand(prk: ByteArray, info: ByteArray, length: Int): ByteArray {
        var counter = 1
        var output = ByteArray(0)
        var t = ByteArray(0)
        
        while (output.size < length) {
            val data = t + info + byteArrayOf(counter.toByte())
            t = hmacSha256(prk, data)
            output += t
            counter++
        }
        
        return output.copyOf(length)
    }
}

/**
 * Extension functions for ByteArray
 */
fun ByteArray.toBase64(): String = Base64.encodeToString(this, Base64.NO_WRAP)
fun String.fromBase64(): ByteArray = Base64.decode(this, Base64.NO_WRAP)
