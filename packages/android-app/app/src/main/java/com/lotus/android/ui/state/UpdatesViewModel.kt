package com.lotus.android.ui.state

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.lotus.android.update.GithubUpdater
import com.lotus.android.update.UpdateUiState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class UpdatesViewModel(application: Application) : AndroidViewModel(application) {
  private val updater = GithubUpdater()

  private val _state = MutableStateFlow(UpdateUiState())
  val state: StateFlow<UpdateUiState> = _state.asStateFlow()

  fun checkForUpdates() {
    viewModelScope.launch {
      _state.update { it.copy(isChecking = true, errorMessage = null) }
      val result = updater.fetchLatestRelease()
      result.onSuccess { release ->
        val currentVersion = _state.value.currentVersion
        val available = updater.isUpdateAvailable(currentVersion, release.tagName)
        _state.update {
          it.copy(
            isChecking = false,
            latest = release,
            updateAvailable = available,
            statusMessage = if (available) {
              "Update available: ${release.tagName}"
            } else {
              "You're up to date on $currentVersion."
            },
            errorMessage = null
          )
        }
      }.onFailure { error ->
        _state.update {
          it.copy(
            isChecking = false,
            errorMessage = error.message ?: "Failed to check updates",
            statusMessage = "Could not load release info."
          )
        }
      }
    }
  }

  fun downloadAndInstall() {
    val latest = _state.value.latest ?: return
    val apkUrl = latest.apkUrl ?: run {
      _state.update {
        it.copy(errorMessage = "No APK asset found in latest release.")
      }
      return
    }

    viewModelScope.launch {
      _state.update { it.copy(isDownloading = true, errorMessage = null) }
      val appContext = getApplication<Application>()
      val download = updater.downloadReleaseApk(apkUrl, appContext.cacheDir)
      download.onSuccess { file ->
        val installResult = updater.launchInstallOrPermissions(appContext, file)
        installResult.onSuccess { message ->
          _state.update { it.copy(isDownloading = false, statusMessage = message) }
        }.onFailure { installError ->
          _state.update {
            it.copy(
              isDownloading = false,
              errorMessage = installError.message ?: "Install launch failed."
            )
          }
        }
      }.onFailure { error ->
        _state.update {
          it.copy(
            isDownloading = false,
            errorMessage = error.message ?: "Download failed."
          )
        }
      }
    }
  }
}
