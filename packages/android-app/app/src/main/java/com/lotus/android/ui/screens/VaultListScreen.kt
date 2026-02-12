package com.lotus.android.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AssistChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun VaultListScreen(
  syncStatus: String,
  onOpenSettings: () -> Unit,
  onOpenSync: () -> Unit,
  onOpenSecurity: () -> Unit,
  onOpenUpdates: () -> Unit
) {
  Column(
    modifier = Modifier
      .fillMaxSize()
      .padding(16.dp),
    verticalArrangement = Arrangement.spacedBy(14.dp)
  ) {
    Text("Vault", style = MaterialTheme.typography.headlineMedium)
    Text("Sync: $syncStatus", style = MaterialTheme.typography.bodyMedium)
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      AssistChip(onClick = onOpenSettings, label = { Text("Settings") })
      AssistChip(onClick = onOpenSync, label = { Text("Sync") })
      AssistChip(onClick = onOpenSecurity, label = { Text("Security") })
      AssistChip(onClick = onOpenUpdates, label = { Text("Updates") })
    }
    Text("Current site suggestions and entries will appear here.")
  }
}
