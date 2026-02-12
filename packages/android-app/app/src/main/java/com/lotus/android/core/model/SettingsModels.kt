package com.lotus.android.core.model

import kotlinx.serialization.Serializable

@Serializable
data class S3Settings(
    val endpoint: String = "",
    val region: String = "auto",
    val bucket: String = "",
    val accessKey: String = "",
    val secretKey: String = "",
    val pathStyle: Boolean = true
) {
    val isConfigured: Boolean
        get() = endpoint.isNotBlank() && 
                bucket.isNotBlank() && 
                accessKey.isNotBlank() && 
                secretKey.isNotBlank()
    
    val displayEndpoint: String
        get() = if (endpoint.startsWith("http")) endpoint else "https://$endpoint"
}

@Serializable
data class AppSettings(
    val theme: AppTheme = AppTheme.SYSTEM,
    val accentColor: AccentColor = AccentColor.LOTUS,
    val autoLockTimeout: Int = 5,
    val autoCopyTotp: Boolean = false,
    val biometricEnabled: Boolean = false,
    val pinEnabled: Boolean = false,
    val autoSync: Boolean = true,
    val syncOnWifiOnly: Boolean = false,
    val defaultVaultView: VaultView = VaultView.ALL
)

@Serializable
enum class AppTheme { LIGHT, DARK, SYSTEM }

@Serializable
enum class AccentColor {
    LOTUS, APPLE, BANANA, CHERRY, GRAPE, 
    LEMON, LIME, MANGO, PLUM, BERRY, COCONUT
}

@Serializable
enum class VaultView { ALL, FAVORITES, LOGINS, CARDS, IDENTITIES, NOTES, TRASH }

@Serializable
data class EncryptedSettings(
    val iv: String,
    val ciphertext: String
)

@Serializable
data class SecurityEvent(
    val type: SecurityEventType,
    val timestamp: Long = System.currentTimeMillis(),
    val severity: SecurityEventSeverity = SecurityEventSeverity.INFO,
    val details: String? = null
)

@Serializable
enum class SecurityEventType {
    VAULT_CREATED,
    VAULT_UNLOCKED,
    VAULT_LOCKED,
    PASSWORD_CHANGED,
    BIOMETRIC_REGISTERED,
    BIOMETRIC_USED,
    PIN_REGISTERED,
    PIN_USED,
    PIN_FAILED,
    PIN_LOCKED,
    SYNC_SUCCESS,
    SYNC_FAILED,
    EXPORT_CREATED,
    IMPORT_COMPLETED,
    DECRYPTION_FAILED
}

@Serializable
enum class SecurityEventSeverity { INFO, WARNING, ERROR }

@Serializable
data class PinAttemptData(
    val failedAttempts: Int = 0,
    val lockUntil: Long = 0
) {
    val isLocked: Boolean
        get() = lockUntil > System.currentTimeMillis()
    
    val remainingLockTime: Long
        get() = maxOf(0, lockUntil - System.currentTimeMillis())
}

@Serializable
data class SessionData(
    val startedAt: Long = System.currentTimeMillis(),
    val lastActivity: Long = System.currentTimeMillis(),
    val expiresAt: Long? = null
) {
    fun isValid(timeoutMinutes: Int): Boolean {
        if (timeoutMinutes <= 0) return true
        return System.currentTimeMillis() - lastActivity < timeoutMinutes * 60 * 1000
    }
    
    fun touch() = copy(lastActivity = System.currentTimeMillis())
}
