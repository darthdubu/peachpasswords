package com.lotus.android.sync

import com.lotus.android.core.model.Vault
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

class LotusServerClient(
  private val baseUrl: String,
  private val secret: String,
  private val httpClient: OkHttpClient = OkHttpClient()
) {
  suspend fun sync(localVault: Vault): Vault = withContext(Dispatchers.IO) {
    // Placeholder request keeps API shape explicit while sync body is implemented.
    val request = Request.Builder()
      .url("$baseUrl/api/health")
      .header("Authorization", "Bearer $secret")
      .get()
      .build()
    runCatching { httpClient.newCall(request).execute().close() }
    localVault
  }
}
