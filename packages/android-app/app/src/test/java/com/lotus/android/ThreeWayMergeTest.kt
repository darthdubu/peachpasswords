package com.lotus.android

import com.lotus.android.core.model.EntryType
import com.lotus.android.core.model.Vault
import com.lotus.android.core.model.VaultEntry
import com.lotus.android.sync.threeWayMerge
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ThreeWayMergeTest {
  @Test
  fun detectsConflicts() {
    val base = vault(entry("1", "A", 100))
    val local = vault(entry("1", "A local", 200))
    val remote = vault(entry("1", "A remote", 210))
    val result = threeWayMerge(base, local, remote)
    assertTrue(result.conflicts.isNotEmpty())
  }

  @Test
  fun preservesNonConflictingChanges() {
    val base = vault()
    val local = vault(entry("1", "Local", 100))
    val remote = vault()
    val result = threeWayMerge(base, local, remote)
    assertEquals(1, result.merged.entries.size)
  }

  private fun vault(vararg entries: VaultEntry): Vault = Vault(entries = entries.toList())

  private fun entry(id: String, name: String, modified: Long): VaultEntry = VaultEntry(
    id = id,
    type = EntryType.LOGIN,
    name = name,
    created = modified,
    modified = modified
  )
}
