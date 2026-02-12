package com.lotus.android.auth

import android.util.Base64
import com.lotus.android.core.crypto.CryptoEngine
import com.lotus.android.core.storage.SecureLocalStore
import java.security.MessageDigest
import java.security.SecureRandom

private const val PIN_HASH_KEY = "pin_hash"
private const val PIN_SALT_KEY = "pin_salt"

class PinManager(
  private val store: SecureLocalStore,
  private val cryptoEngine: CryptoEngine
) {
  private val random = SecureRandom()

  fun hasPin(): Boolean = store.read(PIN_HASH_KEY) != null

  fun setPin(pin: String) {
    val salt = ByteArray(16).also(random::nextBytes)
    val derived = cryptoEngine.deriveMasterKey(pin.toCharArray(), salt, rounds = 120_000)
    val digest = MessageDigest.getInstance("SHA-256").digest(derived)
    store.write(PIN_SALT_KEY, Base64.encodeToString(salt, Base64.NO_WRAP))
    store.write(PIN_HASH_KEY, Base64.encodeToString(digest, Base64.NO_WRAP))
    cryptoEngine.wipe(derived)
  }

  fun verifyPin(pin: String): Boolean {
    val salt = store.read(PIN_SALT_KEY)?.let { Base64.decode(it, Base64.DEFAULT) } ?: return false
    val expected = store.read(PIN_HASH_KEY) ?: return false
    val derived = cryptoEngine.deriveMasterKey(pin.toCharArray(), salt, rounds = 120_000)
    val digest = MessageDigest.getInstance("SHA-256").digest(derived)
    val actual = Base64.encodeToString(digest, Base64.NO_WRAP)
    cryptoEngine.wipe(derived)
    return actual == expected
  }

  fun clearPin() {
    store.remove(PIN_HASH_KEY)
    store.remove(PIN_SALT_KEY)
  }
}
