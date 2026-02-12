package com.lotus.android.passkeys

import com.lotus.android.core.storage.SecureLocalStore
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

private const val PASSKEY_TELEMETRY_KEY = "passkey_strategy_telemetry"

class PasskeyTelemetryStore(private val store: SecureLocalStore) {
  private val json = Json { ignoreUnknownKeys = true }
  private val serializer = ListSerializer(PasskeyStrategyEventDto.serializer())

  fun record(event: PasskeyStrategyEvent) {
    val current = read().toMutableList()
    current.add(0, event.toDto())
    store.write(PASSKEY_TELEMETRY_KEY, json.encodeToString(serializer, current.take(200)))
  }

  fun preferredStrategy(): String? {
    val grouped = read().groupBy { it.strategy }
    return grouped.maxByOrNull { (_, events) -> events.count { it.succeeded } }?.key
  }

  private fun read(): List<PasskeyStrategyEventDto> {
    val raw = store.read(PASSKEY_TELEMETRY_KEY) ?: return emptyList()
    return runCatching { json.decodeFromString(serializer, raw) }.getOrDefault(emptyList())
  }
}

@kotlinx.serialization.Serializable
private data class PasskeyStrategyEventDto(
  val strategy: String,
  val succeeded: Boolean,
  val timestamp: Long
)

private fun PasskeyStrategyEvent.toDto(): PasskeyStrategyEventDto =
  PasskeyStrategyEventDto(strategy = strategy, succeeded = succeeded, timestamp = timestamp)
