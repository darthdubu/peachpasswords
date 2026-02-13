package com.peach.plugin

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

class VaultStorage private constructor(context: Context) {
    
    private val prefs: SharedPreferences = context.getSharedPreferences(
        PREFS_NAME, 
        Context.MODE_PRIVATE
    )
    
    private var _isUnlocked = false
    private var decryptedVault: JSONObject? = null
    
    companion object {
        private const val PREFS_NAME = "PeachVault"
        private const val KEY_VAULT = "encrypted_vault"
        private const val KEY_SALT = "salt"
        
        @Volatile
        private var instance: VaultStorage? = null
        
        fun getInstance(context: Context): VaultStorage {
            return instance ?: synchronized(this) {
                instance ?: VaultStorage(context.applicationContext).also {
                    instance = it
                }
            }
        }
    }
    
    fun isUnlocked(): Boolean = _isUnlocked
    
    fun unlock(password: String): Boolean {
        val encryptedVault = prefs.getString(KEY_VAULT, null) ?: return false
        val salt = prefs.getString(KEY_SALT, null) ?: return false
        
        return try {
            // Decrypt vault using the password
            // This is a simplified implementation - actual decryption would use WebCrypto
            // via a bridge or native crypto implementation
            decryptedVault = JSONObject(encryptedVault)
            _isUnlocked = true
            true
        } catch (e: Exception) {
            false
        }
    }
    
    fun lock() {
        decryptedVault = null
        _isUnlocked = false
    }
    
    fun getCredentialsForPackage(packageName: String): List<JSONObject> {
        if (!_isUnlocked || decryptedVault == null) {
            return emptyList()
        }
        
        val entries = decryptedVault?.optJSONArray("entries") ?: return emptyList()
        val credentials = mutableListOf<JSONObject>()
        
        for (i in 0 until entries.length()) {
            val entry = entries.getJSONObject(i)
            if (matchesPackage(entry, packageName)) {
                credentials.add(entry)
            }
        }
        
        return credentials
    }
    
    private fun matchesPackage(entry: JSONObject, packageName: String): Boolean {
        val login = entry.optJSONObject("login") ?: return false
        val urls = login.optJSONArray("urls") ?: return false
        
        for (i in 0 until urls.length()) {
            val url = urls.getString(i)
            if (url.contains(packageName) || packageName.contains(extractDomain(url))) {
                return true
            }
        }
        
        return false
    }
    
    private fun extractDomain(url: String): String {
        return try {
            val uri = android.net.Uri.parse(url)
            uri.host ?: url
        } catch (e: Exception) {
            url
        }
    }
    
    fun saveVault(encryptedVault: String, salt: String) {
        prefs.edit()
            .putString(KEY_VAULT, encryptedVault)
            .putString(KEY_SALT, salt)
            .apply()
    }
    
    fun vaultExists(): Boolean {
        return prefs.contains(KEY_VAULT)
    }
}
