package com.lotus.android.sync

import com.lotus.android.core.storage.SecureLocalStore
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

private const val SYNC_QUEUE_KEY = "sync_queue_android"
private const val SYNC_TIMELINE_KEY = "sync_timeline_android"

class SyncQueueStore(private val store: SecureLocalStore) {
  private val json = Json { ignoreUnknownKeys = true }
  private val queueSerializer = ListSerializer(SyncOperation.serializer())
  private val timelineSerializer = ListSerializer(SyncEvent.serializer())

  fun enqueue(op: SyncOperation) {
    val current = readQueue().toMutableList()
    current += op
    store.write(SYNC_QUEUE_KEY, json.encodeToString(queueSerializer, current.sortedBy { it.seq }))
  }

  fun readQueue(): List<SyncOperation> {
    val raw = store.read(SYNC_QUEUE_KEY) ?: return emptyList()
    return runCatching { json.decodeFromString(queueSerializer, raw) }.getOrDefault(emptyList())
  }

  fun clearQueue() {
    store.remove(SYNC_QUEUE_KEY)
  }

  fun appendEvent(event: SyncEvent) {
    val timeline = readTimeline().toMutableList()
    timeline.add(0, event)
    store.write(SYNC_TIMELINE_KEY, json.encodeToString(timelineSerializer, timeline.take(200)))
  }

  fun readTimeline(): List<SyncEvent> {
    val raw = store.read(SYNC_TIMELINE_KEY) ?: return emptyList()
    return runCatching { json.decodeFromString(timelineSerializer, raw) }.getOrDefault(emptyList())
  }
}
