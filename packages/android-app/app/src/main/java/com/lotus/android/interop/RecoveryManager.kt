package com.lotus.android.interop

import com.lotus.android.core.storage.SecureLocalStore

private const val RECOVERY_BLOB_KEY = "recovery_blob"

class RecoveryManager(private val secureStore: SecureLocalStore) {
  fun persistRecoveryBlob(encryptedBlob: String) {
    secureStore.write(RECOVERY_BLOB_KEY, encryptedBlob)
  }

  fun readRecoveryBlob(): String? = secureStore.read(RECOVERY_BLOB_KEY)

  fun clearRecoveryBlob() {
    secureStore.remove(RECOVERY_BLOB_KEY)
  }
}
