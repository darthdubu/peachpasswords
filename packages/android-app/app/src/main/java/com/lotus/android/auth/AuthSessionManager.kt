package com.lotus.android.auth

import com.lotus.android.core.storage.SecureLocalStore
import kotlin.math.max

private const val LAST_AUTH_METHOD_KEY = "last_auth_method"
private const val PIN_HASH_KEY = "pin_hash"
private const val PIN_SALT_KEY = "pin_salt"
private const val PIN_FAILED_COUNT_KEY = "pin_failed_count"
private const val PIN_LOCKED_UNTIL_KEY = "pin_locked_until"
private const val SESSION_UNLOCKED_AT_KEY = "session_unlocked_at"
private const val SESSION_GRACE_MS = 90_000L
private const val PIN_LOCKOUT_MS = 30_000L
private const val PIN_MAX_ATTEMPTS = 5

enum class AuthMethod { MASTER_PASSWORD, PIN, BIOMETRIC }

data class PinLockoutStatus(
  val locked: Boolean,
  val remainingMs: Long,
  val failedAttempts: Int
)

class AuthSessionManager(private val store: SecureLocalStore) {
  fun readLastAuthMethod(): AuthMethod {
    val raw = store.read(LAST_AUTH_METHOD_KEY) ?: return AuthMethod.MASTER_PASSWORD
    return runCatching { AuthMethod.valueOf(raw) }.getOrDefault(AuthMethod.MASTER_PASSWORD)
  }

  fun writeLastAuthMethod(method: AuthMethod) {
    store.write(LAST_AUTH_METHOD_KEY, method.name)
  }

  fun markUnlocked() {
    store.write(SESSION_UNLOCKED_AT_KEY, System.currentTimeMillis().toString())
  }

  fun shouldRestoreUnlockedSession(now: Long = System.currentTimeMillis()): Boolean {
    val unlockedAt = store.read(SESSION_UNLOCKED_AT_KEY)?.toLongOrNull() ?: return false
    return now - unlockedAt <= SESSION_GRACE_MS
  }

  fun lockNow() {
    store.remove(SESSION_UNLOCKED_AT_KEY)
  }

  fun pinLockoutStatus(now: Long = System.currentTimeMillis()): PinLockoutStatus {
    val failed = store.read(PIN_FAILED_COUNT_KEY)?.toIntOrNull() ?: 0
    val lockedUntil = store.read(PIN_LOCKED_UNTIL_KEY)?.toLongOrNull() ?: 0L
    val remaining = max(0L, lockedUntil - now)
    return PinLockoutStatus(locked = remaining > 0, remainingMs = remaining, failedAttempts = failed)
  }

  fun recordFailedPin(now: Long = System.currentTimeMillis()) {
    val failed = (store.read(PIN_FAILED_COUNT_KEY)?.toIntOrNull() ?: 0) + 1
    store.write(PIN_FAILED_COUNT_KEY, failed.toString())
    if (failed >= PIN_MAX_ATTEMPTS) {
      store.write(PIN_LOCKED_UNTIL_KEY, (now + PIN_LOCKOUT_MS).toString())
    }
  }

  fun clearPinLockout() {
    store.write(PIN_FAILED_COUNT_KEY, "0")
    store.remove(PIN_LOCKED_UNTIL_KEY)
  }
}
