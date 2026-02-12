package com.lotus.android.auth

import com.lotus.android.core.crypto.CryptoEngine
import com.lotus.android.core.crypto.DerivedKeyResult

/**
 * Master key manager - handles password-based key derivation
 */
class MasterKeyManager(private val cryptoEngine: CryptoEngine) {
    private var currentKey: ByteArray? = null
    private var currentSalt: ByteArray? = null
    private var currentKdfVersion: Int = 0
    
    /**
     * Derive master key from password
     */
    fun deriveFromPassword(password: String, salt: ByteArray? = null): DerivedKeyResult {
        return cryptoEngine.deriveMasterKey(password, salt)
    }
    
    /**
     * Derive with specific KDF version (for migration)
     */
    fun deriveFromPassword(
        password: String, 
        salt: ByteArray, 
        kdfVersion: Int
    ): DerivedKeyResult {
        val params = cryptoEngine.getKdfParamsForVersion(kdfVersion)
        return cryptoEngine.deriveMasterKey(password, salt, params, kdfVersion)
    }
    
    /**
     * Set current master key in memory
     */
    fun setKey(key: ByteArray, salt: ByteArray, kdfVersion: Int) {
        clearKey()
        currentKey = key.copyOf()
        currentSalt = salt.copyOf()
        currentKdfVersion = kdfVersion
    }
    
    /**
     * Get current master key
     */
    fun getKey(): ByteArray? = currentKey?.copyOf()
    
    /**
     * Get current salt
     */
    fun getSalt(): ByteArray? = currentSalt?.copyOf()
    
    /**
     * Get current KDF version
     */
    fun getKdfVersion(): Int = currentKdfVersion
    
    /**
     * Check if key is available
     */
    fun hasKey(): Boolean = currentKey != null
    
    /**
     * Clear key from memory securely
     */
    fun clearKey() {
        currentKey?.let { cryptoEngine.wipe(it) }
        currentSalt?.let { cryptoEngine.wipe(it) }
        currentKey = null
        currentSalt = null
        currentKdfVersion = 0
    }
}
