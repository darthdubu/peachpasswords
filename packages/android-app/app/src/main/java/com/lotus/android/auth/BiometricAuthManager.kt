package com.lotus.android.auth

import androidx.biometric.BiometricManager

class BiometricAuthManager(private val biometricManager: BiometricManager) {
  fun canUseBiometric(): Boolean {
    val status = biometricManager.canAuthenticate(
      BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
    )
    return status == BiometricManager.BIOMETRIC_SUCCESS
  }
}
