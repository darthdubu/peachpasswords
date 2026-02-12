package com.lotus.android.interop

import okhttp3.OkHttpClient
import okhttp3.Request

class PairingManager(private val httpClient: OkHttpClient = OkHttpClient()) {
  suspend fun verifyPairing(baseUrl: String, token: String): Result<Unit> = runCatching {
    val request = Request.Builder()
      .url("$baseUrl/api/health")
      .header("Authorization", "Bearer $token")
      .build()
    httpClient.newCall(request).execute().use { response ->
      check(response.isSuccessful) { "Pairing verification failed (${response.code})" }
    }
  }
}
