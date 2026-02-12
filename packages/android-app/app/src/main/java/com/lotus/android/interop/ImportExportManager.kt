package com.lotus.android.interop

import com.lotus.android.core.model.EntryType
import com.lotus.android.core.model.LoginFields
import com.lotus.android.core.model.VaultEntry
import java.util.UUID

class ImportExportManager {
  fun importCsv(csv: String): List<VaultEntry> {
    val lines = csv.lines().filter { it.isNotBlank() }
    if (lines.size <= 1) return emptyList()
    return lines.drop(1).mapNotNull { line ->
      val columns = line.split(",")
      if (columns.size < 3) return@mapNotNull null
      val now = System.currentTimeMillis()
      VaultEntry(
        id = UUID.randomUUID().toString(),
        type = EntryType.LOGIN,
        name = columns[0].trim(),
        created = now,
        modified = now,
        login = LoginFields(
          urls = listOf(columns[1].trim()),
          username = columns[2].trim(),
          password = columns.getOrElse(3) { "" }.trim()
        )
      )
    }
  }

  fun exportCsv(entries: List<VaultEntry>): String {
    val header = "name,url,username,password"
    val rows = entries.mapNotNull { entry ->
      val login = entry.login ?: return@mapNotNull null
      listOf(entry.name, login.urls.firstOrNull().orEmpty(), login.username, login.password).joinToString(",")
    }
    return (listOf(header) + rows).joinToString("\n")
  }
}
