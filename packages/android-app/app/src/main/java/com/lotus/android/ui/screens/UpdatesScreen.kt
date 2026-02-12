package com.lotus.android.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.lotus.android.ui.state.UpdatesViewModel

@Composable
fun UpdatesScreen(
  onBack: () -> Unit,
  updatesViewModel: UpdatesViewModel = viewModel()
) {
  val state by updatesViewModel.state.collectAsState()

  LaunchedEffect(Unit) {
    updatesViewModel.checkForUpdates()
  }

  Column(
    modifier = Modifier
      .fillMaxSize()
      .padding(16.dp)
      .verticalScroll(rememberScrollState()),
    verticalArrangement = Arrangement.spacedBy(12.dp)
  ) {
    Text("Updates", style = MaterialTheme.typography.headlineMedium)
    Text(
      text = "Current version: ${state.currentVersion}",
      style = MaterialTheme.typography.bodyMedium
    )

    Card(modifier = Modifier.fillMaxWidth()) {
      Column(
        modifier = Modifier.padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
      ) {
        Text(
          text = state.statusMessage,
          style = MaterialTheme.typography.bodyMedium
        )
        state.errorMessage?.let { error ->
          Text(
            text = error,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error
          )
        }
        state.latest?.let { release ->
          Text("Latest: ${release.tagName}", style = MaterialTheme.typography.titleMedium)
          Text("Published: ${release.publishedAt}", style = MaterialTheme.typography.bodySmall)
          Text(
            text = "Release Notes",
            style = MaterialTheme.typography.titleSmall
          )
          Text(
            text = release.body.ifBlank { "No release notes provided." },
            style = MaterialTheme.typography.bodySmall
          )
        }
      }
    }

    OutlinedButton(
      onClick = { updatesViewModel.checkForUpdates() },
      enabled = !state.isChecking && !state.isDownloading
    ) {
      Text(if (state.isChecking) "Checking..." else "Check Again")
    }

    Button(
      onClick = { updatesViewModel.downloadAndInstall() },
      enabled = state.updateAvailable && !state.isDownloading && state.latest?.apkUrl != null
    ) {
      Text(if (state.isDownloading) "Preparing Installer..." else "Download & Install")
    }

    OutlinedButton(onClick = onBack) { Text("Back") }
  }
}
