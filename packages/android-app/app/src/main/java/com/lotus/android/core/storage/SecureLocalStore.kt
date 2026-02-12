package com.lotus.android.core.storage

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class SecureLocalStore(context: Context) {
  private val prefs = EncryptedSharedPreferences.create(
    context,
    "lotus_secure_store",
    MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
  )

  fun read(key: String): String? = prefs.getString(key, null)
  fun write(key: String, value: String) = prefs.edit().putString(key, value).apply()
  fun remove(key: String) = prefs.edit().remove(key).apply()
}
