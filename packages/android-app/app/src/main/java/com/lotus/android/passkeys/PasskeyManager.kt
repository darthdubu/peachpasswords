package com.lotus.android.passkeys

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption

data class PasskeyStrategyEvent(
  val strategy: String,
  val succeeded: Boolean,
  val timestamp: Long = System.currentTimeMillis()
)

class PasskeyManager(private val context: Context) {
  private val credentialManager = CredentialManager.create(context)

  suspend fun createPasskey(creationJson: String): Result<Unit> = runCatching {
    val request = CreatePublicKeyCredentialRequest(requestJson = creationJson)
    credentialManager.createCredential(context, request)
  }.map { Unit }

  suspend fun getPasskey(requestJson: String): Result<Unit> = runCatching {
    val option = GetPublicKeyCredentialOption(requestJson)
    val request = GetCredentialRequest(listOf(option))
    credentialManager.getCredential(context, request)
  }.map { Unit }
}
