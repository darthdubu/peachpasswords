package com.lotus.android.sync

import com.lotus.android.core.model.Vault
import com.lotus.android.core.model.VaultEntry

data class MergeConflict(
  val entryId: String,
  val base: VaultEntry?,
  val local: VaultEntry?,
  val remote: VaultEntry?
)

data class MergeResult(
  val merged: Vault,
  val conflicts: List<MergeConflict>
)

fun threeWayMerge(base: Vault, local: Vault, remote: Vault): MergeResult {
  val baseMap = base.entries.associateBy { it.id }
  val localMap = local.entries.associateBy { it.id }
  val remoteMap = remote.entries.associateBy { it.id }
  val allIds = (baseMap.keys + localMap.keys + remoteMap.keys).toSet()

  val mergedEntries = mutableListOf<VaultEntry>()
  val conflicts = mutableListOf<MergeConflict>()

  for (id in allIds) {
    val b = baseMap[id]
    val l = localMap[id]
    val r = remoteMap[id]
    when {
      l == r -> if (l != null) mergedEntries += l
      l == b -> if (r != null) mergedEntries += r
      r == b -> if (l != null) mergedEntries += l
      else -> {
        conflicts += MergeConflict(id, b, l, r)
        val best = listOfNotNull(l, r).maxByOrNull { it.modified }
        if (best != null) mergedEntries += best
      }
    }
  }

  return MergeResult(
    merged = local.copy(
      entries = mergedEntries.sortedByDescending { it.modified },
      syncVersion = maxOf(local.syncVersion, remote.syncVersion) + 1
    ),
    conflicts = conflicts
  )
}
